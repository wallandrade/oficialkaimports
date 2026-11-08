/**
 * Exercita as rotas reais de confirmação contra um MariaDB só em 127.0.0.1.
 * Não lê .env, não chama gateway e recusa qualquer host que não seja local.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";

const databaseUrl = String(process.env.DATABASE_URL || "");
const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/pix_settlement_test") {
  throw new Error("Recusando banco que não é o pix_settlement_test local.");
}
if (String(process.env.WEBHOOK_SHARED_SECRET || "") !== "it-shared-secret") {
  throw new Error("Segredo de teste inesperado.");
}
for (const key of ["GATEWAY_SECRET", "GATEWAY_IDENTIFIER", "DENTPEG_API_KEY", "N8N_ORDER_PAID_WEBHOOK_URL"]) {
  if (process.env[key]) throw new Error(`Variável de integração real presente: ${key}`);
}

const { db, pool, ordersTable, couponsTable, customChargesTable, raffleReservationsTable, rafflesTable, pixChargeProofsTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const { default: webhookRouter } = await import("./webhooks.ts");
const { default: pixRouter } = await import("./pix.ts");
const { default: raffleRouter } = await import("./raffles.ts");
const { default: chargeRouter } = await import("./custom-charges.ts");
const { rememberGatewayChargeProof } = await import("../lib/pix-charge-proof.ts");

const app = express();
app.use(express.json());
app.use("/api", webhookRouter);
app.use("/api", pixRouter);
app.use("/api", raffleRouter);
app.use("/api", chargeRouter);

const server: Server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
const base = `http://127.0.0.1:${address.port}`;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json() as Record<string, unknown>;
  return { status: response.status, json };
}

function paidBody(transactionId: string, amount = 100) {
  return {
    event: "TRANSACTION_PAID",
    token: "token-do-gateway-nao-e-o-segredo",
    client: { name: "Pessoa Sintetica", email: "sintetico@example.test", cpf: "00000000000" },
    transaction: {
      id: transactionId,
      status: "COMPLETED",
      paymentMethod: "PIX",
      currency: "BRL",
      originalCurrency: "BRL",
      amount: amount - 2.5,
      chargeAmount: amount,
      originalAmount: amount,
      pixInformation: { qrCode: "00020126NAO-GRAVAR" },
    },
  };
}

async function insertOrder(id: string, transactionId: string, total = "100.00") {
  await db.insert(ordersTable).values({
    id,
    tenantId: "tenant_loja1",
    clientName: "Pessoa Sintetica",
    clientEmail: "sintetico@example.test",
    clientPhone: "11999999999",
    clientDocument: "00000000000",
    products: [{ id: "sku-test", name: "Item sintetico", quantity: 1, price: 100 }],
    shippingType: "normal",
    subtotal: total,
    shippingCost: "0.00",
    insuranceAmount: "0.00",
    total,
    status: "awaiting_payment",
    paymentMethod: "pix",
    transactionId,
    couponCode: "CUPOMTESTE",
  });
}

test.before(async () => {
  await db.delete(pixChargeProofsTable);
  await db.delete(ordersTable).where(eq(ordersTable.couponCode, "CUPOMTESTE"));
  await db.delete(customChargesTable).where(eq(customChargesTable.id, "charge-1"));
  await db.delete(raffleReservationsTable).where(eq(raffleReservationsTable.id, "reservation-1"));
  await db.delete(rafflesTable).where(eq(rafflesTable.id, "raffle-1"));
  await db.insert(couponsTable).values({
    id: "cupom-teste",
    tenantId: "tenant_loja1",
    code: "CUPOMTESTE",
    discountType: "fixed",
    discountValue: "10.00",
    usedCount: 1,
  }).onDuplicateKeyUpdate({ set: { usedCount: 1 } });
});

test.after(async () => {
  server.close();
  await pool.end();
});

test("confirmação legítima marca pago uma vez e não soma o cupom de novo", async () => {
  await insertOrder("order-ok", "tx-ok");
  const first = await post("/api/webhook/pix?whsec=it-shared-secret", paidBody("tx-ok"));
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.status, "paid");

  const second = await post("/api/webhook/pix?whsec=it-shared-secret", paidBody("tx-ok"));
  assert.equal(second.status, 200);
  assert.equal(second.json.duplicate, true);

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, "order-ok"));
  assert.equal(order?.status, "paid");
  assert.equal(Number(order?.paidAmount), 100);
  const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, "CUPOMTESTE"));
  assert.equal(coupon?.usedCount, 1);
});

test("aviso sem segredo, valor divergente, valor ausente e status ambíguo não pagam", async () => {
  await insertOrder("order-reject", "tx-reject");

  const untrusted = await post("/api/webhook/pix", { ...paidBody("tx-reject"), token: "" });
  assert.equal(untrusted.status, 403);
  assert.equal(untrusted.json.reason, "untrusted");

  const tokenWithoutProof = await post("/api/webhook/pix", paidBody("tx-reject"));
  assert.equal(tokenWithoutProof.status, 403);
  assert.equal(tokenWithoutProof.json.reason, "proof_not_stored");

  const wrongAmount = await post("/api/webhook/pix?whsec=it-shared-secret", paidBody("tx-reject", 10));
  assert.equal(wrongAmount.status, 409);
  assert.equal(wrongAmount.json.reason, "amount_mismatch");

  const missingAmount = await post("/api/webhook/pix?whsec=it-shared-secret", {
    event: "TRANSACTION_PAID",
    transaction: { id: "tx-reject", status: "COMPLETED", currency: "BRL" },
  });
  assert.equal(missingAmount.status, 409);
  assert.equal(missingAmount.json.reason, "amount_required");

  const created = await post("/api/webhook/pix?whsec=it-shared-secret", {
    event: "TRANSACTION_CREATED",
    transaction: { id: "tx-reject", status: "OK", amount: 100, currency: "BRL" },
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.reason, "status_not_paid");

  const unpaid = await post("/api/webhook/pix?whsec=it-shared-secret", {
    transaction: { id: "tx-reject", status: "UNPAID", amount: 100, currency: "BRL" },
  });
  assert.equal(unpaid.status, 200);
  assert.equal(unpaid.json.reason, "status_not_paid");

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, "order-reject"));
  assert.equal(order?.status, "awaiting_payment");
});

test("URL direta não paga outro transactionId e o callback legado fica desligado", async () => {
  await insertOrder("order-direct", "tx-direct");
  const mismatch = await post("/api/webhook/pix/order/it-shared-secret/order-direct", paidBody("tx-outro"));
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.json.reason, "transaction_mismatch");

  const legacy = await post("/api/pix/callback/qualquer-token", paidBody("tx-direct"));
  assert.equal(legacy.status, 410);

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, "order-direct"));
  assert.equal(order?.status, "awaiting_payment");
});

test("callback antigo de cobrança exige token e valor da cobrança", async () => {
  await db.insert(customChargesTable).values({
    id: "charge-1",
    tenantId: "tenant_loja1",
    clientName: "Pessoa Sintetica",
    clientEmail: "sintetico@example.test",
    clientPhone: "11999999999",
    clientDocument: "00000000000",
    amount: "30.00",
    status: "awaiting_payment",
    transactionId: "tx-charge",
  });
  const open = await post("/api/custom-charges/callback/token-errado/charge-1", paidBody("tx-charge", 30));
  assert.equal(open.status, 403);

  const wrong = await post("/api/custom-charges/callback/it-shared-secret/charge-1", paidBody("tx-charge", 1));
  assert.equal(wrong.status, 409);

  const ok = await post("/api/custom-charges/callback/it-shared-secret/charge-1", paidBody("tx-charge", 30));
  assert.equal(ok.status, 200);
  const again = await post("/api/custom-charges/callback/it-shared-secret/charge-1", paidBody("tx-charge", 30));
  assert.equal(again.json.duplicate, true);
  const [charge] = await db.select().from(customChargesTable).where(eq(customChargesTable.id, "charge-1"));
  assert.equal(charge?.status, "paid");
});

test("rifa antiga não aceita só o id da reserva e paga com a transação e o valor", async () => {
  await db.insert(rafflesTable).values({
    id: "raffle-1",
    tenantId: "tenant_loja1",
    title: "Rifa sintetica",
    totalNumbers: 10,
    pricePerNumber: "10.00",
  });
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(raffleReservationsTable).values({
    id: "reservation-1",
    tenantId: "tenant_loja1",
    raffleId: "raffle-1",
    numbers: "[1]",
    clientName: "Pessoa Sintetica",
    clientEmail: "sintetico@example.test",
    clientPhone: "11999999999",
    totalAmount: "10.00",
    status: "reserved",
    transactionId: "tx-raffle",
    expiresAt,
  });

  const onlyReservation = await post("/api/webhook/raffle-pix?whsec=it-shared-secret", {
    status: "COMPLETED",
    metadata: { reservationId: "reservation-1" },
    amount: 10,
  });
  assert.equal(onlyReservation.status, 403);

  const paid = await post("/api/webhook/raffle-pix?whsec=it-shared-secret", paidBody("tx-raffle", 10));
  assert.equal(paid.status, 200);
  assert.equal(paid.json.confirmed, true);
  const [reservation] = await db.select().from(raffleReservationsTable).where(eq(raffleReservationsTable.id, "reservation-1"));
  assert.equal(reservation?.status, "paid");
  assert.equal(reservation?.paidSource, "pix");
});

test("dois avisos simultâneos só liquidam o pedido uma vez", async () => {
  await insertOrder("order-race", "tx-race");
  const [left, right] = await Promise.all([
    post("/api/webhook/pix?whsec=it-shared-secret", paidBody("tx-race")),
    post("/api/webhook/pix?whsec=it-shared-secret", paidBody("tx-race")),
  ]);
  const statuses = [left.status, right.status].sort();
  assert.deepEqual(statuses, [200, 200]);
  const duplicates = [left.json.duplicate, right.json.duplicate].filter(Boolean);
  const pays = [left.json.status, right.json.status].filter((status) => status === "paid");
  assert.equal(pays.length, 1);
  assert.equal(duplicates.length, 1);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, "order-race"));
  assert.equal(order?.status, "paid");
  const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, "CUPOMTESTE"));
  assert.equal(coupon?.usedCount, 1);
});

function realRaffleNotice(
  transactionId: string,
  status: "PENDING" | "COMPLETED",
  token: string,
  amount = 100,
  currency = "BRL",
) {
  return {
    event: status === "COMPLETED" ? "TRANSACTION_PAID" : "TRANSACTION_CREATED",
    token,
    offerCode: null,
    checkoutUrl: "",
    orderId: null,
    orderUrl: null,
    client: { name: "Pessoa Sintetica", email: "sintetico@example.test" },
    transaction: {
      id: transactionId,
      identifier: "ident-sintetico",
      status,
      paymentMethod: "PIX",
      originalAmount: amount,
      amount,
      originalCurrency: currency,
      currency,
      exchangeRate: 1,
      installments: 1,
      createdAt: "2026-11-08T10:06:06.000Z",
      payedAt: status === "COMPLETED" ? "2026-11-08T10:07:05.000Z" : null,
      boletoInformation: null,
      pixInformation: { qrCode: "00020126NAO-GRAVAR" },
      ...(status === "COMPLETED" ? { commissionAmount: 1.5 } : {}),
    },
    subscription: null,
    orderItems: [],
    trackProps: {
      numbers: "[1]",
      isUpsell: false,
      raffleId: "raffle-sintetica",
      reservationId: "reserva-sintetica",
    },
  };
}

test("token da criação confirma a rifa sem whsec; criação não paga; repetição não duplica", async () => {
  await insertOrder("order-token", "tx-token");
  const creationToken = "webhook-token-da-criacao";
  const early = await post("/api/webhook/pix", realRaffleNotice("tx-token", "COMPLETED", creationToken));
  assert.equal(early.status, 403);
  assert.equal(early.json.reason, "proof_not_stored");

  await rememberGatewayChargeProof({
    transactionId: "tx-token",
    tenantId: "tenant_loja1",
    webhookToken: creationToken,
  });

  const created = await post("/api/webhook/pix", realRaffleNotice("tx-token", "PENDING", creationToken));
  assert.equal(created.status, 200);
  assert.equal(created.json.reason, "status_not_paid");

  const paid = await post("/api/webhook/pix", realRaffleNotice("tx-token", "COMPLETED", creationToken));
  assert.equal(paid.status, 200);
  assert.equal(paid.json.status, "paid");
  const again = await post("/api/webhook/pix", realRaffleNotice("tx-token", "COMPLETED", creationToken));
  assert.equal(again.json.duplicate, true);

  const wrong = await post("/api/webhook/pix", realRaffleNotice("tx-other", "COMPLETED", creationToken));
  assert.equal(wrong.status, 403);

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, "order-token"));
  assert.equal(order?.status, "paid");
});

test("token incorreto, valor, moeda e status errados não pagam; whsec antigo continua valendo", async () => {
  await insertOrder("order-guards", "tx-guards");
  await rememberGatewayChargeProof({
    transactionId: "tx-guards",
    tenantId: "tenant_loja1",
    webhookToken: "token-certo",
  });

  const wrongToken = await post("/api/webhook/pix", realRaffleNotice("tx-guards", "COMPLETED", "token-errado"));
  assert.equal(wrongToken.status, 403);
  assert.equal(wrongToken.json.reason, "token_mismatch");

  const wrongAmount = await post("/api/webhook/pix", realRaffleNotice("tx-guards", "COMPLETED", "token-certo", 10));
  assert.equal(wrongAmount.status, 409);
  assert.equal(wrongAmount.json.reason, "amount_mismatch");

  const wrongCurrency = await post("/api/webhook/pix", realRaffleNotice("tx-guards", "COMPLETED", "token-certo", 100, "USD"));
  assert.equal(wrongCurrency.status, 409);
  assert.equal(wrongCurrency.json.reason, "currency_rejected");

  const missing = await post("/api/webhook/pix", {
    ...realRaffleNotice("tx-guards", "COMPLETED", "token-certo"),
    token: "",
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.json.reason, "untrusted");

  await insertOrder("order-whsec", "tx-whsec-only");
  const legacySecret = await post("/api/webhook/pix?whsec=it-shared-secret", paidBody("tx-whsec-only"));
  assert.equal(legacySecret.status, 200);
  assert.equal(legacySecret.json.status, "paid");

  const [untouched] = await db.select().from(ordersTable).where(eq(ordersTable.id, "order-guards"));
  assert.equal(untouched?.status, "awaiting_payment");
});

test("regenerar PIX com valor do navegador menor não chama o gateway", async () => {
  await insertOrder("order-generate", "tx-old", "200.00");
  const response = await post("/api/pix/generate", {
    client: { name: "Pessoa Sintetica", email: "sintetico@example.test", phone: "11999999999", document: "00000000000" },
    products: [{ id: "sku-test", name: "Item sintetico", quantity: 1, price: 1 }],
    amount: 1,
    shippingType: "normal",
    includeInsurance: false,
    orderId: "order-generate",
  });
  assert.equal(response.status, 400);
  assert.equal(response.json.error, "PIX_AMOUNT_REJECTED");
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, "order-generate"));
  assert.equal(order?.transactionId, "tx-old");
  assert.equal(order?.status, "awaiting_payment");
});
