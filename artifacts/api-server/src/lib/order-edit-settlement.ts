export type OrderEditSettlementInput = {
  commercialTotal: number;
  existingStoreCredit: number;
  existingAffiliateCredit: number;
  paidAmount: number | null;
  previousTotal: number;
  status: string;
  hasProof: boolean;
  storeCreditToApply: number;
};

export type OrderEditSettlement = {
  payableTotal: number;
  amountDueBeforeCredit: number;
  storeCreditApplied: number;
  stillDue: number;
  nextStatus: string;
};

function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Quanto a edição ainda cobra, depois do saldo da carteira pedido neste save. */
export function settleOrderEdit(input: OrderEditSettlementInput): OrderEditSettlement {
  const commercialTotal = money(Math.max(0, input.commercialTotal));
  const existingStoreCredit = money(Math.max(0, input.existingStoreCredit));
  const existingAffiliateCredit = money(Math.max(0, input.existingAffiliateCredit));
  const previousTotal = money(Math.max(0, input.previousTotal));
  const status = String(input.status || "").toLowerCase();
  const isPaid = status === "paid" || status === "completed";
  const paidAmount = input.paidAmount != null && input.paidAmount > 0 ? money(input.paidAmount) : null;

  const payableBeforeNewCredit = money(Math.max(0, commercialTotal - existingStoreCredit - existingAffiliateCredit));
  const neverPaid = status === "pending" && !input.hasProof;
  const cashCovered = paidAmount != null ? paidAmount : (neverPaid ? 0 : previousTotal);
  const amountDueBeforeCredit = money(Math.max(0, payableBeforeNewCredit - cashCovered));
  const storeCreditApplied = money(Math.min(money(Math.max(0, input.storeCreditToApply)), amountDueBeforeCredit));
  const payableTotal = money(Math.max(0, payableBeforeNewCredit - storeCreditApplied));
  const stillDue = money(Math.max(0, payableTotal - cashCovered));

  let nextStatus = status || "pending";
  if (paidAmount != null) {
    nextStatus = payableTotal > paidAmount + 0.01 ? "awaiting_payment" : "paid";
  } else if (isPaid && payableTotal > previousTotal + 0.01) {
    nextStatus = "awaiting_payment";
  } else if (storeCreditApplied > 0 && payableTotal <= 0.01) {
    nextStatus = "paid";
  }

  return {
    payableTotal,
    amountDueBeforeCredit,
    storeCreditApplied,
    stillDue,
    nextStatus,
  };
}
