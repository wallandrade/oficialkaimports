import { db, tenantSettingsTable } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import type { EnvioEcomPackageDefaults } from "./envioecom-package";
import { maskEmail, maskSecret } from "./envioecom-accounts-core";

export { maskEmail, maskSecret };

export const ENVIOECOM_SETTING_KEYS = {
  token: "envioecom_token",
  email: "envioecom_email",
  password: "envioecom_password",
  originCep: "envioecom_origin_cep",
  defaultWeight: "envioecom_default_weight",
  defaultLength: "envioecom_default_length",
  defaultHeight: "envioecom_default_height",
  defaultWidth: "envioecom_default_width",
  carriers: "envioecom_carriers",
  shipmentItemName: "envioecom_shipment_item_name",
  shipmentItemQuantity: "envioecom_shipment_item_quantity",
  shipmentItemUnitCost: "envioecom_shipment_item_unit_cost",
  accounts: "envioecom_accounts",
} as const;

export const ENVIOECOM_DEFAULT_SHIPMENT_ITEM_NAME = "Mercadoria";
export const ENVIOECOM_DEFAULT_SHIPMENT_ITEM_QUANTITY = 1;
export const ENVIOECOM_DEFAULT_SHIPMENT_ITEM_UNIT_COST = 5;

export type EnvioEcomTenantConfig = {
  configured: boolean;
  token: string;
  email: string;
  password: string;
  originCep: string;
  carriers: string[];
  defaults: EnvioEcomPackageDefaults;
  shipmentItemName: string;
  shipmentItemQuantity: number;
  shipmentItemUnitCost: number;
  baseUrl: string;
  neverExpires: boolean;
};

export function buildTenantSettingsWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(
      eq(tenantSettingsTable.tenantId, tenantId),
      isNull(tenantSettingsTable.tenantId),
      eq(tenantSettingsTable.tenantId, ""),
    );
  }
  return eq(tenantSettingsTable.tenantId, tenantId);
}

