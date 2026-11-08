/**
 * Regras puras da liquidação PIX.
 *
 * Contrato local verificado (não é documentação externa do gateway):
 * - A criação APPCNPay envia `amount` em reais (ex.: 100.5) e o retorno de
 *   criação usa status `OK` para "cobrança criada", não para "pago".
 * - A confirmação em produção é o webhook. O próprio código registra que o
 *   GET de transações da APPCNPay bloqueia polling, então a consulta não
 *   entra como prova.
 * - DentPeg cria depósito com `amountInCents` e o status pago observado no
 *   código é `depix_sent` / evento `deposit.confirmed`.
 * - Não há amostra versionada do corpo real do webhook. Campo ausente que
 *   a liquidação precisa (valor, ao pagar) falha fechado.
 */

import crypto from "crypto";

export const PIX_PAID_STATUSES = [
  "PAID",
  "APPROVED",
  "CONFIRMED",
  "COMPLETED",
  "SUCCESS",
  "DEPIX_SENT",
  "PAGO",
  "PAGA",
  "CONCLUIDO",
  "CONCLUÍDA",
  "CONCLUIDA",
  "APROVADO",
  "APROVADA",
] as const;

export const PIX_CANCEL_STATUSES = [
  "CANCELED",
  "CANCELLED",
  "REJECTED",
  "FAILED",
  "EXPIRED",
  "REFUNDED",
  "ERROR",
  "CHARGEBACK",
  "CHARGED_BACK",
] as const;

const PAID = new Set<string>(PIX_PAID_STATUSES);
const CANCEL = new Set<string>(PIX_CANCEL_STATUSES);

export type PixNotice = {
  transactionId?: string;
  status?: string;
  amount: number | null;
  currency: string | null;
  reservationId?: string;
  chargeId?: string;
};

export type SettlementAction = "reject" | "ignore" | "cancel" | "pay" | "duplicate";

