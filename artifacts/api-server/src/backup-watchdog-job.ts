import { eq, or } from "drizzle-orm";
import { db, pool, siteSettingsTable } from "@workspace/db";
import { sendZapiMessage } from "./lib/zapi-send";
import {
  BACKUP_ALERT_DATE_KEY,
  BACKUP_STATUS_KEY,
  BACKUP_TENANT_ID,
  backupAlertClaimBlocks,
  backupAlertClaimSql,
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

type AlertClaim = { token: string; failedValue: string };

function claimToken(value: string, dateSP: string): AlertClaim | null {
  const match = value.match(new RegExp(`^${dateSP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@(\\d+)$`));
  if (!match) return null;
  return { token: value, failedValue: `${dateSP}#${match[1]}` };
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

async function claimBackupAlert(dateSP: string): Promise<AlertClaim | null> {
  const conn = await pool.getConnection();
  try {
    const { sql, params } = backupAlertClaimSql(dateSP);
    const [header] = await conn.query(sql, params) as unknown as [{ affectedRows?: number }];
    if (!Number(header?.affectedRows)) return null;
    const [rows] = await conn.query(
      "SELECT `value` AS value, tenant_id AS tenantId FROM site_settings WHERE `key` = ? LIMIT 1",
      [BACKUP_ALERT_DATE_KEY],
    ) as unknown as [Array<{ value?: string; tenantId?: string | null }>];
    const row = rows?.[0];
    const tenant = String(row?.tenantId || "").trim();
    if (tenant && tenant !== BACKUP_TENANT_ID) return null;
    return claimToken(String(row?.value || ""), dateSP);
  } finally {
    conn.release();
  }
}

async function finishBackupAlert(dateSP: string, claim: AlertClaim, outcome: "sent" | "failed"): Promise<void> {
  const next = outcome === "sent" ? dateSP : claim.failedValue;
  await pool.query(
    "UPDATE site_settings SET `value` = ?, updated_at = UTC_TIMESTAMP() WHERE `key` = ? AND `value` = ? AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')",
    [next, BACKUP_ALERT_DATE_KEY, claim.token, BACKUP_TENANT_ID],
  );
}

export async function runBackupWatchdogTick(now = new Date()): Promise<void> {
  const clock = backupClock(now);
  if (!clock.inside) return;

  let status: BackupLastStatus | null | "unreachable" = null;
  let lastAlertDateSP: string | null = null;
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
      if (backupAlertClaimBlocks(stored, clock.dateSP)) lastAlertDateSP = clock.dateSP;
    }
  } catch {
    console.warn("[backup] não leu o status");
    status = "unreachable";
    lastAlertDateSP = alertedDateSP;
  }

  const decision = decideBackupWatchdog({ now, status, lastAlertDateSP });
  if (!decision.alert) return;

  const phones = parseBackupAlertPhones(process.env.BACKUP_ALERT_PHONES);
  if (phones.length === 0) {
    console.warn("[backup] BACKUP_ALERT_PHONES ausente; alerta não enviado");
    return;
  }

  let claim: AlertClaim | null = null;
  try {
    claim = await claimBackupAlert(clock.dateSP);
  } catch {
    console.warn("[backup] não registrei o alerta");
    return;
  }
  if (!claim) return;

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
  if (delivered) alertedDateSP = clock.dateSP;
  try {
    await finishBackupAlert(clock.dateSP, claim, delivered ? "sent" : "failed");
  } catch {
    console.warn("[backup] não fechei o alerta");
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
  tick();
  setInterval(tick, TICK_MS);
  console.info("[backup] conferência na subida e a cada 30 min, das 4h às 12h (São Paulo).");
}
