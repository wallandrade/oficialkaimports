import { parseOrderProductItems } from "./order-item-cost";

export function normalizeCatalogName(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isReshipmentChildOrder(observation: unknown): boolean {
  return String(observation || "").toUpperCase().includes("REENVIO DO PEDIDO");
}

export function aggregateSoldQtyFromOrders(
  orders: Array<{ products: unknown; observation?: unknown }>,
): { byId: Map<string, number>; byName: Map<string, number> } {
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();

  for (const order of orders) {
    if (isReshipmentChildOrder(order.observation)) continue;
    const items = parseOrderProductItems(order.products) || [];
    for (const item of items) {
      const qty = Math.max(0, Math.trunc(Number(item.quantity) || 0));
      if (qty <= 0) continue;
      const id = String(item.id ?? item.productId ?? "").trim();
      const name = normalizeCatalogName(item.name);
      if (id) byId.set(id, (byId.get(id) || 0) + qty);
      if (name) byName.set(name, (byName.get(name) || 0) + qty);
    }
  }

  return { byId, byName };
}

export function soldQtyForCatalogProduct(
  product: { id: string; name: string },
  agg: { byId: Map<string, number>; byName: Map<string, number> },
): number {
  const fromId = agg.byId.get(String(product.id || "").trim()) || 0;
  const fromName = agg.byName.get(normalizeCatalogName(product.name)) || 0;
  return Math.max(fromId, fromName);
}
