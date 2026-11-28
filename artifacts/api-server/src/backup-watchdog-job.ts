import { and, eq, isNull, or } from "drizzle-orm";
import { db, siteSettingsTable } from "@workspace/db";
import { sendZapiMessage } from "./lib/zapi-send";
import {
  BACKUP_ALERT_DATE_KEY,
  BACKUP_STATUS_KEY,
  BACKUP_TENANT_ID,
  backupClock,
  backupSettingOwnedByLoja1,
  decideBackupWatchdog,
  formatBackupAlertText,
  parseBackupAlertPhones,
  parseBackupLastStatus,
  type BackupLastStatus,
} from "./lib/backup-watchdog";

const TICK_MS = 30 * 60 * 1000;

let alertedDateSP: string | null = null;

function isDupEntry(err: unknown): boolean {
  return String((err as { code?: string } | null)?.code || "") === "ER_DUP_ENTRY";
}

async function readBackupRows(): Promise<Array<{ key: string; value: string; tenantId: string | null }>> {
  return db
    .select({
      key: siteSettingsTable.key,
      value: siteSettingsTable.value,
      tenantId: siteSettingsTable.tenantId,
    })
    .from(siteSettingsTable)
    .where(or(
      eq(siteSettingsTable.key, BACKUP_STATUS_KEY),
      eq(siteSettingsTable.key, BACKUP_ALERT_DATE_KEY),
    ));
}

async function writeAlertDate(dateSP: string): Promise<void> {
  const owned = or(
    eq(siteSettingsTable.tenantId, BACKUP_TENANT_ID),
    isNull(siteSettingsTable.tenantId),
    eq(siteSettingsTable.tenantId, ""),
  );
  const [existing] = await db
    .select({ tenantId: siteSettingsTable.tenantId })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.key, BACKUP_ALERT_DATE_KEY))
    .limit(1);
  if (existing && !backupSettingOwnedByLoja1(existing.tenantId)) {
    console.warn("[backup] data do alerta é de outra loja; não altero");
    return;
  }
  if (!existing) {
    try {
      await db.insert(siteSettingsTable).values({
        key: BACKUP_ALERT_DATE_KEY,
        value: dateSP,
        tenantId: BACKUP_TENANT_ID,
        updatedAt: new Date(),
      });
      return;
    } catch (err) {
      if (!isDupEntry(err)) throw err;
    }
  }
  await db
    .update(siteSettingsTable)
    .set({ value: dateSP, tenantId: BACKUP_TENANT_ID, updatedAt: new Date() })
    .where(and(eq(siteSettingsTable.key, BACKUP_ALERT_DATE_KEY), owned));
}

export async function runBackupWatchdogTick(now = new Date()): Promise<void> {
  const clock = backupClock(now);
  if (!clock.inside) return;

  let status: BackupLastStatus | null | "unreachable" = null;
  let lastAlertDateSP = alertedDateSP;
  try {
    const rows = await readBackupRows();
    const statusRow = rows.find((row) => row.key === BACKUP_STATUS_KEY);
    const alertRow = rows.find((row) => row.key === BACKUP_ALERT_DATE_KEY);
    if (statusRow && !backupSettingOwnedByLoja1(statusRow.tenantId)) {
      console.warn("[backup] status é de outra loja; ignoro");
      status = null;
    } else if (statusRow) {
      status = parseBackupLastStatus(statusRow.value);
    } else {
      status = null;
    }
    if (alertRow && backupSettingOwnedByLoja1(alertRow.tenantId)) {
      const stored = String(alertRow.value || "").trim();
      if (stored) lastAlertDateSP = stored;
    }
  } catch {
    console.warn("[backup] não leu o status");
    status = "unreachable";
  }

  const decision = decideBackupWatchdog({ now, status, lastAlertDateSP });
  if (!decision.alert) return;

  const phones = parseBackupAlertPhones(process.env.BACKUP_ALERT_PHONES);
  if (phones.length === 0) {
    console.warn("[backup] BACKUP_ALERT_PHONES ausente; alerta não enviado");
    return;
  }

  const message = formatBackupAlertText({
    stages: [decision.stage],
    details: [{ stage: decision.stage, error: decision.error }],
    now,
  });
  let delivered = false;
  for (const phone of phones) {
    const result = await sendZapiMessage({
      instance: "main",
      phone,
      kind: "text",
      message,
      live: true,
    });
    if (result.ok) delivered = true;
    else console.warn(`[backup] alerta não saiu (${result.error || "erro"})`);
  }
  if (!delivered) return;

  alertedDateSP = clock.dateSP;
  try {
    await writeAlertDate(clock.dateSP);
  } catch {
    console.warn("[backup] não gravou a data do alerta");
  }
}

export function startBackupWatchdogJob(): void {
  let ticking = false;
  const tick = () => {
    if (ticking) return;
    ticking = true;
    void runBackupWatchdogTick()
      .catch(() => {
        console.warn("[backup] conferência falhou");
      })
      .finally(() => {
        ticking = false;
      });
  };
  setInterval(tick, TICK_MS);
  console.info("[backup] conferência a cada 30 min, das 4h às 12h (São Paulo).");
}
