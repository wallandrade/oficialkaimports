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

function looksLikeSql(text) {
  return /\b(insert\s+into|delete\s+from|replace\s+into|update\s+[`'"]?[a-z_][\w]*[`'"]?\s+set|select\s+.+\s+from)\b/i.test(text);
}

/** Short error safe to put in a WhatsApp message and in the job log. */
export function clipBackupError(value) {
  let text = String(value ?? "").replace(/\s+/g, " ").trim();
  text = text.replace(/mysql:\/\/\S+/gi, "[redacted]");
  text = text.replace(/https?:\/\/\S+/gi, "[url]");
  text = text.replace(/\b(password|secret|token|access[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  text = text.replace(/\d{12,}/g, "[numero]");
  if (!text) text = "erro desconhecido";
  if (looksLikeSql(text)) text = "erro no banco";
  return text.length > 200 ? text.slice(0, 200) : text;
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
