export type AffiliateBalanceMode = "add" | "set" | "zero";

export function roundAffiliateMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function affiliateAvailableCredit(released: number, used: number, adjustment = 0): number {
  const available = roundAffiliateMoney(released) - roundAffiliateMoney(used) + roundAffiliateMoney(adjustment);
  if (!Number.isFinite(available) || available <= 0) return 0;
  return roundAffiliateMoney(available);
}

export function affiliateBalanceDelta(input: {
  mode: AffiliateBalanceMode;
  available: number;
  amount?: number;
}): { delta: number } | { error: "INVALID_AMOUNT" | "NO_CHANGE" } {
  const available = roundAffiliateMoney(Math.max(0, input.available));
  if (input.mode === "zero") {
    if (available <= 0) return { error: "NO_CHANGE" };
    return { delta: roundAffiliateMoney(-available) };
  }

  const amount = roundAffiliateMoney(Number(input.amount));
  if (!Number.isFinite(amount)) return { error: "INVALID_AMOUNT" };

  if (input.mode === "add") {
    if (amount <= 0) return { error: "INVALID_AMOUNT" };
    return { delta: amount };
  }

  if (amount < 0) return { error: "INVALID_AMOUNT" };
  const delta = roundAffiliateMoney(amount - available);
  if (delta === 0) return { error: "NO_CHANGE" };
  return { delta };
}
