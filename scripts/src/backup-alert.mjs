// Pure helpers for the backup job alert. Direct Z-API send-text, no queue.

export const BACKUP_TZ = "America/Sao_Paulo";
const ZAPI_HOST = "https://api.z-api.io";

export function saoPauloParts(date = new Date(), timeZone = BACKUP_TZ) {
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
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const hour = String(parts.hour === "24" ? "0" : parts.hour || "0").padStart(2, "0");
  const minute = String(parts.minute || "0").padStart(2, "0");
  const year = parts.year;
  const month = String(parts.month || "").padStart(2, "0");
  const day = String(parts.day || "").padStart(2, "0");
  return {
    dateSP: `${year}-${month}-${day}`,
    hour: Number(hour),
    minute: Number(minute),
    stamp: `${day}/${month}/${year} ${hour}:${minute}`,
  };
}

/** Comma-separated. Keeps digits only, requires the 55 prefix and 12 or 13 digits. */
export function parseBackupAlertPhones(raw) {
  if (raw == null) return [];
  const text = String(raw).trim();
  if (!text) return [];
  const out = [];
  const seen = new Set();
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

export const BACKUP_ALERT_DATE_KEY = "backup_alert_last_date";
export const BACKUP_ALERT_TENANT_ID = "tenant_loja1";
export const BACKUP_ALERT_MAX_ATTEMPTS = 3;
export const BACKUP_CLAIM_STALE_MS = 15 * 60 * 1000;

function looksLikeSql(text) {
  return /\b(insert\s+into|delete\s+from|replace\s+into|update\s+[`'"]?[a-z_][\w]*[`'"]?\s+set|select\s+.+\s+from)\b/i.test(text);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short error safe to put in a WhatsApp message and in the job log. */
export function clipBackupError(value) {
  let text = String(value ?? "").replace(/\s+/g, " ").trim();
  text = text.replace(/mysql:\/\/\S+/gi, "[redacted]");
  text = text.replace(/https?:\/\/\S+/gi, "[url]");
  text = text.replace(/\bfor user\s+'[^']*'/gi, "for user '[redacted]'");
  text = text.replace(/user\s+'[^']*'/gi, "user '[redacted]'");
  text = text.replace(/@'[^']*'/g, "@'[redacted]'");
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[host]");
  text = text.replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|io|app|internal|local|cloud)(?::\d+)?\b/gi, "[host]");
  text = text.replace(/\b(password|secret|token|access[_-]?key|authorization)\s*[:=]\s*(?!YES\b|NO\b)\S+/gi, "$1=[redacted]");
  text = text.replace(/\b55\d{10,11}\b/g, "[numero]");
  if (!text) text = "erro desconhecido";
  if (looksLikeSql(text)) text = "erro no banco";
  return text.length > 200 ? text.slice(0, 200) : text;
}

/**
 * `YYYY-MM-DD` = enviado. `YYYY-MM-DD@N@ms` = claim em andamento.
 * `YYYY-MM-DD#N` = N falhas, liberado. Um `@` com mais de 15 min, ou sem hora, pode ser retomado.
 * @returns {{ next: string, failedValue: string } | null}
 */
export function nextBackupAlertClaim(current, dateSP, now = Date.now()) {
  const value = String(current ?? "").trim();
  const day = String(dateSP || "").trim();
  const at = Number(now);
  if (!day || !Number.isFinite(at)) return null;
  if (value === day) return null;
  const progress = value.match(new RegExp(`^${escapeRegExp(day)}@(\\d+)(?:@(\\d+))?$`));
  if (progress) {
    const attempt = Number(progress[1]);
    if (attempt < 1 || attempt > BACKUP_ALERT_MAX_ATTEMPTS) return null;
    const stamp = progress[2] ? Number(progress[2]) : 0;
    const age = at - stamp;
    if (progress[2] && age >= 0 && age < BACKUP_CLAIM_STALE_MS) return null;
    return { next: `${day}@${attempt}@${at}`, failedValue: `${day}#${attempt}` };
  }
  const failed = value.match(new RegExp(`^${escapeRegExp(day)}#(\\d+)$`));
  if (failed) {
    const attempts = Number(failed[1]);
    if (attempts >= BACKUP_ALERT_MAX_ATTEMPTS) return null;
    const attempt = attempts + 1;
    return { next: `${day}@${attempt}@${at}`, failedValue: `${day}#${attempt}` };
  }
  return { next: `${day}@1@${at}`, failedValue: `${day}#1` };
}

/** True when today's alert was sent, or the three tries are already used. An in-progress claim does not count. */
export function backupAlertClaimBlocks(raw, dateSP) {
  const value = String(raw ?? "").trim();
  const day = String(dateSP || "").trim();
  if (!day || value !== day && !value.startsWith(`${day}#`)) return false;
  if (value === day) return true;
  const failed = value.match(new RegExp(`^${escapeRegExp(day)}#(\\d+)$`));
  return Boolean(failed && Number(failed[1]) >= BACKUP_ALERT_MAX_ATTEMPTS);
}

function settingCell(row, name, index) {
  if (!row) return "";
  if (Array.isArray(row)) return row[index];
  return row[name];
}

function claimChanged(header) {
  if (!header) return false;
  if (typeof header.changedRows === "number") return header.changedRows > 0;
  return Number(header.affectedRows) > 0;
}

export async function claimBackupAlertDate(query, dateSP, tenantId = BACKUP_ALERT_TENANT_ID, now = Date.now()) {
  const [rows] = await query(
    "SELECT `value` AS value, tenant_id AS tenantId FROM site_settings WHERE `key` = ? LIMIT 1",
    [BACKUP_ALERT_DATE_KEY],
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  const tenant = String(settingCell(row, "tenantId", 1) || "").trim();
  if (row && tenant && tenant !== tenantId) return null;
  const current = row ? String(settingCell(row, "value", 0) || "") : "";
  const plan = nextBackupAlertClaim(row ? current : "", dateSP, now);
  if (!plan) return null;
  if (!row) {
    try {
      const [header] = await query(
        "INSERT INTO site_settings (`key`, `value`, tenant_id, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP())",
        [BACKUP_ALERT_DATE_KEY, plan.next, tenantId],
      );
      if (!Number(header?.affectedRows)) return null;
    } catch (err) {
      if (String(err?.code || "") === "ER_DUP_ENTRY") return null;
      throw err;
    }
    return { token: plan.next, failedValue: plan.failedValue };
  }
  const [header] = await query(
    "UPDATE site_settings SET `value` = ?, updated_at = UTC_TIMESTAMP() WHERE `key` = ? AND `value` = ? AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')",
    [plan.next, BACKUP_ALERT_DATE_KEY, current, tenantId],
  );
  if (!claimChanged(header)) return null;
  return { token: plan.next, failedValue: plan.failedValue };
}

export async function finishBackupAlertClaim(query, dateSP, claim, outcome, tenantId = BACKUP_ALERT_TENANT_ID) {
  const next = outcome === "sent" ? dateSP : claim.failedValue;
  await query(
    "UPDATE site_settings SET `value` = ?, updated_at = UTC_TIMESTAMP() WHERE `key` = ? AND `value` = ? AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')",
    [next, BACKUP_ALERT_DATE_KEY, claim.token, tenantId],
  );
}

/**
 * @param {{ stages?: string[], details?: Array<{ stage: string, error: string }>, now?: Date, timeZone?: string }} input
 */
export function formatBackupAlertText(input) {
  const when = saoPauloParts(input.now || new Date(), input.timeZone || BACKUP_TZ);
  const stages = (input.stages || []).map((stage) => String(stage || "").trim()).filter(Boolean);
  const lines = ["[Ka Imports] Backup falhou", `Etapa: ${stages.join(", ") || "backup"}`];
  for (const detail of input.details || []) {
    const stage = String(detail?.stage || "").trim() || "backup";
    lines.push(`${stage}: ${clipBackupError(detail?.error)}`);
  }
  lines.push(`Hora: ${when.stamp}`);
  return lines.join("\n");
}

export function backupZapiFlag(env, name) {
  const value = String(env?.[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** Same fake range as artifacts/api-server/src/lib/whatsapp-outbound-policy.ts */
export function isFakeBackupPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("550000") && digits.length >= 12 && digits.length <= 15;
}

export function backupZapiCredentials(env) {
  const instanceId = String(env?.ZAPI_MAIN_INSTANCE_ID || "").trim();
  const token = String(env?.ZAPI_MAIN_TOKEN || "").trim();
  const clientToken = String(env?.ZAPI_CLIENT_TOKEN || "").trim();
  if (!instanceId || !token || !clientToken) return null;
  if (instanceId.includes("/") || token.includes("/")) return null;
  return { instanceId, token, clientToken };
}

export function zapiTextAccepted(status, raw) {
  if (status < 200 || status >= 300) return false;
  if (!String(raw || "").trim()) return true;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && (parsed.error || parsed.erro)) return false;
  } catch {
    return true;
  }
  return true;
}

/**
 * Direct send-text. Dry-run and fake-only follow zapi-send.ts.
 * Does not log phones, tokens or the request URL.
 */
export async function sendBackupAlert({ env, phones, message, fetchImpl, log = () => {} }) {
  const list = Array.isArray(phones) ? phones : [];
  if (backupZapiFlag(env, "WHATSAPP_ZAPI_DRY_RUN")) {
    log(`alerta em dry-run, destinos=${list.length}`);
    return { ok: true, dryRun: true, sent: 0, skipped: list.length, failed: 0 };
  }
  const fakeOnly = backupZapiFlag(env, "WHATSAPP_ZAPI_FAKE_ONLY");
  const allowed = [];
  let skipped = 0;
  for (const phone of list) {
    if (fakeOnly && !isFakeBackupPhone(phone)) {
      skipped += 1;
      continue;
    }
    allowed.push(phone);
  }
  if (fakeOnly && allowed.length === 0) {
    log("aviso: modo de teste recusou o alerta");
    return { ok: false, dryRun: false, sent: 0, skipped, failed: 0 };
  }
  const creds = backupZapiCredentials(env);
  if (!creds) {
    log("aviso: Z-API sem credencial");
    return { ok: false, dryRun: false, sent: 0, skipped, failed: allowed.length };
  }
  const fetchFn = fetchImpl || globalThis.fetch;
  let sent = 0;
  let failed = 0;
  for (const phone of allowed) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const url = `${ZAPI_HOST}/instances/${encodeURIComponent(creds.instanceId)}/token/${encodeURIComponent(creds.token)}/send-text`;
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Client-Token": creds.clientToken,
        },
        body: JSON.stringify({ phone, message }),
        signal: controller.signal,
      });
      const raw = await response.text();
      if (zapiTextAccepted(response.status, raw)) sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (failed > 0) log(`aviso: alerta incompleto, enviados=${sent}, falhas=${failed}`);
  else log(`alerta enviado, destinos=${sent}`);
  return { ok: failed === 0 && sent > 0, dryRun: false, sent, skipped, failed };
}
