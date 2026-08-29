import { randomUUID } from "node:crypto";
import { db, tenantSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  ENVIOECOM_ENV_ACCOUNT_ID,
  ENVIOECOM_TENANT_ACCOUNT_ID,
  assembleEnvioEcomAccounts,
  extraAccountToAuth,
  isEnvioEcomAccountConfigured,
  parseEnvioEcomExtrasJson,
  type EnvioEcomAccountAuth,
  type ExtraAccountRow,
} from "./envioecom-accounts-core";
import {
  ENVIOECOM_SETTING_KEYS,
  buildTenantSettingsWhere,
  getTenantSettingsMap,
  upsertTenantSetting,
} from "./envioecom-config";
import { createEnvioEcomClient, EnvioEcomApiError, type EnvioEcomClient } from "./envioecom-client";

export {
  ENVIOECOM_ENV_ACCOUNT_ID,
  ENVIOECOM_TENANT_ACCOUNT_ID,
  assembleEnvioEcomAccounts,
  isEnvioEcomAccountConfigured,
  orderEnvioEcomAccountsForFallback,
  parseEnvioEcomExtrasJson,
  pickWriteEnvioEcomAccount,
  toPublicEnvioEcomAccount,
  type EnvioEcomAccountAuth,
  type EnvioEcomAccountPublic,
} from "./envioecom-accounts-core";

