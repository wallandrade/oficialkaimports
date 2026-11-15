const REDACTED = "[REDACTED]";
const MAX_LOG_STRING = 20_000;
const MAX_DEPTH = 8;
const MAX_ITEMS = 40;

const SENSITIVE_EXACT = new Set([
  "sql",
  "sqlmessage",
  "query",
  "values",
  "params",
  "password",
  "passwordhash",
  "passwd",
  "pwd",
  "senha",
  "hash",
  "salt",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "apisecret",
  "secret",
  "authorization",
  "proxyauthorization",
  "cookie",
  "cookies",
  "setcookie",
  "cpf",
  "document",
  "documento",
  "clientdocument",
  "phone",
  "telefone",
  "celular",
  "whatsapp",
  "mobile",
  "clientphone",
  "address",
  "endereco",
  "street",
  "logradouro",
  "neighborhood",
  "bairro",
  "complement",
  "complemento",
  "cep",
  "zipcode",
  "zip",
  "email",
  "mail",
  "clientemail",
  "body",
  "reqbody",
  "requestbody",
  "pixcode",
  "pixbase64",
  "emv",
  "copiacola",
  "cardnumber",
  "cvv",
  "pan",
  "webhooktoken",
  "databaseurl",
  "connectionstring",
  "maintenancekey",
]);

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

const CONSOLE_METHODS: ConsoleMethod[] = ["log", "info", "warn", "error", "debug"];

type SafeConsole = typeof console & {
  __kaSafeLogInstalled?: boolean;
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  if (SENSITIVE_EXACT.has(normalized)) return true;
  if (normalized.startsWith("has") || normalized.startsWith("is") || normalized.startsWith("with")) return false;
  if (normalized.includes("password") || normalized.includes("senha")) return true;
  if (normalized.includes("secret") || normalized.endsWith("token") || normalized.includes("apikey")) return true;
  if (normalized.includes("authorization") || normalized.includes("cookie")) return true;
  if (normalized.includes("email") || normalized.includes("cpf")) return true;
  if (
    normalized.includes("phone")
    || normalized.includes("telefone")
    || normalized.includes("celular")
    || normalized.includes("whatsapp")
  ) return true;
  if (normalized.endsWith("salt")) return true;
  if (
    normalized.includes("address")
    || normalized.includes("endereco")
    || normalized.includes("logradouro")
    || normalized === "cep"
  ) return true;
  if (normalized.includes("credential") || normalized.includes("maintenancekey")) return true;
  return false;
}

