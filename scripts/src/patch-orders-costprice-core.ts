/**
 * Janela do patch de custo no pré-deploy.
 * A comparação usa milissegundos UTC (`getTime`), sem fuso de calendário.
 * Entra o pedido com status `paid` ou `completed` cuja criação está entre
 * `now - 72h` e `now`, inclusive nos dois extremos.
 * Mais antigo que 72h, data inválida ou criação no futuro fica de fora.
 * O filtro SQL usa os mesmos instantes. A decisão final é esta comparação
 * em milissegundos. O TIMESTAMP do MySQL tem precisão de segundo, então a
 * borda pode oscilar em menos de 1s entre o relógio e o valor gravado.
 */
export const COST_PATCH_WINDOW_MS = 72 * 60 * 60 * 1000;

const PATCHABLE_STATUSES = new Set(["paid", "completed"]);

export type CostPatchSkipReason =
  | "status"
  | "invalid_created_at"
  | "future_created_at"
  | "outside_window"
  | "invalid_products_json"
  | "no_change";

export function classifyCreatedAt(
  createdAt: unknown,
  now: Date,
): "inside" | "invalid_created_at" | "future_created_at" | "outside_window" {
  const parsed = createdAt instanceof Date
    ? createdAt
    : new Date(typeof createdAt === "string" || typeof createdAt === "number" ? createdAt : "");
  const createdMs = parsed.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs)) return "invalid_created_at";
  if (createdMs > nowMs) return "future_created_at";
  if (nowMs - createdMs > COST_PATCH_WINDOW_MS) return "outside_window";
  return "inside";
}

/** Custo utilizável: número finito maior que zero. Zero, vazio e texto não servem. */
export function readValidCatalogCost(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sameCost(current: unknown, next: number): boolean {
  const parsed = readValidCatalogCost(current);
  return parsed != null && parsed === next;
}

function isPlainItem(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readProductList(products: unknown): { ok: true; items: unknown[] } | { ok: false } {
  let value = products;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: false };
    }
  }
  if (!Array.isArray(value)) return { ok: false };
  return { ok: true, items: value };
}

export function productIdsForCostLookup(products: unknown): string[] {
  const list = readProductList(products);
  if (!list.ok) return [];
  const ids = new Set<string>();
  for (const item of list.items) {
    if (!isPlainItem(item)) continue;
    const id = String(item.id || "").trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function planOrderCostPatch(input: {
  status: string;
  createdAt: unknown;
  products: unknown;
  catalogCosts: ReadonlyMap<string, unknown>;
  now: Date;
}): { update: false; reason: CostPatchSkipReason } | { update: true; products: unknown[] } {
  if (!PATCHABLE_STATUSES.has(String(input.status || "").trim())) {
    return { update: false, reason: "status" };
  }
  const window = classifyCreatedAt(input.createdAt, input.now);
  if (window !== "inside") return { update: false, reason: window };

  const list = readProductList(input.products);
  if (!list.ok) return { update: false, reason: "invalid_products_json" };

  let changed = false;
  const products = list.items.map((item) => {
    if (!isPlainItem(item)) return item;
    const productId = String(item.id || "").trim();
    if (!productId || !input.catalogCosts.has(productId)) return item;
    const nextCost = readValidCatalogCost(input.catalogCosts.get(productId));
    if (nextCost == null || sameCost(item.costPrice, nextCost)) return item;
    changed = true;
    return { ...item, costPrice: nextCost };
  });

  if (!changed) return { update: false, reason: "no_change" };
  return { update: true, products };
}
