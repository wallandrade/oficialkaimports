import crypto from "crypto";
import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import {
  db,
  motoboyCepRangesTable,
  motoboyNeighborhoodsTable,
  siteSettingsTable,
  tenantSettingsTable,
  tenantsTable,
} from "@workspace/db";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { normalizeMotoboyPlaceName } from "./motoboy-neighborhood-normalize";
import {
  getYuryMotoboyApiBase,
  getYuryMotoboySyncToken,
  isYuryMotoboySyncConfigured,
  LAST_SYNC_SETTING_KEY,
} from "./motoboy-yury-config";
import {
  parseYuryCepRangeCoverage,
  parseYuryCoveragePayload,
  parseYuryNeighborhoodCoverage,
  type YuryMotoboyCepRangeCoverage,
  type YuryMotoboyCoveragePayload,
  type YuryMotoboyNeighborhoodCoverage,
} from "./motoboy-yury-coverage";

export type MotoboyYurySyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  neighborhoods: number;
  cepRanges: number;
  deactivated: number;
  syncedAt: string;
};

function localCoverageId(kind: "n" | "r", tenantId: string, yuryId: string): string {
  return `yury_${kind}_${crypto.createHash("sha256").update(`${tenantId}|${yuryId}`).digest("hex").slice(0, 24)}`;
}

function parseRemoteDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function listActiveTenantIds(): Promise<string[]> {
  const rows = await db.select({ id: tenantsTable.id, status: tenantsTable.status }).from(tenantsTable);
  const ids = rows
    .filter((row) => String(row.status || "active").toLowerCase() === "active")
    .map((row) => String(row.id || "").trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : [DEFAULT_TENANT_ID];
}

async function saveLastSyncedAt(value: string): Promise<void> {
  const existing = await db
    .select({ key: tenantSettingsTable.key })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, DEFAULT_TENANT_ID), eq(tenantSettingsTable.key, LAST_SYNC_SETTING_KEY)))
    .limit(1);

  if (existing[0]) {
    await db.update(tenantSettingsTable)
      .set({ value, updatedAt: new Date() })
      .where(and(eq(tenantSettingsTable.tenantId, DEFAULT_TENANT_ID), eq(tenantSettingsTable.key, LAST_SYNC_SETTING_KEY)));
    return;
  }

  await db.insert(tenantSettingsTable).values({
    tenantId: DEFAULT_TENANT_ID,
    key: LAST_SYNC_SETTING_KEY,
    value,
    updatedAt: new Date(),
  });
}

export async function getMotoboyYuryLastSyncedAt(): Promise<string | null> {
  const tenantRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, DEFAULT_TENANT_ID), eq(tenantSettingsTable.key, LAST_SYNC_SETTING_KEY)))
    .limit(1);
  if (tenantRows[0]?.value) return String(tenantRows[0].value);
  const legacy = await db.select({ value: siteSettingsTable.value }).from(siteSettingsTable).where(eq(siteSettingsTable.key, LAST_SYNC_SETTING_KEY)).limit(1);
  return legacy[0]?.value ? String(legacy[0].value) : null;
}

export async function fetchYuryMotoboyCoverage(): Promise<YuryMotoboyCoveragePayload> {
  const token = getYuryMotoboySyncToken();
  if (!token) {
    throw new Error("YURY_MOTOBOY_SYNC_TOKEN ausente.");
  }

  const url = `${getYuryMotoboyApiBase()}/api/integrations/motoboy/coverage`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Api-Key": token,
      Accept: "application/json",
    },
  });

  if (response.status === 401) {
    throw new Error("Token de sync Yury inválido.");
  }
  if (response.status === 503) {
    throw new Error("Sync Motoboy desligado na Yury.");
  }
  if (!response.ok) {
    throw new Error(`Yury coverage HTTP ${response.status}`);
  }

  const payload = parseYuryCoveragePayload(await response.json());
  if (!payload) {
    throw new Error("Payload de cobertura Yury inválido.");
  }
  return payload;
}

