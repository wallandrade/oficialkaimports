/**
 * Convidado vira conta e recebe saldo só na loja do admin.
 * MariaDB só em 127.0.0.1, banco pix_settlement_test. Não lê .env.
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
for (const key of ["ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_USERNAME_2", "ADMIN_PASSWORD_2", "GATEWAY_SECRET", "GATEWAY_IDENTIFIER", "DENTPEG_API_KEY"]) {
  delete process.env[key];
}
process.env.ADMIN_SELLER_SCOPE_MAP = JSON.stringify({ "gwc-seller": "vendedor-loja1" });

const LOJA = "tenant_loja1";
const FILIAL = "tenant_gwc_filial";
const TOKENS = {
  primary: "gwc-token-primary",
  filial: "gwc-token-filial",
  seller: "gwc-token-seller",
};
const EMAILS = {
  loja: "gwc-loja@example.test",
  filial: "gwc-filial@example.test",
  shared: "gwc-shared@example.test",
  real: "gwc-real@example.test",
  pass: "gwc-pass@example.test",
};
const ORDERS = {
  lojaOld: "gwc-order-loja-old",
  lojaNew: "gwc-order-loja-new",
  filial: "gwc-order-filial",
  sharedLoja: "gwc-order-shared-loja",
  sharedFilial: "gwc-order-shared-filial",
  pass: "gwc-order-pass",
};

const { db, pool, adminSessionsTable, customerUsersTable, customerWalletLedgerTable, ordersTable } = await import("@workspace/db");
const { and, eq, inArray, like } = await import("drizzle-orm");
const { default: customerRouter } = await import("./customer-auth");
const { default: walletRouter } = await import("./wallet");
const { ensureRuntimeSchema } = await import("../runtime-schema");

const app = express();
app.use(express.json());
app.use("/api", customerRouter);
app.use("/api", walletRouter);

const server: Server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
const base = `http://127.0.0.1:${address.port}`;

async function call(method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) as Record<string, unknown> : {};
  return { status: response.status, json };
}

function order(id: string, tenantId: string, email: string, name: string, document: string, createdAt: Date) {
  return {
    id,
    tenantId,
    clientName: name,
    clientEmail: email,
    clientPhone: "11999999999",
    clientDocument: document,
    products: [{ id: "sku", name: "Item", quantity: 1, price: 10 }],
    shippingType: "normal",
    subtotal: "10.00",
    shippingCost: "0.00",
    insuranceAmount: "0.00",
    total: "10.00",
    status: "paid",
    paymentMethod: "pix",
    createdAt,
  };
}

async function usersByEmail(email: string) {
  return db.select().from(customerUsersTable).where(eq(customerUsersTable.email, email));
}

async function orderUserId(id: string) {
  const [row] = await db.select({ userId: ordersTable.userId }).from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
  return row?.userId ?? null;
}

async function ledgerFor(userId: string, tenantId: string) {
  return db.select().from(customerWalletLedgerTable).where(and(
    eq(customerWalletLedgerTable.userId, userId),
    eq(customerWalletLedgerTable.tenantId, tenantId),
  ));
}

async function cleanup() {
  const emails = Object.values(EMAILS);
  const users = await db.select({ id: customerUsersTable.id }).from(customerUsersTable).where(inArray(customerUsersTable.email, emails));
  const userIds = users.map((row) => row.id);
  if (userIds.length > 0) {
    await db.delete(customerWalletLedgerTable).where(inArray(customerWalletLedgerTable.userId, userIds));
  }
  await db.delete(customerWalletLedgerTable).where(like(customerWalletLedgerTable.note, "gwc-%"));
  await db.delete(customerUsersTable).where(inArray(customerUsersTable.email, emails));
  await db.delete(ordersTable).where(inArray(ordersTable.id, Object.values(ORDERS)));
  await db.delete(adminSessionsTable).where(inArray(adminSessionsTable.token, Object.values(TOKENS)));
}

test.before(async () => {
  await ensureRuntimeSchema();
  await cleanup();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(adminSessionsTable).values([
    { token: TOKENS.primary, username: "gwc-primary", tenantId: LOJA, isPrimary: 1, expiresAt, createdAt: new Date() },
    { token: TOKENS.filial, username: "gwc-filial", tenantId: FILIAL, isPrimary: 0, expiresAt, createdAt: new Date() },
    { token: TOKENS.seller, username: "gwc-seller", tenantId: LOJA, isPrimary: 0, expiresAt, createdAt: new Date() },
  ]);
  await db.insert(customerUsersTable).values({
    id: "gwc-real-user",
    tenantId: LOJA,
    name: "Conta Real",
    email: EMAILS.real,
    passwordHash: "hash-real",
    salt: "salt-real",
  });
  const older = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const newer = new Date();
  await db.insert(ordersTable).values([
    order(ORDERS.lojaOld, LOJA, "GWC-Loja@example.test", "Nome Antigo", "123", older),
    order(ORDERS.lojaNew, LOJA, EMAILS.loja, "Liliany Rodrigues", "900.000.000-11", newer),
    order(ORDERS.filial, FILIAL, EMAILS.filial, "Cliente Filial", "90000000022", newer),
    order(ORDERS.sharedLoja, LOJA, EMAILS.shared, "Compartilhado Loja", "90000000033", newer),
    order(ORDERS.sharedFilial, FILIAL, EMAILS.shared, "Compartilhado Filial", "90000000033", newer),
    order(ORDERS.pass, LOJA, EMAILS.pass, "Cliente Senha", "90000000044", newer),
  ]);
});

test("admin credita convidado uma vez, isolado por loja, e o cliente consegue entrar", async () => {
  const guestLoja = `guest:${EMAILS.loja}`;
  const preview = await call("GET", `/api/admin/wallet/${encodeURIComponent(guestLoja)}`, TOKENS.primary);
  assert.equal(preview.status, 200);
  assert.equal(preview.json.availableCredit, 0);
  assert.equal((await usersByEmail(EMAILS.loja)).length, 0);

  const seller = await call("POST", "/api/admin/wallet/adjust", TOKENS.seller, {
    customerUserId: guestLoja,
    amount: 145,
    reason: "gwc-seller",
    idempotencyKey: "gwc-seller-key",
  });
  assert.equal(seller.status, 403);
  assert.equal((await usersByEmail(EMAILS.loja)).length, 0);

  const filialCross = await call("POST", "/api/admin/wallet/adjust", TOKENS.filial, {
    customerUserId: guestLoja,
    amount: 145,
    reason: "gwc-filial-cruza",
    idempotencyKey: "gwc-filial-cruza",
  });
  assert.equal(filialCross.status, 404);
  assert.equal((await usersByEmail(EMAILS.loja)).length, 0);
  assert.equal(await orderUserId(ORDERS.lojaNew), null);

  const lojaCross = await call("POST", "/api/admin/wallet/adjust", TOKENS.primary, {
    customerUserId: `guest:${EMAILS.filial}`,
    amount: 145,
    reason: "gwc-loja-cruza",
    idempotencyKey: "gwc-loja-cruza",
  });
  assert.equal(lojaCross.status, 404);
  assert.equal((await usersByEmail(EMAILS.filial)).length, 0);

  const shortPassword = await call("PATCH", `/api/admin/customers/${encodeURIComponent(`guest:${EMAILS.pass}`)}/password`, TOKENS.primary, {
    password: "curta",
  });
  assert.equal(shortPassword.status, 400);
  assert.equal((await usersByEmail(EMAILS.pass)).length, 0);

  const body = {
    customerUserId: guestLoja,
    amount: 145,
    reason: "gwc-credito-liliany",
    idempotencyKey: "gwc-click-1",
  };
  const [first, second] = await Promise.all([
    call("POST", "/api/admin/wallet/adjust", TOKENS.primary, body),
    call("POST", "/api/admin/wallet/adjust", TOKENS.primary, body),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.json.availableCredit, 145);
  assert.equal(second.json.availableCredit, 145);
  assert.equal(first.json.createdAccount === true || second.json.createdAccount === true, true);

  const created = await usersByEmail(EMAILS.loja);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.tenantId, LOJA);
  assert.equal(created[0]?.name, "Liliany Rodrigues");
  assert.equal(created[0]?.document, "90000000011");
  assert.equal(String(created[0]?.salt || "").startsWith("nopass:"), true);
  assert.equal(await orderUserId(ORDERS.lojaNew), created[0]?.id);
  assert.equal(await orderUserId(ORDERS.lojaOld), created[0]?.id);
  const ledger = await ledgerFor(String(created[0]?.id), LOJA);
  assert.equal(ledger.length, 1);
  assert.equal(Number(ledger[0]?.amount), 145);
  assert.equal(ledger[0]?.type, "admin_adjust");

  const again = await call("POST", "/api/admin/wallet/adjust", TOKENS.primary, {
    ...body,
    amount: 90,
    reason: "gwc-outro-motivo",
  });
  assert.equal(again.status, 409);
  assert.equal((await ledgerFor(String(created[0]?.id), LOJA)).length, 1);

  const extra = await call("POST", "/api/admin/wallet/adjust", TOKENS.primary, {
    customerUserId: guestLoja,
    amount: 10,
    reason: "gwc-segundo-credito",
    idempotencyKey: "gwc-click-2",
  });
  assert.equal(extra.status, 200);
  assert.equal(extra.json.availableCredit, 155);
  assert.equal(extra.json.createdAccount, false);

  const listed = await call("GET", "/api/admin/customers", TOKENS.primary);
  assert.equal(listed.status, 200);
  const rows = listed.json.customers as Array<{ id: string; email: string; hasAccount: boolean }>;
  const listedRow = rows.find((row) => row.email === EMAILS.loja);
  assert.equal(listedRow?.hasAccount, true);
  assert.equal(String(listedRow?.id || "").startsWith("guest:"), false);

  const blockedLogin = await call("POST", "/api/auth/login", "", {
    email: EMAILS.loja,
    password: "senha-que-nao-existe",
  });
  assert.equal(blockedLogin.status, 401);
  assert.equal(blockedLogin.json.error, "PASSWORD_NOT_SET");

  const claimed = await call("POST", "/api/auth/register", "", {
    name: "Liliany Conta",
    email: EMAILS.loja,
    password: "senha-da-liliany",
  });
  assert.equal(claimed.status, 201);
  assert.equal(typeof claimed.json.token, "string");
  const afterClaim = await usersByEmail(EMAILS.loja);
  assert.equal(afterClaim.length, 1);
  assert.equal(afterClaim[0]?.name, "Liliany Conta");
  assert.equal(String(afterClaim[0]?.salt || "").startsWith("nopass:"), false);

  const login = await call("POST", "/api/auth/login", "", {
    email: EMAILS.loja,
    password: "senha-da-liliany",
  });
  assert.equal(login.status, 200);
  assert.equal(typeof login.json.token, "string");

  const duplicateRegister = await call("POST", "/api/auth/register", "", {
    name: "Outra Pessoa",
    email: EMAILS.loja,
    password: "outra-senha-123",
  });
  assert.equal(duplicateRegister.status, 409);
  assert.equal((await usersByEmail(EMAILS.loja))[0]?.name, "Liliany Conta");

  const reused = await call("POST", "/api/admin/wallet/adjust", TOKENS.primary, {
    customerUserId: `guest:${EMAILS.real}`,
    amount: 5,
    reason: "gwc-reuso",
    idempotencyKey: "gwc-reuso",
  });
  assert.equal(reused.status, 200);
  assert.equal(reused.json.createdAccount, false);
  assert.equal(reused.json.userId, "gwc-real-user");
  const real = await usersByEmail(EMAILS.real);
  assert.equal(real.length, 1);
  assert.equal(real[0]?.salt, "salt-real");
  assert.equal(real[0]?.passwordHash, "hash-real");

  const lojaShared = await call("POST", "/api/admin/wallet/adjust", TOKENS.primary, {
    customerUserId: `guest:${EMAILS.shared}`,
    amount: 20,
    reason: "gwc-shared-loja",
    idempotencyKey: "gwc-shared-loja",
  });
  assert.equal(lojaShared.status, 200);
  assert.equal(await orderUserId(ORDERS.sharedFilial), null);
  const filialShared = await call("POST", "/api/admin/wallet/adjust", TOKENS.filial, {
    customerUserId: `guest:${EMAILS.shared}`,
    amount: 7,
    reason: "gwc-shared-filial",
    idempotencyKey: "gwc-shared-filial",
  });
  assert.equal(filialShared.status, 200);
  const sharedUsers = await usersByEmail(EMAILS.shared);
  assert.equal(sharedUsers.length, 2);
  const lojaUser = sharedUsers.find((row) => row.tenantId === LOJA);
  const filialUser = sharedUsers.find((row) => row.tenantId === FILIAL);
  assert.ok(lojaUser && filialUser);
  assert.notEqual(lojaUser.id, filialUser.id);
  assert.equal(await orderUserId(ORDERS.sharedLoja), lojaUser.id);
  assert.equal(await orderUserId(ORDERS.sharedFilial), filialUser.id);
  assert.equal(Number((await ledgerFor(lojaUser.id, LOJA))[0]?.amount), 20);
  assert.equal(Number((await ledgerFor(filialUser.id, FILIAL))[0]?.amount), 7);
  assert.equal((await ledgerFor(lojaUser.id, FILIAL)).length, 0);
  assert.equal((await ledgerFor(filialUser.id, LOJA)).length, 0);

  const sellerPassword = await call("PATCH", `/api/admin/customers/${encodeURIComponent(`guest:${EMAILS.pass}`)}/password`, TOKENS.seller, {
    password: "senha-do-admin",
  });
  assert.equal(sellerPassword.status, 403);
  assert.equal((await usersByEmail(EMAILS.pass)).length, 0);

  const filialPassword = await call("PATCH", `/api/admin/customers/${encodeURIComponent(`guest:${EMAILS.pass}`)}/password`, TOKENS.filial, {
    password: "senha-do-admin",
  });
  assert.equal(filialPassword.status, 404);
  assert.equal((await usersByEmail(EMAILS.pass)).length, 0);

  const setPassword = await call("PATCH", `/api/admin/customers/${encodeURIComponent(`guest:${EMAILS.pass}`)}/password`, TOKENS.primary, {
    password: "senha-do-admin",
  });
  assert.equal(setPassword.status, 200);
  const passUser = await usersByEmail(EMAILS.pass);
  assert.equal(passUser.length, 1);
  assert.equal(String(passUser[0]?.salt || "").startsWith("nopass:"), false);
  assert.equal(await orderUserId(ORDERS.pass), passUser[0]?.id);
  const passLogin = await call("POST", "/api/auth/login", "", {
    email: EMAILS.pass,
    password: "senha-do-admin",
  });
  assert.equal(passLogin.status, 200);
});

test.after(async () => {
  try {
    await cleanup();
  } catch (err) {
    console.error("[guest-wallet-test] cleanup", err);
  }
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await pool.end();
});
