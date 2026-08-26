export function parseMotoboyEligibleProductIds(raw: unknown): string[] {
  if (raw == null || raw === "") return [];

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "[]") return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];
  return Array.from(new Set(
    parsed
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  ));
}

export function cartProductIdsFromItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return Array.from(new Set(
    items
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const record = item as { id?: unknown; bumpProductId?: unknown };
        return String(record.bumpProductId ?? record.id ?? "").trim();
      })
      .filter(Boolean),
  ));
}

export function isCartEligibleForMotoboy(
  cartProductIds: unknown,
  eligibleProductIds: unknown,
): boolean {
  const eligible = parseMotoboyEligibleProductIds(eligibleProductIds);
  if (eligible.length === 0) return true;

  const cartIds = Array.isArray(cartProductIds)
    ? cartProductIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (cartIds.length === 0) return false;

  const allowed = new Set(eligible);
  return cartIds.every((id) => allowed.has(id));
}
