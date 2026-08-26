export function parseFreeShippingMinSubtotalSetting(raw: unknown): number | null {
  const threshold = Number(raw ?? "");
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  return threshold;
}

/** Pedido Motoboy: shippingType costuma ser "Motoboy" (nome da opção no checkout). */
export function isMotoboyShippingType(shippingType: string | null | undefined): boolean {
  const lower = String(shippingType || "").toLowerCase().trim();
  return lower === "motoboy" || lower.startsWith("motoboy");
}

export function resolveShippingCostWithFreeThreshold(input: {
  subtotal: number;
  shippingBaseCost: number;
  freeShippingMinSubtotal: number | null;
}): number {
  const subtotal = Math.max(0, Number(input.subtotal) || 0);
  const shippingBaseCost = Math.max(0, Number(input.shippingBaseCost) || 0);
  const threshold = input.freeShippingMinSubtotal;

  if (threshold != null && threshold > 0 && subtotal >= threshold) {
    return 0;
  }

  return shippingBaseCost;
}