export async function getTenantSettingsMap(tenantId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(tenantSettingsTable)
    .where(buildTenantSettingsWhere(tenantId));
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

function digitsOnly(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCarriers(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeShipmentItemName(value: unknown): string {
  const trimmed = String(value || "").trim().slice(0, 120);
  return trimmed || ENVIOECOM_DEFAULT_SHIPMENT_ITEM_NAME;
}

function parseLooseDecimal(value: unknown): number {
  const raw = String(value ?? "").trim().replace(/[R$\s]/gi, "");
  if (!raw) return NaN;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function normalizeShipmentItemQuantity(value: unknown): number {
  const parsed = Math.trunc(parseLooseDecimal(value));
  if (!Number.isFinite(parsed) || parsed < 1) return ENVIOECOM_DEFAULT_SHIPMENT_ITEM_QUANTITY;
  return Math.min(parsed, 99);
}

export function normalizeShipmentItemUnitCost(value: unknown): number {
  const parsed = parseLooseDecimal(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return ENVIOECOM_DEFAULT_SHIPMENT_ITEM_UNIT_COST;
  return Math.min(Math.round(parsed * 100) / 100, 3000);
}

function looksLikeEmailPasswordMix(token: string): boolean {
  return token.includes(":") || token.includes("@");
}

export async function loadEnvioEcomConfig(tenantId: string): Promise<EnvioEcomTenantConfig> {
  const settings = await getTenantSettingsMap(tenantId);
  const isDefaultTenant = tenantId === DEFAULT_TENANT_ID;
  const token = String(settings[ENVIOECOM_SETTING_KEYS.token] || (isDefaultTenant ? process.env.ENVIOECOM_TOKEN : "") || "").trim();
  const email = String(settings[ENVIOECOM_SETTING_KEYS.email] || (isDefaultTenant ? process.env.ENVIOECOM_EMAIL : "") || "").trim();
  const password = String(settings[ENVIOECOM_SETTING_KEYS.password] || (isDefaultTenant ? process.env.ENVIOECOM_PASSWORD : "") || "").trim();
  const originCep = digitsOnly(settings[ENVIOECOM_SETTING_KEYS.originCep] || (isDefaultTenant ? process.env.ENVIOECOM_ORIGIN_CEP : "") || "").slice(0, 8);
  const carriers = parseCarriers(settings[ENVIOECOM_SETTING_KEYS.carriers] || (isDefaultTenant ? process.env.ENVIOECOM_CARRIERS : "") || "");
  const safeToken = looksLikeEmailPasswordMix(token) ? "" : token;

  return {
    configured: !!(safeToken || (email && password)),
    token: safeToken,
    email,
    password,
    originCep,
    carriers,
    defaults: {
      weightKg: parseNumber(settings[ENVIOECOM_SETTING_KEYS.defaultWeight] || process.env.ENVIOECOM_DEFAULT_WEIGHT, 0.3),
      lengthCm: parseNumber(settings[ENVIOECOM_SETTING_KEYS.defaultLength] || process.env.ENVIOECOM_DEFAULT_LENGTH, 17),
      heightCm: parseNumber(settings[ENVIOECOM_SETTING_KEYS.defaultHeight] || process.env.ENVIOECOM_DEFAULT_HEIGHT, 2),
      widthCm: parseNumber(settings[ENVIOECOM_SETTING_KEYS.defaultWidth] || process.env.ENVIOECOM_DEFAULT_WIDTH, 12),
    },
    shipmentItemName: normalizeShipmentItemName(settings[ENVIOECOM_SETTING_KEYS.shipmentItemName]),
    shipmentItemQuantity: normalizeShipmentItemQuantity(settings[ENVIOECOM_SETTING_KEYS.shipmentItemQuantity]),
    shipmentItemUnitCost: normalizeShipmentItemUnitCost(settings[ENVIOECOM_SETTING_KEYS.shipmentItemUnitCost]),
    baseUrl: String(process.env.ENVIOECOM_BASE_URL || "https://envioecom.com.br/api/v1/whitelabel").replace(/\/$/, ""),
    neverExpires: String(process.env.ENVIOECOM_TOKEN_NEVER_EXPIRES || "true").toLowerCase() !== "false",
  };
}

export async function saveEnvioEcomConfig(tenantId: string, patch: {
  token?: string | null;
  email?: string | null;
  password?: string | null;
  originCep?: string | null;
  defaultWeight?: string | number | null;
  defaultLength?: string | number | null;
  defaultHeight?: string | number | null;
  defaultWidth?: string | number | null;
  carriers?: string[] | string | null;
  shipmentItemName?: string | null;
  shipmentItemQuantity?: string | number | null;
  shipmentItemUnitCost?: string | number | null;
}): Promise<void> {
  const entries: Array<[string, string | null | undefined]> = [
    [ENVIOECOM_SETTING_KEYS.token, patch.token === undefined ? undefined : String(patch.token || "").trim()],
    [ENVIOECOM_SETTING_KEYS.email, patch.email === undefined ? undefined : String(patch.email || "").trim()],
    [ENVIOECOM_SETTING_KEYS.password, patch.password === undefined ? undefined : String(patch.password || "").trim()],
    [ENVIOECOM_SETTING_KEYS.originCep, patch.originCep === undefined ? undefined : digitsOnly(patch.originCep).slice(0, 8)],
    [ENVIOECOM_SETTING_KEYS.defaultWeight, patch.defaultWeight === undefined ? undefined : String(patch.defaultWeight ?? "").trim()],
    [ENVIOECOM_SETTING_KEYS.defaultLength, patch.defaultLength === undefined ? undefined : String(patch.defaultLength ?? "").trim()],
    [ENVIOECOM_SETTING_KEYS.defaultHeight, patch.defaultHeight === undefined ? undefined : String(patch.defaultHeight ?? "").trim()],
    [ENVIOECOM_SETTING_KEYS.defaultWidth, patch.defaultWidth === undefined ? undefined : String(patch.defaultWidth ?? "").trim()],
    [ENVIOECOM_SETTING_KEYS.carriers, patch.carriers === undefined ? undefined : (Array.isArray(patch.carriers) ? patch.carriers.join(",") : String(patch.carriers || "")).trim()],
    [ENVIOECOM_SETTING_KEYS.shipmentItemName, patch.shipmentItemName === undefined ? undefined : normalizeShipmentItemName(patch.shipmentItemName)],
    [ENVIOECOM_SETTING_KEYS.shipmentItemQuantity, patch.shipmentItemQuantity === undefined ? undefined : String(normalizeShipmentItemQuantity(patch.shipmentItemQuantity))],
    [ENVIOECOM_SETTING_KEYS.shipmentItemUnitCost, patch.shipmentItemUnitCost === undefined ? undefined : String(normalizeShipmentItemUnitCost(patch.shipmentItemUnitCost))],
  ];

  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (!value) {
      await db.delete(tenantSettingsTable).where(and(buildTenantSettingsWhere(tenantId), eq(tenantSettingsTable.key, key)));
      continue;
    }
    await db
      .insert(tenantSettingsTable)
      .values({ tenantId, key, value, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
  }
}

export async function upsertTenantSetting(tenantId: string, key: string, value: string | null | undefined): Promise<void> {
  if (value === undefined) return;
  const next = String(value || "").trim();
  if (!next) {
    await db.delete(tenantSettingsTable).where(and(buildTenantSettingsWhere(tenantId), eq(tenantSettingsTable.key, key)));
    return;
  }
  await db
    .insert(tenantSettingsTable)
    .values({ tenantId, key, value: next, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { value: next, updatedAt: new Date() } });
}
