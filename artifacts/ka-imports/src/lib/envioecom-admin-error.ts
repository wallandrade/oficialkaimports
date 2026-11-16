function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function parseEnvioEcomErrorBody(raw: string): Record<string, unknown> {
  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) return {};
  const candidates = [text];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start > 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "string") {
        try {
          return asRecord(JSON.parse(parsed) as unknown);
        } catch {
          return parsed.trim() ? { message: parsed.trim() } : {};
        }
      }
      return asRecord(parsed);
    } catch {
      continue;
    }
  }
  return {};
}

const INTERNAL_DETAIL_KEYS = new Set([
  "outcome",
  "resultscount",
  "errorcode",
  "hasshipmentid",
  "hasbarcode",
  "keys",
]);

function isInternalDetailKey(key: string): boolean {
  return INTERNAL_DETAIL_KEYS.has(key.replace(/_/g, "").toLowerCase());
}

export function formatEnvioEcomErrorDetails(details: unknown): string {
  if (details == null || details === "") return "";
  if (typeof details === "string" || typeof details === "number" || typeof details === "boolean") {
    return String(details).trim();
  }
  if (Array.isArray(details)) {
    return details.map((item) => formatEnvioEcomErrorDetails(item)).filter(Boolean).join("; ");
  }
  if (typeof details === "object") {
    const row = details as Record<string, unknown>;
    const field = String(row.field || row.path || "").trim();
    const msg = textOf(row.message) || textOf(row.reason) || (typeof row.error === "string" ? row.error.trim() : "");
    if (field || msg) return field && msg ? `${field}: ${msg}` : (msg || field);
    return Object.entries(row)
      .filter(([key]) => !isInternalDetailKey(key))
      .map(([key, value]) => {
        const nested = formatEnvioEcomErrorDetails(value);
        return nested ? `${key}: ${nested}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

export function envioEcomAdminErrorCode(data: unknown): string {
  const row = asRecord(data);
  if (typeof row.error === "string") return row.error.trim();
  const nested = asRecord(row.error);
  return textOf(nested.code) || textOf(row.code);
}

export function envioEcomAdminErrorFromHttp(status: number, raw: string): { error: string; message: string } {
  const data = parseEnvioEcomErrorBody(raw);
  const message = envioEcomAdminErrorMessage(data, raw);
  const gatewayPage = (status === 502 || status === 504)
    && !textOf(asRecord(data).message)
    && /<(?:html|body)|gateway timeout/i.test(raw);
  return {
    error: envioEcomAdminErrorCode(data),
    message: gatewayPage ? "Erro EnvioEcom" : message,
  };
}

export function envioEcomAdminErrorMessage(data: unknown, raw = ""): string {
  const row = asRecord(data);
  const nested = asRecord(row.error);
  const message = textOf(row.message)
    || textOf(nested.message)
    || textOf(nested.error)
    || (typeof row.error === "string" ? textOf(row.error) : "");
  const details = formatEnvioEcomErrorDetails(row.details ?? nested.details);
  const extra = details && message.includes(details) ? "" : details;
  const combined = [message, extra].filter(Boolean).join(" — ");
  if (combined) return combined;
  const plain = String(raw || "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
  if (
    plain
    && !plain.startsWith("<")
    && !plain.startsWith("{")
    && !plain.startsWith("[")
    && plain.length <= 400
    && !/\b(?:bearer|token|senha|password)\b/i.test(plain)
  ) {
    return plain.slice(0, 280);
  }
  return "Erro EnvioEcom";
}
