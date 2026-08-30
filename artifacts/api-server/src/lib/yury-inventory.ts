export type YuryInventoryItem = {
  productId: string;
  productName: string;
  quantity: number;
};

export type YuryInventorySnapshot = {
  syncedAt: string | null;
  source: string | null;
  motoboy: YuryInventoryItem[];
  minas: YuryInventoryItem[];
};

export type YuryInventoryLocalRow = {
  productId: string;
  productName: string;
  qtyMotoboy: number;
  qtyMinas: number;
};

export type YuryInventoryChangedEvent = {
  eventId: string;
  eventType: "inventory.changed";
  occurredAt: string | null;
  source: string | null;
  data: {
    productId: string;
    productName: string;
    pool: string | null;
    balances: { motoboy: number; minas: number };
  };
};

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function asNullableString(value: unknown): string | null {
  const text = asString(value);
  return text ? text : null;
}

function asQuantity(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

export function parseYuryInventoryItem(raw: unknown): YuryInventoryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const productId = asString(record.productId);
  const quantity = asQuantity(record.quantity);
  if (!productId || quantity == null) return null;
  return {
    productId,
    productName: asString(record.productName) || productId,
    quantity,
  };
}

function parsePool(raw: unknown): YuryInventoryItem[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, YuryInventoryItem>();
  for (const item of raw) {
    const parsed = parseYuryInventoryItem(item);
    if (!parsed) continue;
    byId.set(parsed.productId, parsed);
  }
  return [...byId.values()];
}

export function parseYuryInventorySnapshot(raw: unknown): YuryInventorySnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.motoboy) || !Array.isArray(record.minas)) return null;
  return {
    syncedAt: asNullableString(record.syncedAt),
    source: asNullableString(record.source),
    motoboy: parsePool(record.motoboy),
    minas: parsePool(record.minas),
  };
}

export function mergeYuryInventorySnapshot(
  existing: YuryInventoryLocalRow[],
  snapshot: Pick<YuryInventorySnapshot, "motoboy" | "minas">,
): YuryInventoryLocalRow[] {
  const motoboyById = new Map(snapshot.motoboy.map((item) => [item.productId, item]));
  const minasById = new Map(snapshot.minas.map((item) => [item.productId, item]));
  const existingById = new Map(existing.map((row) => [row.productId, row]));
  const seen = new Set([...motoboyById.keys(), ...minasById.keys()]);
  const merged: YuryInventoryLocalRow[] = [];

  for (const productId of seen) {
    const motoboy = motoboyById.get(productId);
    const minas = minasById.get(productId);
    const prev = existingById.get(productId);
    merged.push({
      productId,
      productName: motoboy?.productName || minas?.productName || prev?.productName || productId,
      qtyMotoboy: motoboy ? motoboy.quantity : 0,
      qtyMinas: minas ? minas.quantity : 0,
    });
  }

  for (const prev of existing) {
    if (seen.has(prev.productId)) continue;
    merged.push({
      productId: prev.productId,
      productName: prev.productName,
      qtyMotoboy: 0,
      qtyMinas: 0,
    });
  }

  return merged;
}

export function applyYuryInventoryWebhookBalances(
  existing: YuryInventoryLocalRow | null,
  data: { productId: string; productName?: string; balances: { motoboy: number; minas: number } },
): YuryInventoryLocalRow {
  return {
    productId: data.productId,
    productName: asString(data.productName) || existing?.productName || data.productId,
    qtyMotoboy: data.balances.motoboy,
    qtyMinas: data.balances.minas,
  };
}

export function parseYuryInventoryChangedEvent(raw: unknown): YuryInventoryChangedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const eventId = asString(record.eventId);
  const eventType = asString(record.eventType);
  if (!eventId || eventType !== "inventory.changed") return null;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const productId = asString(data.productId);
  const balancesRaw = data.balances && typeof data.balances === "object" ? data.balances as Record<string, unknown> : null;
  const motoboy = asQuantity(balancesRaw?.motoboy);
  const minas = asQuantity(balancesRaw?.minas);
  if (!productId || motoboy == null || minas == null) return null;
  return {
    eventId,
    eventType: "inventory.changed",
    occurredAt: asNullableString(record.occurredAt),
    source: asNullableString(record.source),
    data: {
      productId,
      productName: asString(data.productName) || productId,
      pool: asNullableString(data.pool),
      balances: { motoboy, minas },
    },
  };
}