export function containsSqlLeak(value: string): boolean {
  if (/failed query\s*:/i.test(value)) return true;
  if (/\bduplicate entry\b/i.test(value) && /\bfor key\b/i.test(value)) return true;
  if (/\binsert\s+into\s+[`"']?[a-zA-Z_][\w.]*[`"']?\s*\(/i.test(value)) return true;
  if (/\bdelete\s+from\s+[`"']?[a-zA-Z_]/i.test(value)) return true;
  if (/\breplace\s+into\s+[`"']?[a-zA-Z_]/i.test(value)) return true;
  if (/\bupdate\s+[`"']?[a-zA-Z_][\w]*[`"']?\s+set\s+[`"']?[a-zA-Z_]/i.test(value)) return true;
  if (/password_hash|passwordHash/i.test(value) && /\b(insert|values|params)\b/i.test(value)) return true;
  return false;
}

function extractCode(text: string): string | null {
  return text.match(/\b(ER_[A-Z0-9_]+)\b/)?.[1] ?? null;
}

function extractErrno(text: string): number | null {
  const match = text.match(/\berrno\b["']?\s*[:=]\s*(\d{3,5})/i);
  if (!match?.[1]) return null;
  const errno = Number(match[1]);
  return errno >= 1000 && errno < 5000 ? errno : null;
}

export function safeDatabaseMessage(code?: string | null, errno?: number | null, text?: string): string {
  if (code === "ER_DUP_ENTRY" || errno === 1062 || /\bduplicate entry\b/i.test(text || "")) {
    return "Registro duplicado";
  }
  if (
    code === "ER_NO_REFERENCED_ROW"
    || code === "ER_NO_REFERENCED_ROW_2"
    || code === "ER_ROW_IS_REFERENCED"
    || code === "ER_ROW_IS_REFERENCED_2"
  ) {
    return "Referência inválida";
  }
  if (code === "ER_DATA_TOO_LONG" || code === "ER_TRUNCATED_WRONG_VALUE") {
    return "Valor longo demais";
  }
  if (code === "ER_BAD_NULL_ERROR" || code === "ER_NO_DEFAULT_FOR_FIELD") {
    return "Campo obrigatório ausente";
  }
  if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
    return "Conflito temporário no banco";
  }
  return "Erro de banco de dados";
}

function safeCode(code: unknown): string | null {
  if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return null;
  return code;
}

function readDbMeta(error: unknown): { code: string | null; errno: number | null; sqlState: string | null } {
  const seen = new Set<unknown>();
  let code: string | null = null;
  let errno: number | null = null;
  let sqlState: string | null = null;
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const nextCode = safeCode(record.code);
    if (nextCode && (!code || (/^ER_/.test(nextCode) && !/^ER_/.test(code)))) code = nextCode;
    if (
      typeof record.errno === "number"
      && Number.isInteger(record.errno)
      && record.errno >= 1000
      && record.errno < 5000
      && errno == null
    ) {
      errno = record.errno;
    }
    if (typeof record.sqlState === "string" && /^[0-9A-Z]{5}$/.test(record.sqlState) && !sqlState) {
      sqlState = record.sqlState;
    }
    current = record.cause;
  }
  return { code, errno, sqlState };
}

function collectMessages(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current) && parts.length < 6) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.sqlMessage === "string") parts.push(record.sqlMessage);
    current = record.cause;
  }
  return parts.join("\n");
}

function isDatabaseError(value: object, seen = new Set<unknown>()): boolean {
  if (seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (typeof record.sql === "string" && record.sql.length > 0) return true;
  if (typeof record.sqlMessage === "string" && record.sqlMessage.length > 0) return true;
  if (typeof record.code === "string" && /^ER_[A-Z0-9_]+$/.test(record.code)) return true;
  if (typeof record.sqlState === "string" && /^[0-9A-Z]{5}$/.test(record.sqlState) && (record.code || record.errno || record.sql)) {
    return true;
  }
  if (typeof record.query === "string" && containsSqlLeak(record.query)) return true;
  const message = typeof record.message === "string" ? record.message : "";
  if (containsSqlLeak(message)) return true;
  if (record.cause && typeof record.cause === "object" && isDatabaseError(record.cause as object, seen)) return true;
  return false;
}

export function isDuplicateDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return typeof error === "string" && (/\bER_DUP_ENTRY\b/.test(error) || (/\bduplicate entry\b/i.test(error) && /\bfor key\b/i.test(error)));
  }
  const meta = readDbMeta(error);
  if (meta.code === "ER_DUP_ENTRY" || meta.errno === 1062) return true;
  const text = collectMessages(error);
  return /\bER_DUP_ENTRY\b/.test(text) || (/\bduplicate entry\b/i.test(text) && /\bfor key\b/i.test(text));
}

function summarizeDatabaseError(error: object): Record<string, unknown> {
  const meta = readDbMeta(error);
  const summary: Record<string, unknown> = {
    name: "DatabaseError",
    message: safeDatabaseMessage(meta.code, meta.errno, collectMessages(error)),
  };
  if (meta.code) summary.code = meta.code;
  if (meta.errno != null) summary.errno = meta.errno;
  if (meta.sqlState) summary.sqlState = meta.sqlState;
  return summary;
}

function redactInlineSecrets(value: string): string {
  let out = value;
  out = out.replace(/\b(?:mysql|postgres|postgresql|mongodb|redis):\/\/\S+/gi, REDACTED);
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  out = out.replace(/(authorization\s*:\s*)([^\n]+)/gi, "$1[REDACTED]");
  out = out.replace(/(cookie\s*:\s*)(\S+)/gi, "$1[REDACTED]");
  out = out.replace(/([?&#](?:token|password|senha|email|cpf|secret|access_token|refresh_token|authorization|cookie)=)[^&#\s"']+/gi, "$1[REDACTED]");
  out = out.replace(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED);
  out = out.replace(/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, REDACTED);
  out = out.replace(/(?<!\d)(?:\(?\d{2}\)?\s*)?9\d{4}-\d{4}(?!\d)/g, REDACTED);
  out = out.replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, REDACTED);
  out = out.replace(/\b000201[0-9A-Za-z.]{20,}/g, REDACTED);
  out = out.replace(
    /("(?:password|passwordHash|password_hash|passwd|senha|salt|token|secret|authorization|cookie|cookies|email|e-mail|cpf|document|documento|phone|telefone|celular|whatsapp|address|endereco|street|cep|sql|sqlMessage|query|values|params|body|pixCode|pix_code)"\s*:\s*")((?:\\.|[^"\\])*)(")/gi,
    "$1[REDACTED]$3",
  );
  if (out.length > MAX_LOG_STRING) return `${out.slice(0, MAX_LOG_STRING)}…`;
  return out;
}

function sanitizeLogString(value: string, depth: number): string {
  const capped = value.length > 100_000 ? value.slice(0, 100_000) : value;
  const trimmed = capped.trim();
  if (
    depth < 6
    && ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))
  ) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return JSON.stringify(sanitizeValue(parsed, depth + 1, new WeakSet()));
    } catch {
      // texto solto; segue o filtro de SQL e de segredo
    }
  }
  if (containsSqlLeak(capped)) return safeDatabaseMessage(extractCode(capped), extractErrno(capped), capped);
  return redactInlineSecrets(capped);
}

