import { db, productsTable, tenantSettingsTable, tenantsTable } from "@workspace/db";
import { and, eq, inArray, isNull, like, ne, or } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";

export const TENANT_SYNC_PRODUCTS_FROM_LOJA1_KEY = "tenant_sync_products_from_loja1";
export const TENANT_SUPPLY_MARGIN_PERCENT_KEY = "tenant_supply_margin_percent";
export const TENANT_SUPPLY_MARGIN_FIXED_BRL_KEY = "tenant_supply_margin_fixed_brl";

type TenantSyncConfig = {
  tenantId: string;
  enabled: boolean;
  marginPercent: number;
  marginFixedBrl: number;
};

function parseBool(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "on", "yes", "enabled"].includes(normalized);
}

function parseNumber(value: string): number {
  const parsed = Number.parseFloat(String(value || "").replace(",", "."));
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatMoney(value: number): string {
  return round2(value).toFixed(2);
}

function buildLoja1ProductsWhere() {
  return or(
    eq(productsTable.tenantId, DEFAULT_TENANT_ID),
    isNull(productsTable.tenantId),
    eq(productsTable.tenantId, ""),
  );
}

function normalizeBulkDiscountTiersWithMargin(raw: unknown, marginPercent: number, marginFixedBrl: number): string | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const tiers = parsed
    .map((tier) => {
      const item = tier as Record<string, unknown>;
      const minQty = Number(item.minQty);
      const maxQtyRaw = item.maxQty;
      const maxQty = maxQtyRaw == null ? null : Number(maxQtyRaw);
      const unitPrice = Number(item.unitPrice);
      const label = item.label == null ? null : String(item.label);

      if (!Number.isFinite(minQty) || minQty < 1) return null;
      if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) return null;
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

      return {
        minQty,
        maxQty,
        unitPrice: round2(unitPrice * (1 + marginPercent / 100) + marginFixedBrl),
        label,
      };
    })
    .filter((tier) => Boolean(tier));

  if (tiers.length === 0) return null;
  return JSON.stringify(tiers);
}

function buildReplicatedProductId(sourceProductId: string, tenantId: string): string {
  return `loja1sync_${tenantId}_${sourceProductId}`;
}

async function getTenantSyncConfigs(tenantIds?: string[]): Promise<TenantSyncConfig[]> {
  const tenantRows = await db
    .select({ id: tenantsTable.id, status: tenantsTable.status })
    .from(tenantsTable)
    .where(
      tenantIds && tenantIds.length > 0
        ? and(inArray(tenantsTable.id, tenantIds), ne(tenantsTable.id, DEFAULT_TENANT_ID))
        : ne(tenantsTable.id, DEFAULT_TENANT_ID),
    );

  const validTenantIds = tenantRows
    .filter((row) => String(row.status || "").trim().toLowerCase() === "active")
    .map((row) => row.id);

  if (validTenantIds.length === 0) return [];

  const rows = await db
    .select({ tenantId: tenantSettingsTable.tenantId, key: tenantSettingsTable.key, value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(
      and(
        inArray(tenantSettingsTable.tenantId, validTenantIds),
        inArray(tenantSettingsTable.key, [
          TENANT_SYNC_PRODUCTS_FROM_LOJA1_KEY,
          TENANT_SUPPLY_MARGIN_PERCENT_KEY,
          TENANT_SUPPLY_MARGIN_FIXED_BRL_KEY,
        ]),
      ),
    );

  const byTenant = new Map<string, { enabled: boolean; marginPercent: number; marginFixedBrl: number }>();
  for (const tenantId of validTenantIds) {
    byTenant.set(tenantId, { enabled: false, marginPercent: 0, marginFixedBrl: 0 });
  }

  for (const row of rows) {
    const bucket = byTenant.get(row.tenantId);
    if (!bucket) continue;

    if (row.key === TENANT_SYNC_PRODUCTS_FROM_LOJA1_KEY) {
      bucket.enabled = parseBool(row.value);
      continue;
    }
    if (row.key === TENANT_SUPPLY_MARGIN_PERCENT_KEY) {
      bucket.marginPercent = Math.max(0, parseNumber(row.value));
      continue;
    }
    if (row.key === TENANT_SUPPLY_MARGIN_FIXED_BRL_KEY) {
      bucket.marginFixedBrl = Math.max(0, parseNumber(row.value));
    }
  }

  return validTenantIds.map((tenantId) => {
    const current = byTenant.get(tenantId)!;
    return {
      tenantId,
      enabled: current.enabled,
      marginPercent: current.marginPercent,
      marginFixedBrl: current.marginFixedBrl,
    };
  });
}

async function upsertReplicatedProduct(
  sourceProduct: typeof productsTable.$inferSelect,
  config: TenantSyncConfig,
): Promise<void> {
  const basePrice = Number(sourceProduct.price || 0);
  const baseCostPrice = sourceProduct.costPrice == null ? basePrice : Number(sourceProduct.costPrice || 0);
  const basePromoPrice = sourceProduct.promoPrice == null ? null : Number(sourceProduct.promoPrice || 0);
  const adjustedPrice = round2(basePrice * (1 + config.marginPercent / 100) + config.marginFixedBrl);
  const adjustedPromoPrice =
    basePromoPrice == null
      ? null
      : round2(basePromoPrice * (1 + config.marginPercent / 100) + config.marginFixedBrl);

  await db
    .insert(productsTable)
    .values({
      id: buildReplicatedProductId(sourceProduct.id, config.tenantId),
      tenantId: config.tenantId,
      name: sourceProduct.name,
      description: sourceProduct.description,
      category: sourceProduct.category,
      unit: sourceProduct.unit,
      price: formatMoney(adjustedPrice),
      costPrice: formatMoney(baseCostPrice),
      promoPrice: adjustedPromoPrice == null ? null : formatMoney(adjustedPromoPrice),
      promoEndsAt: sourceProduct.promoEndsAt,
      bulkDiscountEnabled: Boolean(sourceProduct.bulkDiscountEnabled),
      bulkDiscountTiers: normalizeBulkDiscountTiersWithMargin(
        sourceProduct.bulkDiscountTiers,
        config.marginPercent,
        config.marginFixedBrl,
      ),
      variantGroups: sourceProduct.variantGroups,
      image: sourceProduct.image,
      brand: sourceProduct.brand,
      isActive: Boolean(sourceProduct.isActive),
      isSoldOut: Boolean(sourceProduct.isSoldOut),
      isLaunch: Boolean(sourceProduct.isLaunch),
      sortOrder: Number(sourceProduct.sortOrder || 0),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        name: sourceProduct.name,
        description: sourceProduct.description,
        category: sourceProduct.category,
        unit: sourceProduct.unit,
        costPrice: formatMoney(baseCostPrice),
        variantGroups: sourceProduct.variantGroups,
        image: sourceProduct.image,
        brand: sourceProduct.brand,
        isActive: Boolean(sourceProduct.isActive),
        isSoldOut: Boolean(sourceProduct.isSoldOut),
        isLaunch: Boolean(sourceProduct.isLaunch),
        sortOrder: Number(sourceProduct.sortOrder || 0),
        updatedAt: new Date(),
      },
    });
}

export async function isTenantSyncFromLoja1Enabled(tenantId: string): Promise<boolean> {
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedTenantId || normalizedTenantId === DEFAULT_TENANT_ID) return false;

  const row = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, normalizedTenantId), eq(tenantSettingsTable.key, TENANT_SYNC_PRODUCTS_FROM_LOJA1_KEY)))
    .limit(1);

  return parseBool(String(row[0]?.value || ""));
}

