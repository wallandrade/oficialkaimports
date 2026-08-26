/** Setting: `motoboy_eligible_product_ids` — JSON array de IDs. Vazio = todos elegíveis. */

export function parseMotoboyEligibleProductIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return uniqueIds(raw);
  }
  const str = String(raw).trim();
  if (!str) return [];
  try {
    const parsed = JSON.parse(str) as unknown;
    if (Array.isArray(parsed)) return uniqueIds(parsed);
  } catch {
    /* fallback abaixo */
  }
  return uniqueIds(str.split(","));
}

export function serializeMotoboyEligibleProductIds(ids: string[]): string {
  return JSON.stringify(uniqueIds(ids));
}

/**
 * Lista vazia = Motoboy liberado para qualquer produto (comportamento legado).
 * Lista preenchida = todos os IDs do carrinho precisam estar na lista.
 */
export function isCartEligibleForMotoboy(
  cartProductIds: Array<string | null | undefined>,
  eligibleProductIds: string[],
): boolean {
  if (eligibleProductIds.length === 0) return true;
  const cartIds = uniqueIds(cartProductIds);
  if (cartIds.length === 0) return false;
  const allowed = new Set(eligibleProductIds);
  return cartIds.every((id) => allowed.has(id));
}

function uniqueIds(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