async function upsertNeighborhoodForTenant(tenantId: string, item: YuryMotoboyNeighborhoodCoverage, syncedAt: Date): Promise<void> {
  const [byYury] = await db.select({ id: motoboyNeighborhoodsTable.id }).from(motoboyNeighborhoodsTable).where(and(
    eq(motoboyNeighborhoodsTable.tenantId, tenantId),
    eq(motoboyNeighborhoodsTable.yuryId, item.id),
  )).limit(1);

  let existingId: string | undefined = byYury?.id;
  if (!existingId) {
    const rows = await db.select({
      id: motoboyNeighborhoodsTable.id,
      neighborhoodName: motoboyNeighborhoodsTable.neighborhoodName,
      city: motoboyNeighborhoodsTable.city,
      yuryId: motoboyNeighborhoodsTable.yuryId,
    }).from(motoboyNeighborhoodsTable).where(and(
      eq(motoboyNeighborhoodsTable.tenantId, tenantId),
      isNull(motoboyNeighborhoodsTable.yuryId),
    ));
    const match = rows.find((row) => (
      normalizeMotoboyPlaceName(row.neighborhoodName) === normalizeMotoboyPlaceName(item.neighborhoodName)
      && normalizeMotoboyPlaceName(row.city) === normalizeMotoboyPlaceName(item.city)
    ));
    existingId = match?.id;
  }

  const values = {
    yuryId: item.id,
    neighborhoodName: item.neighborhoodName,
    city: item.city,
    price: item.price.toFixed(2),
    intervalHours: item.intervalHours,
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    notes: item.notes,
    remoteUpdatedAt: parseRemoteDate(item.updatedAt),
    syncedAt,
    updatedAt: syncedAt,
  };

  if (existingId) {
    await db.update(motoboyNeighborhoodsTable).set(values).where(and(
      eq(motoboyNeighborhoodsTable.tenantId, tenantId),
      eq(motoboyNeighborhoodsTable.id, existingId),
    ));
    return;
  }

  await db.insert(motoboyNeighborhoodsTable).values({
    id: localCoverageId("n", tenantId, item.id),
    tenantId,
    ...values,
  });
}

async function upsertCepRangeForTenant(tenantId: string, item: YuryMotoboyCepRangeCoverage, syncedAt: Date): Promise<void> {
  const [byYury] = await db.select({ id: motoboyCepRangesTable.id }).from(motoboyCepRangesTable).where(and(
    eq(motoboyCepRangesTable.tenantId, tenantId),
    eq(motoboyCepRangesTable.yuryId, item.id),
  )).limit(1);

  let existingId: string | undefined = byYury?.id;
  if (!existingId) {
    const [bySpan] = await db.select({ id: motoboyCepRangesTable.id }).from(motoboyCepRangesTable).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      eq(motoboyCepRangesTable.cepStart, item.cepStart),
      eq(motoboyCepRangesTable.cepEnd, item.cepEnd),
      isNull(motoboyCepRangesTable.yuryId),
    )).limit(1);
    existingId = bySpan?.id;
  }

  const values = {
    yuryId: item.id,
    label: item.label,
    city: item.city,
    cepStart: item.cepStart,
    cepEnd: item.cepEnd,
    price: item.price.toFixed(2),
    intervalHours: item.intervalHours,
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    notes: item.notes,
    remoteUpdatedAt: parseRemoteDate(item.updatedAt),
    syncedAt,
    updatedAt: syncedAt,
  };

  if (existingId) {
    await db.update(motoboyCepRangesTable).set(values).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      eq(motoboyCepRangesTable.id, existingId),
    ));
    return;
  }

  await db.insert(motoboyCepRangesTable).values({
    id: localCoverageId("r", tenantId, item.id),
    tenantId,
    ...values,
  });
}

function mysqlAffectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  if (!header || typeof header !== "object") return 0;
  return Number((header as { affectedRows?: unknown }).affectedRows || 0);
}

async function deactivateMissingNeighborhoods(tenantId: string, keepYuryIds: string[], syncedAt: Date): Promise<number> {
  const deactivate = { isActive: false, syncedAt, updatedAt: syncedAt };
  let count = 0;

  if (keepYuryIds.length > 0) {
    const stale = await db.update(motoboyNeighborhoodsTable).set(deactivate).where(and(
      eq(motoboyNeighborhoodsTable.tenantId, tenantId),
      isNotNull(motoboyNeighborhoodsTable.yuryId),
      notInArray(motoboyNeighborhoodsTable.yuryId, keepYuryIds),
    ));
    count += mysqlAffectedRows(stale);
  } else {
    const stale = await db.update(motoboyNeighborhoodsTable).set(deactivate).where(and(
      eq(motoboyNeighborhoodsTable.tenantId, tenantId),
      isNotNull(motoboyNeighborhoodsTable.yuryId),
    ));
    count += mysqlAffectedRows(stale);
  }

  const leftovers = await db.update(motoboyNeighborhoodsTable).set(deactivate).where(and(
    eq(motoboyNeighborhoodsTable.tenantId, tenantId),
    isNull(motoboyNeighborhoodsTable.yuryId),
  ));
  count += mysqlAffectedRows(leftovers);
  return count;
}

