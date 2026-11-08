import assert from "node:assert/strict";
import test from "node:test";
import {
  claimAwaitingSettlement,
  currencyAllowed,
  decidePixSettlement,
  isPaymentConfirmed,
  legacyPixCallbackGate,
  readPixNotice,
  regeneratePixChargeDecision,
  safeTokenEquals,
  shouldIncrementCouponOnPixWebhook,
  statusFromKnownGatewayEvent,
  updatedRowCount,
  webhookAuthenticated,
} from "./pix-settlement";

const paidNotice = {
  authenticated: true,
  transactionId: "tx-1",
  boundTransactionId: "tx-1",
  status: "COMPLETED",
  reportedAmount: 150,
  expectedAmount: 150,
  currency: null as string | null,
  alreadySettled: false,
};

test("status pago é igualdade exata", () => {
  assert.equal(isPaymentConfirmed("COMPLETED"), true);
  assert.equal(isPaymentConfirmed(" paid "), true);
  assert.equal(isPaymentConfirmed("DEPIX_SENT"), true);
  assert.equal(isPaymentConfirmed("PAGO"), true);
  assert.equal(isPaymentConfirmed("OK"), false);
  assert.equal(isPaymentConfirmed("UNPAID"), false);
  assert.equal(isPaymentConfirmed("NOT_PAID"), false);
  assert.equal(isPaymentConfirmed("NOT_OK"), false);
  assert.equal(isPaymentConfirmed("UNCONFIRMED"), false);
  assert.equal(isPaymentConfirmed("UNSUCCESSFUL"), false);
  assert.equal(isPaymentConfirmed("PENDING"), false);
  assert.equal(isPaymentConfirmed("PAID NOW"), false);
});

test("evento só conta quando o nome é o do código", () => {
  assert.equal(statusFromKnownGatewayEvent("deposit.confirmed"), "DEPIX_SENT");
  assert.equal(statusFromKnownGatewayEvent("UNPAID"), null);
  assert.equal(statusFromKnownGatewayEvent("TRANSACTION_PAID"), null);
  assert.equal(statusFromKnownGatewayEvent("deposit.confirmed.extra"), null);
});

test("aviso sem segredo não liquida", () => {
  const decision = decidePixSettlement({ ...paidNotice, authenticated: false });
  assert.equal(decision.action, "reject");
  assert.equal(decision.httpStatus, 403);
  assert.equal(decision.applySideEffects, false);
  assert.equal(decision.incrementCoupon, false);
});

test("segredo vazio não autentica e token diferente é recusado", () => {
  assert.equal(webhookAuthenticated({ sharedSecret: "", providedSecret: "" }), false);
  assert.equal(webhookAuthenticated({ sharedSecret: "segredo-a", providedSecret: "segredo-b" }), false);
  assert.equal(webhookAuthenticated({ sharedSecret: "segredo-a", providedSecret: "segredo-a" }), true);
  assert.equal(safeTokenEquals("abc", "abd"), false);
});

test("transação diferente da gravada não liquida o pedido da URL", () => {
  const decision = decidePixSettlement({ ...paidNotice, boundTransactionId: "tx-outro" });
  assert.equal(decision.reason, "transaction_mismatch");
  assert.equal(decision.httpStatus, 409);
  assert.equal(decision.applySideEffects, false);
});

test("valor ausente ou divergente não marca pago", () => {
  const missing = decidePixSettlement({ ...paidNotice, reportedAmount: null });
  assert.equal(missing.reason, "amount_required");
  assert.equal(missing.httpStatus, 409);

  const wrong = decidePixSettlement({ ...paidNotice, reportedAmount: 1 });
  assert.equal(wrong.reason, "amount_mismatch");
  assert.equal(wrong.applySideEffects, false);
});

test("moeda estranha recusa; ausência segue o contrato de criação sem moeda", () => {
  assert.equal(currencyAllowed(null), true);
  assert.equal(currencyAllowed("BRL"), true);
  assert.equal(currencyAllowed("986"), true);
  const foreign = decidePixSettlement({ ...paidNotice, currency: "USD" });
  assert.equal(foreign.reason, "currency_rejected");
  assert.equal(foreign.applySideEffects, false);
});

test("OK e UNPAID não pagam; cancelamento exato não exige valor", () => {
  const created = decidePixSettlement({ ...paidNotice, status: "OK" });
  assert.equal(created.action, "ignore");
  const unpaid = decidePixSettlement({ ...paidNotice, status: "UNPAID", reportedAmount: null });
  assert.equal(unpaid.action, "ignore");
  const expired = decidePixSettlement({
    ...paidNotice,
    status: "EXPIRED",
    reportedAmount: null,
  });
  assert.equal(expired.action, "cancel");
  assert.equal(expired.applySideEffects, true);
  assert.equal(expired.incrementCoupon, false);
});