function dateForJson(value: Date): string | null {
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function isOpaqueRuntimeObject(value: object): boolean {
  const name = value.constructor?.name || "";
  return (
    name === "IncomingMessage"
    || name === "ServerResponse"
    || name === "Socket"
    || name === "TLSSocket"
    || name === "Pool"
    || name === "PoolConnection"
    || name === "Connection"
  );
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value == null) return value ?? null;
  if (typeof value === "string") return sanitizeLogString(value, depth);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";
  if (typeof value !== "object") return null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return "[binary]";
  if (value instanceof Date) return dateForJson(value);
  if (depth > MAX_DEPTH) return "[depth]";
  if (seen.has(value)) return "[circular]";
  if (isOpaqueRuntimeObject(value)) return "[request]";
  if (isDatabaseError(value)) return summarizeDatabaseError(value);

  seen.add(value);
  if (value instanceof Error) {
    const copy: Record<string, unknown> = {
      name: value.name,
      message: sanitizeLogString(value.message, depth + 1),
    };
    if (value.stack) copy.stack = sanitizeLogString(value.stack, depth + 1);
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = assignLogValue(key, entry, depth, seen);
    }
    return copy;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((entry) => sanitizeValue(entry, depth + 1, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
    output[key] = assignLogValue(key, entry, depth, seen);
  }
  return output;
}

function assignLogValue(key: string, entry: unknown, depth: number, seen: WeakSet<object>): unknown {
  const normalized = normalizeKey(key);
  const walkObject = entry && typeof entry === "object"
    && (normalized === "query" || ((normalized === "values" || normalized === "params") && !Array.isArray(entry)));
  if (walkObject) return sanitizeValue(entry, depth + 1, seen);
  if (isSensitiveKey(key)) return REDACTED;
  return sanitizeValue(entry, depth + 1, seen);
}

export function sanitizeForLog(value: unknown): unknown {
  return sanitizeValue(value, 0, new WeakSet());
}

function sanitizeHttpValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    if (containsSqlLeak(value)) return safeDatabaseMessage(extractCode(value), extractErrno(value), value);
    return value;
  }
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return dateForJson(value);
  if (depth > 12) return null;
  if (seen.has(value)) return null;
  if (isDatabaseError(value)) {
    const meta = readDbMeta(value);
    const summary: Record<string, unknown> = {
      message: safeDatabaseMessage(meta.code, meta.errno, collectMessages(value)),
    };
    if (meta.code) summary.code = meta.code;
    return summary;
  }
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeHttpValue(entry, depth + 1, seen));
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    if (normalized === "sql" || normalized === "sqlmessage") continue;
    if (normalized === "stack" && typeof entry === "string" && containsSqlLeak(entry)) continue;
    if ((normalized === "query" || normalized === "values" || normalized === "params") && typeof entry === "string" && containsSqlLeak(entry)) {
      continue;
    }
    if ((normalized === "values" || normalized === "params") && Array.isArray(entry) && entry.some((item) => typeof item === "string" && containsSqlLeak(item))) {
      continue;
    }
    output[key] = sanitizeHttpValue(entry, depth + 1, seen);
  }
  return output;
}

export function sanitizeHttpBody(value: unknown): unknown {
  return sanitizeHttpValue(value, 0, new WeakSet());
}

export function publicErrorMessage(error: unknown, fallback = "Internal Server Error"): string {
  if (error && typeof error === "object" && isDatabaseError(error)) {
    const meta = readDbMeta(error);
    return safeDatabaseMessage(meta.code, meta.errno, collectMessages(error));
  }
  if (typeof error === "string") {
    if (containsSqlLeak(error)) return safeDatabaseMessage(extractCode(error), extractErrno(error), error);
    const message = error.trim();
    if (!message || message.length > 400) return fallback;
    return message;
  }
  if (error instanceof Error) {
    if (containsSqlLeak(error.message)) return safeDatabaseMessage(extractCode(error.message), extractErrno(error.message), error.message);
    const message = error.message.trim();
    if (!message || message.length > 400) return fallback;
    return message;
  }
  return fallback;
}

export function installSafeConsole(): void {
  const target = console as SafeConsole;
  if (target.__kaSafeLogInstalled) return;
  const original = {} as Record<ConsoleMethod, (...args: unknown[]) => void>;
  const patched = console as unknown as Record<ConsoleMethod, (...args: unknown[]) => void>;
  for (const method of CONSOLE_METHODS) {
    original[method] = console[method].bind(console);
    patched[method] = (...args: unknown[]) => {
      try {
        original[method](...args.map((arg) => sanitizeForLog(arg)));
      } catch {
        original[method]("[safe-log] falha ao sanitizar");
      }
    };
  }
  target.__kaSafeLogInstalled = true;
}