async function deactivateMissingCepRanges(tenantId: string, keepYuryIds: string[], syncedAt: Date): Promise<number> {
  const deactivate = { isActive: false, syncedAt, updatedAt: syncedAt };
  let count = 0;

  if (keepYuryIds.length > 0) {
    const stale = await db.update(motoboyCepRangesTable).set(deactivate).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      isNotNull(motoboyCepRangesTable.yuryId),
      notInArray(motoboyCepRangesTable.yuryId, keepYuryIds),
    ));
    count += mysqlAffectedRows(stale);
  } else {
    const stale = await db.update(motoboyCepRangesTable).set(deactivate).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      isNotNull(motoboyCepRangesTable.yuryId),
    ));
    count += mysqlAffectedRows(stale);
  }

  const leftovers = await db.update(motoboyCepRangesTable).set(deactivate).where(and(
    eq(motoboyCepRangesTable.tenantId, tenantId),
    isNull(motoboyCepRangesTable.yuryId),
  ));
  count += mysqlAffectedRows(leftovers);
  return count;
}

export async function applyYuryMotoboyCoverage(payload: YuryMotoboyCoveragePayload): Promise<MotoboyYurySyncResult> {
  const syncedAt = new Date();
  const tenantIds = await listActiveTenantIds();
  const keepNeighborhoodIds = payload.neighborhoods.map((item) => item.id);
  const keepRangeIds = payload.cepRanges.map((item) => item.id);
  let deactivated = 0;

  for (const tenantId of tenantIds) {
    for (const neighborhood of payload.neighborhoods) {
      await upsertNeighborhoodForTenant(tenantId, neighborhood, syncedAt);
    }
    for (const cepRange of payload.cepRanges) {
      await upsertCepRangeForTenant(tenantId, cepRange, syncedAt);
    }
    deactivated += await deactivateMissingNeighborhoods(tenantId, keepNeighborhoodIds, syncedAt);
    deactivated += await deactivateMissingCepRanges(tenantId, keepRangeIds, syncedAt);
  }

  const stamp = payload.syncedAt || syncedAt.toISOString();
  await saveLastSyncedAt(stamp);

  return {
    ok: true,
    neighborhoods: payload.neighborhoods.length,
    cepRanges: payload.cepRanges.length,
    deactivated,
    syncedAt: stamp,
  };
}

export async function upsertYuryNeighborhood(raw: unknown): Promise<void> {
  const item = parseYuryNeighborhoodCoverage(raw);
  if (!item) throw new Error("INVALID_EVENT");
  const syncedAt = new Date();
  for (const tenantId of await listActiveTenantIds()) {
    await upsertNeighborhoodForTenant(tenantId, item, syncedAt);
  }
}

export async function upsertYuryCepRange(raw: unknown): Promise<void> {
  const item = parseYuryCepRangeCoverage(raw);
  if (!item) throw new Error("INVALID_EVENT");
  const syncedAt = new Date();
  for (const tenantId of await listActiveTenantIds()) {
    await upsertCepRangeForTenant(tenantId, item, syncedAt);
  }
}

export async function deactivateYuryNeighborhood(yuryId: string, hardDelete: boolean): Promise<void> {
  const id = String(yuryId || "").trim();
  if (!id) return;
  const now = new Date();
  for (const tenantId of await listActiveTenantIds()) {
    if (hardDelete) {
      await db.delete(motoboyNeighborhoodsTable).where(and(
        eq(motoboyNeighborhoodsTable.tenantId, tenantId),
        eq(motoboyNeighborhoodsTable.yuryId, id),
      ));
      continue;
    }
    await db.update(motoboyNeighborhoodsTable).set({ isActive: false, syncedAt: now, updatedAt: now }).where(and(
      eq(motoboyNeighborhoodsTable.tenantId, tenantId),
      eq(motoboyNeighborhoodsTable.yuryId, id),
    ));
  }
}

export async function deactivateYuryCepRange(yuryId: string, hardDelete: boolean): Promise<void> {
  const id = String(yuryId || "").trim();
  if (!id) return;
  const now = new Date();
  for (const tenantId of await listActiveTenantIds()) {
    if (hardDelete) {
      await db.delete(motoboyCepRangesTable).where(and(
        eq(motoboyCepRangesTable.tenantId, tenantId),
        eq(motoboyCepRangesTable.yuryId, id),
      ));
      continue;
    }
    await db.update(motoboyCepRangesTable).set({ isActive: false, syncedAt: now, updatedAt: now }).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      eq(motoboyCepRangesTable.yuryId, id),
    ));
  }
}

export async function pullYuryMotoboyCoverage(): Promise<MotoboyYurySyncResult> {
  if (!isYuryMotoboySyncConfigured()) {
    return {
      ok: true,
      skipped: true,
      reason: "YURY_MOTOBOY_SYNC_TOKEN ausente",
      neighborhoods: 0,
      cepRanges: 0,
      deactivated: 0,
      syncedAt: new Date().toISOString(),
    };
  }

  const payload = await fetchYuryMotoboyCoverage();
  return applyYuryMotoboyCoverage(payload);
}

export function isMotoboyCoverageWriteLocked(): boolean {
  return isYuryMotoboySyncConfigured();
}
