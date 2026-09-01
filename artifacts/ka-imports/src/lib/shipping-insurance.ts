export function computeShippingInsuranceAmount(
  includeInsurance: boolean,
  subtotal: number,
  discountAmount = 0,
): number {
  if (!includeInsurance) return 0;
  const base = Math.max(0, (Number(subtotal) || 0) - (Number(discountAmount) || 0));
  return Math.round(base * 10) / 100;
}
