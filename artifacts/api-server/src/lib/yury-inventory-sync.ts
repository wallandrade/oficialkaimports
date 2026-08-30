import { and, eq } from "drizzle-orm";
import { db, tenantSettingsTable, yuryInventoryBalancesTable } from "@workspace/db";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import {
  getYuryInventorySyncToken,
  getYuryMotoboyApiBase,
  isYuryInventorySyncConfigured,
  LAST_INVENTORY_SYNC_SETTING_KEY,
} from "./motoboy-yury-config";
import {
  applyYuryInventoryWebhookBalances,
  mergeYuryInventorySnapshot,
  parseYuryInventorySnapshot,
  type YuryInventoryLocalRow,
  type YuryInventorySnapshot,
} from "./yury-inventory";

export type YuryInventorySyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  products: number;
  zeroedMissing: number;
  syncedAt: string;
};

async function saveLastSyncedAt(value: string): Promise<void> {
  await db.insert(tenantSettingsTable).values({
    tenantId: DEFAULT_TENANT_ID,
    key: LAST_INVENTORY_SYNC_SETTING_KEY,
    value,
    updatedAt: new Date(),
  }).onDuplicateKeyUpdate({
    set: { value, updatedAt: new Date() },
  });
}

export async function getYuryInventoryLastSyncedAt(): Promise<string | null> {
  const [row] = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(
      eq(tenantSettingsTable.tenantId, DEFAULT_TENANT_ID),
      eq(tenantSettingsTable.key, LAST_INVENTORY_SYNC_SETTING_KEY),
    ))
    .limit(1);
  return row?.value ? String(row.value) : null;
}

async function listLocalRows(): Promise<YuryInventoryLocalRow[]> {
  const rows = await db.select({
    productId: yuryInventoryBalancesTable.productId,
    productName: yuryInventoryBalancesTable.productName,
    qtyMotoboy: yuryInventoryBalancesTable.qtyMotoboy,
    qtyMinas: yuryInventoryBalancesTable.qtyMinas,
  }).from(yuryInventoryBalancesTable);
  return rows.map((row) => ({
    productId: String(row.productId),
    productName: String(row.productName || row.productId),
    qtyMotoboy: Number(row.qtyMotoboy) || 0,
    qtyMinas: Number(row.qtyMinas) || 0,
  }));
}

async function persistRows(rows: YuryInventoryLocalRow[], syncedAt: Date): Promise<void> {
  for (const row of rows) {
    await db.insert(yuryInventoryBalancesTable).values({
      productId: row.productId,
      productName: row.productName,
      qtyMotoboy: row.qtyMotoboy,
      qtyMinas: row.qtyMinas,
      syncedAt,
      updatedAt: syncedAt,
    }).onDuplicateKeyUpdate({
      set: {
        productName: row.productName,
        qtyMotoboy: row.qtyMotoboy,
        qtyMinas: row.qtyMinas,
        syncedAt,
        updatedAt: syncedAt,
      },
    });
  }
}

export async function fetchYuryInventorySnapshot(): Promise<YuryInventorySnapshot> {
  const token = getYuryInventorySyncToken();
  if (!token) {
    throw new Error("YURY_MOTOBOY_SYNC_TOKEN ausente.");
  }

  const url = `${getYuryMotoboyApiBase()}/api/integrations/inventory/snapshot`;
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
    throw new Error("Sync de estoque desligado na Yury.");
  }
  if (!response.ok) {
    throw new Error(`Yury inventory HTTP ${response.status}`);
  }

  const payload = parseYuryInventorySnapshot(await response.json());
  if (!payload) {
    throw new Error("Payload de estoque Yury inválido.");
  }
  return payload;
}

export async function applyYuryInventorySnapshot(payload: YuryInventorySnapshot): Promise<YuryInventorySyncResult> {
  const existing = await listLocalRows();
  const merged = mergeYuryInventorySnapshot(existing, payload);
  const snapshotIds = new Set([
    ...payload.motoboy.map((item) => item.productId),
    ...payload.minas.map((item) => item.productId),
  ]);
  const zeroedMissing = merged.filter((row) => !snapshotIds.has(row.productId)).length;
  const syncedAt = new Date();
  await persistRows(merged, syncedAt);
  const stamp = payload.syncedAt || syncedAt.toISOString();
  await saveLastSyncedAt(stamp);
  return {
    ok: true,
    products: snapshotIds.size,
    zeroedMissing,
    syncedAt: stamp,
  };
}

export async function pullYuryInventorySnapshot(): Promise<YuryInventorySyncResult> {
  if (!isYuryInventorySyncConfigured()) {
    return {
      ok: true,
      skipped: true,
      reason: "Token de sync Yury ausente",
      products: 0,
      zeroedMissing: 0,
      syncedAt: new Date().toISOString(),
    };
  }
  const payload = await fetchYuryInventorySnapshot();
  return applyYuryInventorySnapshot(payload);
}

export async function upsertYuryInventoryFromWebhook(input: {
  productId: string;
  productName?: string;
  balances: { motoboy: number; minas: number };
}): Promise<void> {
  const [existing] = await db.select({
    productId: yuryInventoryBalancesTable.productId,
    productName: yuryInventoryBalancesTable.productName,
    qtyMotoboy: yuryInventoryBalancesTable.qtyMotoboy,
    qtyMinas: yuryInventoryBalancesTable.qtyMinas,
  }).from(yuryInventoryBalancesTable).where(eq(yuryInventoryBalancesTable.productId, input.productId)).limit(1);

  const next = applyYuryInventoryWebhookBalances(existing ? {
    productId: String(existing.productId),
    productName: String(existing.productName || existing.productId),
    qtyMotoboy: Number(existing.qtyMotoboy) || 0,
    qtyMinas: Number(existing.qtyMinas) || 0,
  } : null, input);
  const now = new Date();
  await persistRows([next], now);
}

export async function listYuryInventoryBalances(): Promise<YuryInventoryLocalRow[]> {
  const rows = await listLocalRows();
  return rows.slice().sort((a, b) => {
    const aPositive = a.qtyMotoboy > 0 || a.qtyMinas > 0 ? 1 : 0;
    const bPositive = b.qtyMotoboy > 0 || b.qtyMinas > 0 ? 1 : 0;
    if (aPositive !== bPositive) return bPositive - aPositive;
    return a.productName.localeCompare(b.productName, "pt-BR");
  });
}
