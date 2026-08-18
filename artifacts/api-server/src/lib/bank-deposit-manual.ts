/** Candidato a depósito manual Inter (não PIX gateway CNPay/DentPeg). */
export function isManualInterDepositOrder(o: {
  paymentMethod?: string | null;
  transactionId?: string | null;
}): boolean {
  const method = String(o.paymentMethod || "pix").toLowerCase().trim();
  if (method === "card_simulation" || method === "affiliate_credit") return false;
  if (method === "whatsapp_pix") return true;
  // PIX loja com transactionId = cobrança gateway → fora da conciliação Inter
  const tx = String(o.transactionId || "").trim();
  return !tx;
}
