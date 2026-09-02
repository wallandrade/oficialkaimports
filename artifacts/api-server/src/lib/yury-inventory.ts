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

export type YuryInventoryPool = "motoboy" | "minas";
export type KaInventoryExitPool = "loja" | YuryInventoryPool;

export type YuryInventoryExitItem = {
  productId: string;
  quantity: number;
};

export type YuryInventoryExitBody = {
  pool: YuryInventoryPool;
  items: YuryInventoryExitItem[];
  referenceId: string;
  reason?: string;
};

export type YuryInventoryExitInterpretation =
  | { ok: true; alreadyDebited: boolean }
  | { ok: false; code: string; message: string };

function normalizeShippingText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function normalizeYuryProductName(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveYuryInventoryExitPool(order: {
  shippingType?: unknown;
  motoboyDeliveryDate?: unknown;
  motoboyDeliveryTime?: unknown;
}): YuryInventoryPool | null {
  const shipping = normalizeShippingText(order.shippingType);
  if (shipping.includes("motoboy")) return "motoboy";
  if (shipping.includes("minas")) return "minas";
  if (shipping.includes("retirada") || shipping.includes("pickup")) return null;
  if (String(order.motoboyDeliveryDate || "").trim() && String(order.motoboyDeliveryTime || "").trim()) {
    return "motoboy";
  }
  return null;
}

export function parseKaInventoryExitPool(value: unknown): KaInventoryExitPool | null {
  const normalized = normalizeShippingText(value).replace(/_/g, " ");
  if (normalized === "loja" || normalized === "foz" || normalized.includes("foz")) return "loja";
  if (normalized === "motoboy") return "motoboy";
  if (normalized === "minas") return "minas";
  return null;
}

export function defaultKaInventoryExitPool(order: {
  shippingType?: unknown;
  motoboyDeliveryDate?: unknown;
  motoboyDeliveryTime?: unknown;
  inventoryExitPool?: unknown;
}): KaInventoryExitPool {
  return parseKaInventoryExitPool(order.inventoryExitPool) || resolveYuryInventoryExitPool(order) || "loja";
}

export function parseKaInventoryExitedPools(value: unknown): KaInventoryExitPool[] {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const seen = new Set<KaInventoryExitPool>();
  const pools: KaInventoryExitPool[] = [];
  for (const item of raw) {
    const parsed = parseKaInventoryExitPool(item);
    if (!parsed || seen.has(parsed)) continue;
    seen.add(parsed);
    pools.push(parsed);
  }
  return pools;
}

export function serializeKaInventoryExitedPools(pools: KaInventoryExitPool[]): string {
  return parseKaInventoryExitedPools(pools).join(",");
}

export function addKaInventoryExitedPool(
  current: unknown,
  pool: KaInventoryExitPool,
): KaInventoryExitPool[] {
  return parseKaInventoryExitedPools([...parseKaInventoryExitedPools(current), pool]);
}

export function mapKaItemsToYuryExitItems(
  items: Array<{ productId: string | null; productName: string; quantity: number }>,
  yuryRows: Array<{ productId: string; productName: string }>,
): { ok: true; items: YuryInventoryExitItem[] } | { ok: false; missing: string[] } {
  const byId = new Map(yuryRows.map((row) => [row.productId, row]));
  const byName = new Map<string, { productId: string; productName: string }>();
  for (const row of yuryRows) {
    const name = normalizeYuryProductName(row.productName);
    if (name && !byName.has(name)) byName.set(name, row);
  }

  const missing: string[] = [];
  const grouped = new Map<string, number>();

  for (const item of items) {
    const quantity = Math.trunc(Number(item.quantity) || 0);
    if (quantity <= 0) continue;
    const byItemId = item.productId ? byId.get(item.productId) : undefined;
    const byItemName = byName.get(normalizeYuryProductName(item.productName));
    const matched = byItemId || byItemName;
    if (!matched) {
      missing.push(item.productName);
      continue;
    }
    grouped.set(matched.productId, (grouped.get(matched.productId) || 0) + quantity);
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  const mapped = [...grouped.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .filter((item) => item.quantity > 0);

  return { ok: true, items: mapped };
}

export function buildYuryInventoryExitBody(input: {
  pool: YuryInventoryPool;
  items: YuryInventoryExitItem[];
  referenceId: string;
  reason?: string;
}): YuryInventoryExitBody {
  const body: YuryInventoryExitBody = {
    pool: input.pool,
    items: input.items.map((item) => ({
      productId: item.productId,
      quantity: Math.trunc(item.quantity),
    })),
    referenceId: String(input.referenceId || "").trim(),
  };
  const reason = String(input.reason || "").trim();
  if (reason) body.reason = reason;
  return body;
}

export function interpretYuryInventoryExitResponse(
  status: number,
  raw: unknown,
): YuryInventoryExitInterpretation {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const remoteCode = asString(record.error || record.code);
  const remoteMessage = asString(record.message);

  if (status === 201) {
    return { ok: true, alreadyDebited: false };
  }
  if (status === 200) {
    return { ok: true, alreadyDebited: record.alreadyDebited !== false };
  }
  if (status >= 200 && status < 300) {
    return { ok: true, alreadyDebited: Boolean(record.alreadyDebited) };
  }

  if (status === 400 && (remoteCode === "INSUFFICIENT_STOCK" || /insufficient/i.test(remoteMessage))) {
    return {
      ok: false,
      code: "INSUFFICIENT_STOCK",
      message: remoteMessage || "Estoque insuficiente na Yury para este envio.",
    };
  }
  if (status === 401) {
    return { ok: false, code: "YURY_TOKEN_INVALID", message: remoteMessage || "Token de sync Yury inválido." };
  }
  if (status === 404) {
    return {
      ok: false,
      code: "YURY_EXIT_UNAVAILABLE",
      message: remoteMessage || "Baixa de estoque Yury indisponível (rota ainda não no ar).",
    };
  }
  if (status === 503) {
    return { ok: false, code: "YURY_SYNC_DISABLED", message: remoteMessage || "Sync de estoque desligado na Yury." };
  }
  return {
    ok: false,
    code: remoteCode || "YURY_EXIT_FAILED",
    message: remoteMessage || `Yury inventory exit HTTP ${status}`,
  };
}