export type SettlementDecision = {
  action: SettlementAction;
  reason: string;
  httpStatus: number;
  applySideEffects: boolean;
  incrementCoupon: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizePixStatus(status: string | null | undefined): string {
  return String(status || "").trim().toUpperCase();
}

/** Igualdade exata. `OK` é criação de cobrança. `UNPAID` não contém um pago. */
export function isPaymentConfirmed(status: string | null | undefined): boolean {
  return PAID.has(normalizePixStatus(status));
}

export function isPaymentCancelled(status: string | null | undefined): boolean {
  return CANCEL.has(normalizePixStatus(status));
}

/** Só eventos escritos no código. Substring de PAID/APPROVED não vira pago. */
export function statusFromKnownGatewayEvent(event: string | null | undefined): string | null {
  const name = String(event || "").trim().toLowerCase();
  if (name === "deposit.confirmed") return "DEPIX_SENT";
  if (name === "deposit.expired") return "EXPIRED";
  if (name === "deposit.error") return "ERROR";
  if (name === "deposit.refunded") return "REFUNDED";
  return null;
}

export function safeTokenEquals(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function moneyEquals(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(Math.round(left * 100) - Math.round(right * 100)) <= 1;
}

export function currencyAllowed(currency: string | null | undefined): boolean {
  const value = String(currency || "").trim().toUpperCase();
  if (!value) return true;
  return value === "BRL" || value === "986";
}

function firstText(sources: unknown[]): string {
  for (const source of sources) {
    const value = text(source);
    if (value) return value;
  }
  return "";
}

function readReais(sources: unknown[]): number | null {
  for (const source of sources) {
    if (source == null || source === "") continue;
    return finiteNumber(source);
  }
  return null;
}

/**
 * Lê só os campos que o normalizador deste repositório já usava, mais
 * `amountInCents` do contrato de criação DentPeg quando não há valor em reais.
 * Não copia cliente, código PIX nem URL de callback.
 */
export function readPixNotice(raw: unknown): PixNotice {
  const body = asRecord(raw) ?? {};
  const transaction = asRecord(body.transaction) ?? body;
  const data = asRecord(body.data) ?? {};
  const txMeta = asRecord(transaction.metadata) ?? {};
  const rawMeta = asRecord(body.metadata) ?? {};

  const chargeAmount = finiteNumber(transaction.chargeAmount);
  const originalAmount = finiteNumber(transaction.originalAmount);
  const receivedAmount = finiteNumber(transaction.amount) ?? finiteNumber(body.amount);
  const originalCurrency = text(transaction.originalCurrency).toUpperCase();
  const originalIsBrl = !originalCurrency || originalCurrency === "BRL" || originalCurrency === "986";
  // CN Pay documenta `chargeAmount` como o valor pago pelo cliente e `amount`
  // como o valor recebido, que pode ser líquido de taxa. O total do pedido é o
  // valor cobrado do cliente.
  let amount = chargeAmount
    ?? (originalAmount != null && originalIsBrl ? originalAmount : null)
    ?? receivedAmount;
  if (amount == null) {
    const cents = readReais([
      transaction.amountInCents,
      data.amountInCents,
      body.amountInCents,
    ]);
    if (cents != null) amount = cents / 100;
  }

  const explicitStatus = firstText([
    transaction.status,
    data.status,
    body.status,
    body.payment_status,
    body.paymentStatus,
  ]);
  const eventStatus = statusFromKnownGatewayEvent(firstText([body.event, transaction.event]));
  const status = explicitStatus || eventStatus || undefined;

  const transactionId = firstText([
    transaction.id,
    data.depositId,
    body.transactionId,
    body.transaction_id,
    transaction.transactionId,
    transaction.transaction_id,
  ]) || undefined;

  const currency = firstText([
    transaction.currency,
    body.currency,
    transaction.currencyCode,
    body.currencyCode,
  ]) || null;

  const reservationId = firstText([txMeta.reservationId, rawMeta.reservationId]) || undefined;
  const chargeId = firstText([txMeta.chargeId, rawMeta.chargeId, body.chargeId]) || undefined;

  return { transactionId, status, amount, currency, reservationId, chargeId };
}

export function readWebhookSecret(input: {
  headerSecret?: string | null;
  signatureHeader?: string | null;
  querySecret?: unknown;
}): string {
  const header = String(input.headerSecret || input.signatureHeader || "").trim();
  if (header) return header;
  return typeof input.querySecret === "string" ? input.querySecret.trim() : "";
}

export function webhookAuthenticated(input: {
  sharedSecret: string;
  providedSecret: string;
  directTokenExpected?: string;
  providedDirectToken?: string;
}): boolean {
  if (safeTokenEquals(input.sharedSecret, input.providedSecret)) return true;
  return safeTokenEquals(input.directTokenExpected || "", input.providedDirectToken || "");
}

export function decidePixSettlement(input: {
  authenticated: boolean;
  transactionId?: string;
  boundTransactionId?: string;
  status?: string;
  reportedAmount: number | null;
  expectedAmount?: number;
  currency?: string | null;
  alreadySettled: boolean;
}): SettlementDecision {
  const noCoupon = { incrementCoupon: false as const };

  if (!input.authenticated) {
    return { action: "reject", reason: "untrusted", httpStatus: 403, applySideEffects: false, ...noCoupon };
  }
  if (!input.transactionId) {
    return { action: "reject", reason: "missing_transaction", httpStatus: 403, applySideEffects: false, ...noCoupon };
  }
  if (input.boundTransactionId && input.boundTransactionId !== input.transactionId) {
    return { action: "reject", reason: "transaction_mismatch", httpStatus: 409, applySideEffects: false, ...noCoupon };
  }

  if (input.alreadySettled) {
    return { action: "duplicate", reason: "duplicate", httpStatus: 200, applySideEffects: false, ...noCoupon };
  }

  if (isPaymentCancelled(input.status)) {
    return { action: "cancel", reason: "cancelled", httpStatus: 200, applySideEffects: true, ...noCoupon };
  }

  if (!isPaymentConfirmed(input.status)) {
    return { action: "ignore", reason: "status_not_paid", httpStatus: 200, applySideEffects: false, ...noCoupon };
  }

  if (!currencyAllowed(input.currency)) {
    return { action: "reject", reason: "currency_rejected", httpStatus: 409, applySideEffects: false, ...noCoupon };
  }

  if (input.reportedAmount == null) {
    return { action: "reject", reason: "amount_required", httpStatus: 409, applySideEffects: false, ...noCoupon };
  }

  if (input.expectedAmount == null || !moneyEquals(input.reportedAmount, input.expectedAmount)) {
    return { action: "reject", reason: "amount_mismatch", httpStatus: 409, applySideEffects: false, ...noCoupon };
  }

  return { action: "pay", reason: "paid", httpStatus: 200, applySideEffects: true, ...noCoupon };
}

export function shouldIncrementCouponOnPixWebhook(): boolean {
  return false;
}

export type ClaimRow = { status: string; effects: number };

/** Compara-e-troca em memória. O SQL correspondente filtra status ainda não pago. */
export function claimAwaitingSettlement(row: ClaimRow, next: "paid" | "cancelled"): boolean {
  if (row.status === "paid" || row.status === "completed") return false;
  if (next === "cancelled" && row.status === "cancelled") return false;
  row.status = next === "paid" ? "paid" : "cancelled";
  row.effects += 1;
  return true;
}

export function regeneratePixChargeDecision(input: {
  orderFound: boolean;
  orderStatus: string;
  orderTotal: number;
  clientAmount: number;
}): { ok: true; chargeAmount: number } | { ok: false; httpStatus: number; reason: string } {
  if (!input.orderFound) return { ok: false, httpStatus: 404, reason: "order_not_found" };
  const status = input.orderStatus.trim().toLowerCase();
  if (status === "paid" || status === "completed") {
    return { ok: false, httpStatus: 409, reason: "already_paid" };
  }
  if (!moneyEquals(input.clientAmount, input.orderTotal)) {
    return { ok: false, httpStatus: 400, reason: "amount_mismatch" };
  }
  return { ok: true, chargeAmount: input.orderTotal };
}

export function legacyPixCallbackGate(input: { enabled: boolean; tokenMatches: boolean }): SettlementDecision | null {
  if (!input.enabled) {
    return { action: "reject", reason: "legacy_disabled", httpStatus: 410, applySideEffects: false, incrementCoupon: false };
  }
  if (!input.tokenMatches) {
    return { action: "reject", reason: "untrusted", httpStatus: 403, applySideEffects: false, incrementCoupon: false };
  }
  return null;
}

export function updatedRowCount(result: unknown): number {
  const fromObject = (value: unknown): number | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as { affectedRows?: unknown; rowsAffected?: unknown };
    if (typeof row.affectedRows === "number") return row.affectedRows;
    if (typeof row.rowsAffected === "number") return row.rowsAffected;
    return null;
  };
  if (Array.isArray(result)) {
    const nested = fromObject(result[0]);
    if (nested != null) return nested;
  }
  return fromObject(result) ?? 0;
}

export function pixNoticeLogFields(notice: PixNotice): {
  hasTransactionId: boolean;
  status: string | null;
  hasAmount: boolean;
  hasCurrency: boolean;
} {
  return {
    hasTransactionId: Boolean(notice.transactionId),
    status: notice.status ? notice.status.slice(0, 40) : null,
    hasAmount: notice.amount != null,
    hasCurrency: Boolean(notice.currency),
  };
}
