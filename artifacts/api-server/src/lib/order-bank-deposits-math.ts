export function moneyToCents(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToAmountString(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

export function depositLinkRequiresNote(params: {
  orderTotal: unknown;
  existingSum: unknown;
  creditAmount: unknown;
  matchStatus: string;
}): { requiresNote: boolean; nextSumCents: number; blocked: boolean; message?: string } {
  const orderCents = moneyToCents(params.orderTotal);
  const existingCents = moneyToCents(params.existingSum);
  const creditCents = moneyToCents(params.creditAmount);
  const nextSumCents = existingCents + creditCents;
  const matchStatus = String(params.matchStatus || "").trim();

  if (matchStatus === "confirmed_100" && creditCents !== orderCents) {
    return {
      requiresNote: false,
      nextSumCents,
      blocked: true,
      message: "Valor do crédito ≠ total do pedido.",
    };
  }

  return {
    requiresNote: nextSumCents !== orderCents,
    nextSumCents,
    blocked: false,
  };
}