function digitsOnly(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export async function listEnvioEcomAccounts(tenantId: string): Promise<EnvioEcomAccountAuth[]> {
  const settings = await getTenantSettingsMap(tenantId);
  return assembleEnvioEcomAccounts({ tenantId, settings });
}

export async function getEnvioEcomAccount(tenantId: string, accountId: string): Promise<EnvioEcomAccountAuth | null> {
  const id = String(accountId || "").trim();
  if (!id) return null;
  const accounts = await listEnvioEcomAccounts(tenantId);
  return accounts.find((account) => account.accountId === id) || null;
}

async function saveExtras(tenantId: string, extras: ExtraAccountRow[]): Promise<void> {
  await db
    .insert(tenantSettingsTable)
    .values({
      tenantId,
      key: ENVIOECOM_SETTING_KEYS.accounts,
      value: JSON.stringify(extras),
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({ set: { value: JSON.stringify(extras), updatedAt: new Date() } });
}

async function loadExtras(tenantId: string): Promise<ExtraAccountRow[]> {
  const settings = await getTenantSettingsMap(tenantId);
  return parseEnvioEcomExtrasJson(settings[ENVIOECOM_SETTING_KEYS.accounts]);
}

export type EnvioEcomAccountPatch = {
  name?: string;
  token?: string | null;
  email?: string | null;
  password?: string | null;
  originCep?: string | null;
};

function requireAuthOrKeep(current: { token: string; email: string; password: string }, patch: EnvioEcomAccountPatch, isCreate: boolean) {
  const token = patch.token === undefined || patch.token === "" ? current.token : String(patch.token || "").trim();
  const email = patch.email === undefined ? current.email : String(patch.email || "").trim();
  const password = patch.password === undefined || patch.password === ""
    ? current.password
    : String(patch.password || "").trim();
  if (isCreate && !isEnvioEcomAccountConfigured({ token, email, password })) {
    throw new EnvioEcomApiError("INVALID_INPUT", "Informe token permanente ou e-mail e senha.", 400);
  }
  return { token, email, password };
}

export async function createEnvioEcomExtraAccount(tenantId: string, patch: EnvioEcomAccountPatch): Promise<EnvioEcomAccountAuth> {
  const extras = await loadExtras(tenantId);
  const name = String(patch.name || "").trim() || `Conta ${extras.length + 1}`;
  const auth = requireAuthOrKeep({ token: "", email: "", password: "" }, patch, true);
  const originCep = digitsOnly(patch.originCep).slice(0, 8);
  const now = new Date().toISOString();
  const row: ExtraAccountRow = {
    id: randomUUID(),
    name,
    token: auth.token,
    email: auth.email,
    password: auth.password,
    originCep,
    createdAt: now,
    updatedAt: now,
  };
  extras.push(row);
  await saveExtras(tenantId, extras);
  return extraAccountToAuth(row);
}

export async function updateEnvioEcomAccount(
  tenantId: string,
  accountId: string,
  patch: EnvioEcomAccountPatch,
): Promise<EnvioEcomAccountAuth> {
  const id = String(accountId || "").trim();
  if (id === ENVIOECOM_ENV_ACCOUNT_ID) {
    throw new EnvioEcomApiError("FORBIDDEN", "A conta do servidor só pode ser alterada no deploy.", 403);
  }

  if (id === ENVIOECOM_TENANT_ACCOUNT_ID) {
    const current = await getEnvioEcomAccount(tenantId, id);
    if (!current) {
      throw new EnvioEcomApiError("NOT_FOUND", "Conta EnvioEcom não encontrada.", 404);
    }
    const next = requireAuthOrKeep(current, patch, false);
    if (patch.token !== undefined && String(patch.token || "").trim()) {
      await upsertTenantSetting(tenantId, ENVIOECOM_SETTING_KEYS.token, next.token);
    }
    if (patch.email !== undefined && String(patch.email || "").trim()) {
      await upsertTenantSetting(tenantId, ENVIOECOM_SETTING_KEYS.email, next.email);
    }
    if (patch.password !== undefined && String(patch.password || "").trim()) {
      await upsertTenantSetting(tenantId, ENVIOECOM_SETTING_KEYS.password, next.password);
    }
    if (patch.originCep !== undefined && digitsOnly(patch.originCep)) {
      await upsertTenantSetting(tenantId, ENVIOECOM_SETTING_KEYS.originCep, digitsOnly(patch.originCep).slice(0, 8));
    }
    const updated = await getEnvioEcomAccount(tenantId, id);
    if (!updated) throw new EnvioEcomApiError("NOT_FOUND", "Conta EnvioEcom não encontrada.", 404);
    return updated;
  }

  const extras = await loadExtras(tenantId);
  const index = extras.findIndex((row) => row.id === id);
  if (index < 0) {
    throw new EnvioEcomApiError("NOT_FOUND", "Conta EnvioEcom não encontrada.", 404);
  }
  const current = extras[index];
  const next = requireAuthOrKeep(current, patch, false);
  extras[index] = {
    ...current,
    name: patch.name === undefined ? current.name : (String(patch.name || "").trim() || current.name),
    token: patch.token === undefined || patch.token === "" ? current.token : next.token,
    email: patch.email === undefined ? current.email : next.email,
    password: patch.password === undefined || patch.password === "" ? current.password : next.password,
    originCep: patch.originCep === undefined || !digitsOnly(patch.originCep)
      ? current.originCep
      : digitsOnly(patch.originCep).slice(0, 8),
    updatedAt: new Date().toISOString(),
  };
  await saveExtras(tenantId, extras);
  return extraAccountToAuth(extras[index]);
}

export async function deleteEnvioEcomAccount(tenantId: string, accountId: string): Promise<void> {
  const id = String(accountId || "").trim();
  if (id === ENVIOECOM_ENV_ACCOUNT_ID) {
    throw new EnvioEcomApiError("FORBIDDEN", "A conta do servidor não pode ser apagada no painel.", 403);
  }
  if (id === ENVIOECOM_TENANT_ACCOUNT_ID) {
    await db.delete(tenantSettingsTable).where(and(
      buildTenantSettingsWhere(tenantId),
      eq(tenantSettingsTable.key, ENVIOECOM_SETTING_KEYS.token),
    ));
    await db.delete(tenantSettingsTable).where(and(
      buildTenantSettingsWhere(tenantId),
      eq(tenantSettingsTable.key, ENVIOECOM_SETTING_KEYS.email),
    ));
    await db.delete(tenantSettingsTable).where(and(
      buildTenantSettingsWhere(tenantId),
      eq(tenantSettingsTable.key, ENVIOECOM_SETTING_KEYS.password),
    ));
    return;
  }
  const extras = await loadExtras(tenantId);
  const next = extras.filter((row) => row.id !== id);
  if (next.length === extras.length) {
    throw new EnvioEcomApiError("NOT_FOUND", "Conta EnvioEcom não encontrada.", 404);
  }
  await saveExtras(tenantId, next);
}

export function createEnvioEcomClientForAccount(tenantId: string, account: EnvioEcomAccountAuth): EnvioEcomClient {
  const baseUrl = String(process.env.ENVIOECOM_BASE_URL || "https://envioecom.com.br/api/v1/whitelabel").replace(/\/$/, "");
  const neverExpires = String(process.env.ENVIOECOM_TOKEN_NEVER_EXPIRES || "true").toLowerCase() !== "false";
  return createEnvioEcomClient({
    tenantId,
    accountId: account.accountId,
    baseUrl,
    token: account.token,
    email: account.email,
    password: account.password,
    neverExpires,
  });
}

export async function hasAnyEnvioEcomAccount(tenantId: string): Promise<boolean> {
  const accounts = await listEnvioEcomAccounts(tenantId);
  return accounts.some((account) => isEnvioEcomAccountConfigured(account));
}

export async function getEnvioEcomAccountNameMap(tenantId: string): Promise<Record<string, string>> {
  const accounts = await listEnvioEcomAccounts(tenantId);
  const map: Record<string, string> = {};
  for (const account of accounts) map[account.accountId] = account.name;
  return map;
}
