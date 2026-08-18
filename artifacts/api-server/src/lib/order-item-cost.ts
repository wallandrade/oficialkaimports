const COST_BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function parseOrderProductItems(raw: unknown): Array<Record<string, unknown>> | null {
  try {
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : null;
  } catch {
    return null;
  }
}

export function orderItemMatchesProduct(item: Record<string, unknown>, productId: string): boolean {
  return String(item.id ?? item.productId ?? "").trim() === productId;
}

export function hasPersistedOrderItemCost(item: Record<string, unknown>): boolean {
  const value = Number(item.costPrice ?? item.costprice ?? item.cost ?? NaN);
  return Number.isFinite(value) && value > 0;
}

export function isWithinCostOverwriteWindow(createdAt: Date | string, now = new Date()): boolean {
  const time = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return false;
  return time >= now.getTime() - COST_BACKFILL_WINDOW_MS;
}

export function patchOrderItemsWithProductCost(
  items: Array<Record<string, unknown>>,
  productId: string,
  newCost: number,
  options: { overwriteExisting: boolean },
): { items: Array<Record<string, unknown>>; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    if (!orderItemMatchesProduct(item, productId)) return item;
    if (!options.overwriteExisting && hasPersistedOrderItemCost(item)) return item;
    const current = Number(item.costPrice ?? item.costprice ?? item.cost ?? NaN);
    if (Number.isFinite(current) && current === newCost) return item;
    changed = true;
    return { ...item, costPrice: newCost };
  });
  return { items: next, changed };
}
