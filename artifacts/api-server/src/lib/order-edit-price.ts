export function flashUnitPriceFromOrder(
  lines: Array<{ id?: unknown; price?: unknown; flashOffer?: unknown }>,
  productId: string,
): number | null {
  const id = String(productId || "").trim();
  if (!id) return null;
  const hit = lines.find((line) => String(line?.id || "").trim() === id && line?.flashOffer === true);
  if (!hit) return null;
  const price = Number(hit.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.round(price * 100) / 100;
}
