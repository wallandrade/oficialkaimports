export const ENVIOECOM_ENV_ACCOUNT_ID = "env";
export const ENVIOECOM_TENANT_ACCOUNT_ID = "tenant";
export const ENVIOECOM_DEFAULT_TENANT_ID = "tenant_loja1";

export const ENVIOECOM_ACCOUNT_SETTING_KEYS = {
  token: "envioecom_token",
  email: "envioecom_email",
  password: "envioecom_password",
  originCep: "envioecom_origin_cep",
  accounts: "envioecom_accounts",
} as const;

export type EnvioEcomAccountAuth = {
  accountId: string;
  name: string;
  token: string;
  email: string;
  password: string;
  originCep: string;
  fromEnv: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type EnvioEcomAccountPublic = {
  id: string;
  name: string;
  fromEnv: boolean;
  configured: boolean;
  tokenMasked: string | null;
  emailMasked: string | null;
  originCep: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ExtraAccountRow = {
  id: string;
  name: string;
  token: string;
  email: string;
  password: string;
  originCep: string;
  createdAt: string;
  updatedAt: string;
};

export function maskSecret(value: string): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return "••••";
  return `${"•".repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

export function maskEmail(value: string): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const at = trimmed.indexOf("@");
  if (at <= 0) return maskSecret(trimmed);
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(4, local.length - visible.length))}${domain}`;
}

function digitsOnly(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function looksLikeEmailPasswordMix(token: string): boolean {
  return token.includes(":") || token.includes("@");
}

function safeToken(value: unknown): string {
  const token = String(value || "").trim();
  return looksLikeEmailPasswordMix(token) ? "" : token;
}

export function isEnvioEcomAccountConfigured(input: { token?: string; email?: string; password?: string }): boolean {
  return !!(String(input.token || "").trim() || (String(input.email || "").trim() && String(input.password || "").trim()));
}

export function toPublicEnvioEcomAccount(account: EnvioEcomAccountAuth): EnvioEcomAccountPublic {
  return {
    id: account.accountId,
    name: account.name,
    fromEnv: account.fromEnv,
    configured: isEnvioEcomAccountConfigured(account),
    tokenMasked: maskSecret(account.token),
    emailMasked: maskEmail(account.email),
    originCep: account.originCep,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function parseEnvioEcomExtrasJson(raw: unknown): ExtraAccountRow[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const extras: ExtraAccountRow[] = [];
  const seen = new Set<string>();
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = String(item.id || "").trim();
    if (!id || id === ENVIOECOM_ENV_ACCOUNT_ID || id === ENVIOECOM_TENANT_ACCOUNT_ID || seen.has(id)) continue;
    seen.add(id);
    extras.push({
      id,
      name: String(item.name || "").trim() || "Conta extra",
      token: safeToken(item.token),
      email: String(item.email || "").trim(),
      password: String(item.password || "").trim(),
      originCep: digitsOnly(item.originCep).slice(0, 8),
      createdAt: String(item.createdAt || "").trim() || new Date().toISOString(),
      updatedAt: String(item.updatedAt || "").trim() || new Date().toISOString(),
    });
  }
  return extras;
}

export function extraAccountToAuth(row: ExtraAccountRow): EnvioEcomAccountAuth {
  return {
    accountId: row.id,
    name: row.name,
    token: row.token,
    email: row.email,
    password: row.password,
    originCep: row.originCep,
    fromEnv: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function readEnvAccount(settings: Record<string, string>): EnvioEcomAccountAuth | null {
  const token = safeToken(process.env.ENVIOECOM_TOKEN);
  const email = String(process.env.ENVIOECOM_EMAIL || "").trim();
  const password = String(process.env.ENVIOECOM_PASSWORD || "").trim();
  if (!isEnvioEcomAccountConfigured({ token, email, password })) return null;
  const originFromEnv = digitsOnly(process.env.ENVIOECOM_ORIGIN_CEP).slice(0, 8);
  const originFromSettings = digitsOnly(settings[ENVIOECOM_ACCOUNT_SETTING_KEYS.originCep]).slice(0, 8);
  return {
    accountId: ENVIOECOM_ENV_ACCOUNT_ID,
    name: "São Paulo",
    token,
    email,
    password,
    originCep: originFromEnv || originFromSettings,
    fromEnv: true,
  };
}

function readTenantAccount(settings: Record<string, string>): EnvioEcomAccountAuth | null {
  const token = safeToken(settings[ENVIOECOM_ACCOUNT_SETTING_KEYS.token]);
  const email = String(settings[ENVIOECOM_ACCOUNT_SETTING_KEYS.email] || "").trim();
  const password = String(settings[ENVIOECOM_ACCOUNT_SETTING_KEYS.password] || "").trim();
  if (!isEnvioEcomAccountConfigured({ token, email, password })) return null;
  return {
    accountId: ENVIOECOM_TENANT_ACCOUNT_ID,
    name: "Conta da loja",
    token,
    email,
    password,
    originCep: digitsOnly(settings[ENVIOECOM_ACCOUNT_SETTING_KEYS.originCep]).slice(0, 8),
    fromEnv: false,
  };
}

export function assembleEnvioEcomAccounts(input: {
  tenantId: string;
  settings: Record<string, string>;
}): EnvioEcomAccountAuth[] {
  const extras = parseEnvioEcomExtrasJson(input.settings[ENVIOECOM_ACCOUNT_SETTING_KEYS.accounts]).map(extraAccountToAuth);
  const accounts: EnvioEcomAccountAuth[] = [];
  if (input.tenantId === ENVIOECOM_DEFAULT_TENANT_ID) {
    const envAccount = readEnvAccount(input.settings);
    if (envAccount) accounts.push(envAccount);
  }
  const tenantAccount = readTenantAccount(input.settings);
  if (tenantAccount) accounts.push(tenantAccount);
  accounts.push(...extras);
  return accounts;
}

export function pickWriteEnvioEcomAccount(
  accounts: EnvioEcomAccountAuth[],
  accountId?: string | null,
): { account: EnvioEcomAccountAuth } | { error: "NONE" | "NOT_FOUND" } {
  const configured = accounts.filter((account) => isEnvioEcomAccountConfigured(account));
  if (!configured.length) return { error: "NONE" };
  const requested = String(accountId || "").trim();
  if (!requested) return { account: configured[0] };
  const found = accounts.find((account) => account.accountId === requested);
  if (!found || !isEnvioEcomAccountConfigured(found)) return { error: "NOT_FOUND" };
  return { account: found };
}

export function orderEnvioEcomAccountsForFallback(
  accounts: EnvioEcomAccountAuth[],
  preferredId?: string | null,
): EnvioEcomAccountAuth[] {
  const configured = accounts.filter((account) => isEnvioEcomAccountConfigured(account));
  const preferred = String(preferredId || "").trim();
  const env = configured.filter((account) => account.accountId === ENVIOECOM_ENV_ACCOUNT_ID);
  const rest = configured.filter((account) => account.accountId !== ENVIOECOM_ENV_ACCOUNT_ID && account.accountId !== preferred);
  const preferredAccount = preferred
    ? configured.filter((account) => account.accountId === preferred)
    : [];
  const seen = new Set<string>();
  const ordered: EnvioEcomAccountAuth[] = [];
  for (const account of [...preferredAccount, ...env, ...rest]) {
    if (seen.has(account.accountId)) continue;
    seen.add(account.accountId);
    ordered.push(account);
  }
  return ordered;
}