test("replay e corrida só disparam o efeito uma vez e não contam cupom de novo", () => {
  assert.equal(shouldIncrementCouponOnPixWebhook(), false);
  const row = { status: "awaiting_payment", effects: 0 };
  const first = decidePixSettlement(paidNotice);
  assert.equal(first.action, "pay");
  assert.equal(first.incrementCoupon, false);
  if (first.applySideEffects) assert.equal(claimAwaitingSettlement(row, "paid"), true);

  const second = decidePixSettlement({ ...paidNotice, alreadySettled: row.status === "paid" });
  assert.equal(second.action, "duplicate");
  assert.equal(second.applySideEffects, false);
  assert.equal(claimAwaitingSettlement(row, "paid"), false);
  assert.equal(row.effects, 1);

  const shared = { status: "awaiting_payment", effects: 0 };
  const winners = [0, 1].map(() => claimAwaitingSettlement(shared, "paid"));
  assert.deepEqual(winners, [true, false]);
  assert.equal(shared.effects, 1);
});

test("callback legado fica fechado sem a flag e sem o token", () => {
  const disabled = legacyPixCallbackGate({ enabled: false, tokenMatches: true });
  assert.equal(disabled?.httpStatus, 410);
  const badToken = legacyPixCallbackGate({ enabled: true, tokenMatches: false });
  assert.equal(badToken?.httpStatus, 403);
  assert.equal(legacyPixCallbackGate({ enabled: true, tokenMatches: true }), null);
});

test("nova cobrança da tela usa o total do pedido, não um valor menor", () => {
  const lower = regeneratePixChargeDecision({
    orderFound: true,
    orderStatus: "awaiting_payment",
    orderTotal: 200,
    clientAmount: 1,
  });
  assert.equal(lower.ok, false);
  if (!lower.ok) assert.equal(lower.reason, "amount_mismatch");

  const same = regeneratePixChargeDecision({
    orderFound: true,
    orderStatus: "awaiting_payment",
    orderTotal: 200,
    clientAmount: 200,
  });
  assert.equal(same.ok, true);
  if (same.ok) assert.equal(same.chargeAmount, 200);

  const paid = regeneratePixChargeDecision({
    orderFound: true,
    orderStatus: "paid",
    orderTotal: 200,
    clientAmount: 200,
  });
  assert.equal(paid.ok, false);
});

test("leitura do aviso não guarda cliente nem código PIX", () => {
  const notice = readPixNotice({
    event: "deposit.confirmed",
    client: { name: "Cliente", email: "a@b.c", document: "000" },
    pix: { code: "00020126PIX" },
    callbackUrl: "https://loja.example/api/webhook/pix?whsec=segredo",
    transaction: { id: "tx-9", amount: "149.90", currency: "BRL" },
  });
  assert.equal(notice.transactionId, "tx-9");
  assert.equal(notice.amount, 149.9);
  assert.equal(notice.currency, "BRL");
  assert.equal(notice.status, "DEPIX_SENT");
  assert.equal(JSON.stringify(notice).includes("segredo"), false);
  assert.equal(JSON.stringify(notice).includes("00020126PIX"), false);
  assert.equal(JSON.stringify(notice).includes("Cliente"), false);
});

test("aviso no formato documentado usa o valor pago pelo cliente, não o líquido", () => {
  const notice = readPixNotice({
    event: "TRANSACTION_PAID",
    token: "token-de-exemplo",
    client: { name: "Pessoa Sintetica", email: "sintetico@example.test", phone: "11999999999", cpf: "00000000000" },
    transaction: {
      id: "tx-sintetica",
      status: "COMPLETED",
      paymentMethod: "PIX",
      currency: "BRL",
      originalCurrency: "BRL",
      amount: 97.5,
      chargeAmount: 100,
      originalAmount: 100,
      pixInformation: { qrCode: "00020126NAO-USAR" },
    },
  });
  assert.equal(notice.amount, 100);
  assert.equal(notice.status, "COMPLETED");
  assert.equal(notice.currency, "BRL");
  assert.equal(JSON.stringify(notice).includes("00020126NAO-USAR"), false);
  assert.equal(JSON.stringify(notice).includes("token-de-exemplo"), false);
  const decision = decidePixSettlement({
    authenticated: true,
    transactionId: notice.transactionId,
    boundTransactionId: "tx-sintetica",
    status: notice.status,
    reportedAmount: notice.amount,
    expectedAmount: 100,
    currency: notice.currency,
    alreadySettled: false,
  });
  assert.equal(decision.action, "pay");
});

test("moeda original estrangeira não usa o valor em outra moeda", () => {
  const notice = readPixNotice({
    transaction: {
      id: "tx-fx",
      status: "COMPLETED",
      originalCurrency: "USD",
      originalAmount: 20,
      amount: 100,
      currency: "BRL",
    },
  });
  assert.equal(notice.amount, 100);
});

test("CHARGED_BACK documentado cancela e não paga", () => {
  const decision = decidePixSettlement({
    ...paidNotice,
    status: "CHARGED_BACK",
    reportedAmount: null,
  });
  assert.equal(decision.action, "cancel");
});

test("amountInCents do DentPeg vira reais só nesse campo", () => {
  const notice = readPixNotice({
    transaction: { id: "dep_1", status: "depix_sent", amountInCents: 2590 },
  });
  assert.equal(notice.amount, 25.9);
  assert.equal(isPaymentConfirmed(notice.status), true);
});

test("contador de linhas aceita os dois formatos do driver", () => {
  assert.equal(updatedRowCount({ affectedRows: 1 }), 1);
  assert.equal(updatedRowCount([{ affectedRows: 0 }]), 0);
  assert.equal(updatedRowCount({ rowsAffected: 2 }), 2);
  assert.equal(updatedRowCount(undefined), 0);
});
