// Pure backup watchdog rules. No database and no Z-API here.

export const BACKUP_TZ = "America/Sao_Paulo";
export const BACKUP_TENANT_ID = "tenant_loja1";
export const BACKUP_STATUS_KEY = "backup_last_status";
export const BACKUP_ALERT_DATE_KEY = "backup_alert_last_date";

const WINDOW_START_MINUTES = 4 * 60;
const WINDOW_END_MINUTES = 12 * 60;

export type BackupLastStatus = {
  dateSP?: string;
  dbOk?: boolean;
  mediaOk?: boolean;
  dumpKey?: string | null;
  dumpBytes?: number | null;
  copied?: number;
  total?: number;
  finishedAt?: string;
};

export type BackupWatchdogClock = {
  dateSP: string;
  hour: number;
  minute: number;
  stamp: string;
  inside: boolean;
};

export type BackupWatchdogDecision =
  | { alert: false; reason: "outside_window" | "already_alerted" | "ok" }
  | { alert: true; reason: "db_unreachable" | "missing" | "stale" | "db_failed" | "media_failed" | "failed"; stage: string; error: string };

export function backupClock(now: Date, timeZone = BACKUP_TZ): BackupWatchdogClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const hourText = String(parts.hour === "24" ? "0" : parts.hour || "0").padStart(2, "0");
  const minuteText = String(parts.minute || "0").padStart(2, "0");
  const month = String(parts.month || "").padStart(2, "0");
  const day = String(parts.day || "").padStart(2, "0");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const minutes = hour * 60 + minute;
  return {
    dateSP: `${parts.year}-${month}-${day}`,
    hour,
    minute,
    stamp: `${day}/${month}/${parts.year} ${hourText}:${minuteText}`,
    inside: minutes >= WINDOW_START_MINUTES && minutes <= WINDOW_END_MINUTES,
  };
}

export function backupSettingOwnedByLoja1(tenantId: string | null | undefined): boolean {
  const value = String(tenantId ?? "").trim();
  return value === "" || value === BACKUP_TENANT_ID;
}

/** Comma-separated. Digits only, 55 prefix, 12 or 13 digits. */
export function parseBackupAlertPhones(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const text = String(raw).trim();
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const digits = part.replace(/\D/g, "");
    if (!digits.startsWith("55")) continue;
    if (digits.length < 12 || digits.length > 13) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
  }
  return out;
}

function looksLikeSql(text: string): boolean {
  return /\b(insert\s+into|delete\s+from|replace\s+into|update\s+[`'"]?[a-z_][\w]*[`'"]?\s+set|select\s+.+\s+from)\b/i.test(text);
}

export function clipBackupError(value: unknown): string {
  let text = String(value ?? "").replace(/\s+/g, " ").trim();
  text = text.replace(/mysql:\/\/\S+/gi, "[redacted]");
  text = text.replace(/https?:\/\/\S+/gi, "[url]");
  text = text.replace(/\b(password|secret|token|access[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  text = text.replace(/\d{12,}/g, "[numero]");
  if (!text) text = "erro desconhecido";
  if (looksLikeSql(text)) text = "erro no banco";
  return text.length > 200 ? text.slice(0, 200) : text;
}

export function formatBackupAlertText(input: {
  stages?: string[];
  details?: Array<{ stage: string; error: string }>;
  now?: Date;
  timeZone?: string;
}): string {
  const when = backupClock(input.now || new Date(), input.timeZone || BACKUP_TZ);
  const stages = (input.stages || []).map((stage) => String(stage || "").trim()).filter(Boolean);
  const lines = ["[Ka Imports] Backup falhou", `Etapa: ${stages.join(", ") || "backup"}`];
  for (const detail of input.details || []) {
    const stage = String(detail?.stage || "").trim() || "backup";
    lines.push(`${stage}: ${clipBackupError(detail?.error)}`);
  }
  lines.push(`Hora: ${when.stamp}`);
  return lines.join("\n");
}

export function parseBackupLastStatus(raw: unknown): BackupLastStatus | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as BackupLastStatus;
  } catch {
    return null;
  }
}

export function decideBackupWatchdog(input: {
  now: Date;
  status: BackupLastStatus | null | "unreachable";
  lastAlertDateSP: string | null;
  timeZone?: string;
}): BackupWatchdogDecision {
  const clock = backupClock(input.now, input.timeZone || BACKUP_TZ);
  if (!clock.inside) return { alert: false, reason: "outside_window" };
  if (String(input.lastAlertDateSP || "").trim() === clock.dateSP) {
    return { alert: false, reason: "already_alerted" };
  }
  if (input.status === "unreachable") {
    return { alert: true, reason: "db_unreachable", stage: "banco", error: "banco inacessível" };
  }
  const status = input.status;
  const dateSP = String(status?.dateSP || "").trim();
  if (!status || !dateSP) {
    return { alert: true, reason: "missing", stage: "banco, mídia", error: "backup de hoje não encontrado" };
  }
  if (dateSP !== clock.dateSP) {
    return { alert: true, reason: "stale", stage: "banco, mídia", error: "último backup não é de hoje" };
  }
  const dbBad = status.dbOk !== true;
  const mediaBad = status.mediaOk !== true;
  if (dbBad && mediaBad) {
    return { alert: true, reason: "failed", stage: "banco, mídia", error: "banco e mídia marcaram falha" };
  }
  if (dbBad) {
    return { alert: true, reason: "db_failed", stage: "banco", error: "backup do banco marcou falha" };
  }
  if (mediaBad) {
    return { alert: true, reason: "media_failed", stage: "mídia", error: "backup da mídia marcou falha" };
  }
  return { alert: false, reason: "ok" };
}