export async function syncLoja1ProductToEnabledFiliais(productId: string): Promise<number> {
  const normalizedProductId = String(productId || "").trim();
  if (!normalizedProductId) return 0;

  const source = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, normalizedProductId), buildLoja1ProductsWhere()))
    .limit(1);

  const sourceProduct = source[0];
  if (!sourceProduct) return 0;

  const configs = (await getTenantSyncConfigs()).filter((cfg) => cfg.enabled);
  let synced = 0;
  for (const config of configs) {
    await upsertReplicatedProduct(sourceProduct, config);
    synced += 1;
  }

  return synced;
}

export async function syncAllLoja1ProductsToTenant(tenantId: string): Promise<number> {
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedTenantId || normalizedTenantId === DEFAULT_TENANT_ID) return 0;

  const [config] = await getTenantSyncConfigs([normalizedTenantId]);
  if (!config || !config.enabled) return 0;

  const sourceProducts = await db
    .select()
    .from(productsTable)
    .where(buildLoja1ProductsWhere());

  let synced = 0;
  for (const sourceProduct of sourceProducts) {
    await upsertReplicatedProduct(sourceProduct, config);
    synced += 1;
  }

  return synced;
}

export async function removeLoja1ProductFromEnabledFiliais(productId: string): Promise<number> {
  const normalizedProductId = String(productId || "").trim();
  if (!normalizedProductId) return 0;

  const source = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.id, normalizedProductId), buildLoja1ProductsWhere()))
    .limit(1);

  if (source.length === 0) return 0;

  const configs = (await getTenantSyncConfigs()).filter((cfg) => cfg.enabled);
  let removed = 0;
  for (const config of configs) {
    const replicatedId = buildReplicatedProductId(normalizedProductId, config.tenantId);
    const result = await db.delete(productsTable).where(and(eq(productsTable.id, replicatedId), eq(productsTable.tenantId, config.tenantId)));
    if (result) removed += 1;
  }

  return removed;
}

export async function removeAllLoja1ProductsFromTenant(tenantId: string): Promise<number> {
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedTenantId || normalizedTenantId === DEFAULT_TENANT_ID) return 0;

  const [config] = await getTenantSyncConfigs([normalizedTenantId]);
  if (!config) return 0;

  const replicatedPrefix = `loja1sync_${normalizedTenantId}_%`;
  const result = await db
    .delete(productsTable)
    .where(and(eq(productsTable.tenantId, normalizedTenantId), like(productsTable.id, replicatedPrefix)));

  return Number((result as { affectedRows?: number } | undefined)?.affectedRows || 0);
}
