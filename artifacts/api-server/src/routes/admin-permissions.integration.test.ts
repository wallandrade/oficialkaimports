/**
 * Rotas reais de permissão contra o MariaDB só em 127.0.0.1.
 * Não lê .env, não usa sessão real e recusa outro host.
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
process.env.ADMIN_SELLER_SCOPE_MAP = JSON.stringify({ "perm-seller": "vendedor-loja1" });

const LOJA = "tenant_loja1";
const FILIAL = "tenant_perm_filial";
const TOKENS = {
  primary: "perm-token-primary",
  filial: "perm-token-filial",
  seller: "perm-token-seller",
};
const CUSTOMERS = {
  loja: "perm-customer-loja",
  filial: "perm-customer-filial",
};
const RAFFLES = {
  lojaKeep: "perm-raffle-loja-keep",
  lojaPaid: "perm-raffle-loja-paid",
  lojaDelete: "perm-raffle-loja-delete",
  filialCancel: "perm-raffle-filial-cancel",
  filialPaid: "perm-raffle-filial-paid",
  filialDelete: "perm-raffle-filial-delete",
};
const RESERVATIONS = {
  lojaKeep: "perm-res-loja-keep",
  lojaPaid: "perm-res-loja-paid",
  filialCancel: "perm-res-filial-cancel",
  filialPaid: "perm-res-filial-paid",
};

const { db, pool, adminSessionsTable, customerUsersTable, customerWalletLedgerTable, raffleReservationsTable, rafflesTable, sellersTable } = await import("@workspace/db");
const { eq, inArray } = await import("drizzle-orm");
const { default: sellersRouter } = await import("./sellers");
const { default: customerRouter } = await import("./customer-auth");
const { default: raffleRouter } = await import("./raffles");
const { default: walletRouter } = await import("./wallet");

const app = express();
app.use(express.json());
app.use("/api", sellersRouter);
app.use("/api", customerRouter);
app.use("/api", raffleRouter);
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
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) as Record<string, unknown> : {};
  return { status: response.status, json };
}

async function sellerRow(slug: string) {
  const [row] = await db.select().from(sellersTable).where(eq(sellersTable.slug, slug)).limit(1);
  return row;
}

test.before(async () => {
  await db.delete(adminSessionsTable).where(inArray(adminSessionsTable.token, Object.values(TOKENS)));
  await db.delete(customerWalletLedgerTable).where(inArray(customerWalletLedgerTable.userId, Object.values(CUSTOMERS)));
  await db.delete(customerUsersTable).where(inArray(customerUsersTable.id, Object.values(CUSTOMERS)));
  await db.delete(raffleReservationsTable).where(inArray(raffleReservationsTable.id, Object.values(RESERVATIONS)));
  await db.delete(rafflesTable).where(inArray(rafflesTable.id, Object.values(RAFFLES)));
  await db.delete(sellersTable).where(inArray(sellersTable.slug, ["perm-joao", "perm-filial-joao", "perm-legado", "perm-corrida"]));

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(adminSessionsTable).values([
    { token: TOKENS.primary, username: "perm-primary", tenantId: LOJA, isPrimary: 1, expiresAt, createdAt: new Date() },
    { token: TOKENS.filial, username: "perm-filial", tenantId: FILIAL, isPrimary: 0, expiresAt, createdAt: new Date() },
    { token: TOKENS.seller, username: "perm-seller", tenantId: LOJA, isPrimary: 0, expiresAt, createdAt: new Date() },
  ]);
  await db.insert(customerUsersTable).values([
    { id: CUSTOMERS.loja, tenantId: LOJA, name: "Cliente Loja", email: "perm-loja@example.test", passwordHash: "hash", salt: "salt" },
    { id: CUSTOMERS.filial, tenantId: FILIAL, name: "Cliente Filial", email: "perm-filial@example.test", passwordHash: "hash", salt: "salt" },
  ]);
  await db.insert(customerWalletLedgerTable).values([
    { id: "perm-ledger-loja", tenantId: LOJA, userId: CUSTOMERS.loja, type: "admin_adjust", amount: "15.50", note: "sintetico" },
    { id: "perm-ledger-filial", tenantId: FILIAL, userId: CUSTOMERS.filial, type: "admin_adjust", amount: "8.25", note: "sintetico" },
  ]);

  const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(rafflesTable).values([
    { id: RAFFLES.lojaKeep, tenantId: LOJA, title: "Rifa loja", totalNumbers: 10, pricePerNumber: "5.00" },
    { id: RAFFLES.lojaPaid, tenantId: LOJA, title: "Rifa loja paga", totalNumbers: 10, pricePerNumber: "5.00" },
    { id: RAFFLES.lojaDelete, tenantId: LOJA, title: "Rifa loja apagar", totalNumbers: 10, pricePerNumber: "5.00" },
    { id: RAFFLES.filialCancel, tenantId: FILIAL, title: "Rifa filial cancela", totalNumbers: 10, pricePerNumber: "5.00" },
    { id: RAFFLES.filialPaid, tenantId: FILIAL, title: "Rifa filial paga", totalNumbers: 10, pricePerNumber: "5.00" },
    { id: RAFFLES.filialDelete, tenantId: FILIAL, title: "Rifa filial apagar", totalNumbers: 10, pricePerNumber: "5.00" },
  ]);
  await db.insert(raffleReservationsTable).values([
    reservation(RESERVATIONS.lojaKeep, RAFFLES.lojaKeep, LOJA, "[1]", later),
    reservation(RESERVATIONS.lojaPaid, RAFFLES.lojaPaid, LOJA, "[2]", later),
    reservation(RESERVATIONS.filialCancel, RAFFLES.filialCancel, FILIAL, "[3]", later),
    reservation(RESERVATIONS.filialPaid, RAFFLES.filialPaid, FILIAL, "[4]", later),
  ]);
});

function reservation(id: string, raffleId: string, tenantId: string, numbers: string, expiresAt: Date) {
  return {
    id,
    tenantId,
    raffleId,
    numbers,
    clientName: "Pessoa Sintetica",
    clientEmail: "sintetico@example.test",
    clientPhone: "11999999999",
    totalAmount: "5.00",
    status: "reserved",
    expiresAt,
  };
}

test("slug repetido não altera contato nem comissão da outra loja", async () => {
  const created = await call("POST", "/api/admin/sellers", TOKENS.primary, {
    slug: "perm-joao",
    whatsapp: "11911111111",
    commissionRate: 5,
  });
  assert.equal(created.status, 200);

  const blocked = await call("POST", "/api/admin/sellers", TOKENS.filial, {
    slug: "perm-joao",
    whatsapp: "11922222222",
    commissionRate: 20,
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, "SLUG_IN_OTHER_STORE");

  const scoped = await call("POST", "/api/admin/sellers", TOKENS.seller, {
    slug: "perm-joao",
    whatsapp: "11955555555",
    commissionRate: 30,
  });
  assert.equal(scoped.status, 403);

  const loja = await sellerRow("perm-joao");
  assert.equal(loja?.tenantId, LOJA);
  assert.equal(loja?.whatsapp, "11911111111");
  assert.equal(Number(loja?.commissionRate), 5);

  const own = await call("POST", "/api/admin/sellers", TOKENS.filial, {
    slug: "perm-filial-joao",
    whatsapp: "11933333333",
    commissionRate: 7,
  });
  assert.equal(own.status, 200);
  const again = await call("POST", "/api/admin/sellers", TOKENS.filial, {
    slug: "perm-filial-joao",
    whatsapp: "11933330000",
    commissionRate: 8,
  });
  assert.equal(again.status, 200);
  const filialSeller = await sellerRow("perm-filial-joao");
  assert.equal(filialSeller?.tenantId, FILIAL);
  assert.equal(filialSeller?.whatsapp, "11933330000");
  assert.equal(Number(filialSeller?.commissionRate), 8);
  const lojaAfter = await sellerRow("perm-joao");
  assert.equal(lojaAfter?.whatsapp, "11911111111");
  assert.equal(Number(lojaAfter?.commissionRate), 5);
});

test("slug legado da loja 1 e corrida entre lojas não gravam a linha alheia", async () => {
  await db.insert(sellersTable).values({
    slug: "perm-legado",
    tenantId: null,
    whatsapp: "11900000000",
    hasCommission: true,
    commissionRate: "4.00",
  });
  const blocked = await call("POST", "/api/admin/sellers", TOKENS.filial, {
    slug: "perm-legado",
    whatsapp: "11966666666",
    commissionRate: 11,
  });
  assert.equal(blocked.status, 409);
  const legacy = await sellerRow("perm-legado");
  assert.equal(legacy?.whatsapp, "11900000000");
  assert.equal(Number(legacy?.commissionRate), 4);

  const updated = await call("POST", "/api/admin/sellers", TOKENS.primary, {
    slug: "perm-legado",
    whatsapp: "11944444444",
    commissionRate: 6,
  });
  assert.equal(updated.status, 200);
  const legacyAfter = await sellerRow("perm-legado");
  assert.equal(legacyAfter?.whatsapp, "11944444444");
  assert.equal(Number(legacyAfter?.commissionRate), 6);
  assert.equal(String(legacyAfter?.tenantId || ""), "");

  const [lojaRace, filialRace] = await Promise.all([
    call("POST", "/api/admin/sellers", TOKENS.primary, { slug: "perm-corrida", whatsapp: "11910000001", commissionRate: 5 }),
    call("POST", "/api/admin/sellers", TOKENS.filial, { slug: "perm-corrida", whatsapp: "11910000002", commissionRate: 9 }),
  ]);
  const statuses = [lojaRace.status, filialRace.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const race = await sellerRow("perm-corrida");
  const lojaWon = lojaRace.status === 200;
  assert.equal(race?.tenantId, lojaWon ? LOJA : FILIAL);
  assert.equal(race?.whatsapp, lojaWon ? "11910000001" : "11910000002");
  assert.equal(Number(race?.commissionRate), lojaWon ? 5 : 9);
});

test("impersonação respeita a loja e o superadmin continua podendo atravessar", async () => {
  const own = await call("POST", `/api/admin/customers/${CUSTOMERS.filial}/impersonate`, TOKENS.filial);
  assert.equal(own.status, 200);
  assert.equal((own.json.user as { id?: string })?.id, CUSTOMERS.filial);
  assert.equal(typeof own.json.token, "string");

  const other = await call("POST", `/api/admin/customers/${CUSTOMERS.loja}/impersonate`, TOKENS.filial);
  const missing = await call("POST", "/api/admin/customers/perm-customer-ausente/impersonate", TOKENS.filial);
  assert.equal(other.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(other.json.error, "NOT_FOUND");
  assert.equal(missing.json.error, "NOT_FOUND");
  assert.equal(other.json.token, undefined);
  assert.equal(missing.json.token, undefined);

  const scoped = await call("POST", `/api/admin/customers/${CUSTOMERS.loja}/impersonate`, TOKENS.seller);
  assert.equal(scoped.status, 403);

  const cross = await call("POST", `/api/admin/customers/${CUSTOMERS.filial}/impersonate`, TOKENS.primary);
  assert.equal(cross.status, 200);
  assert.equal((cross.json.user as { id?: string })?.id, CUSTOMERS.filial);
});

test("rifa e carteira exigem acesso amplo e não atravessam a loja", async () => {
  const sellerPaid = await call("PATCH", `/api/admin/raffles/${RAFFLES.lojaKeep}/reservations/${RESERVATIONS.lojaKeep}/mark-paid`, TOKENS.seller);
  const sellerMissing = await call("PATCH", "/api/admin/raffles/perm-raffle-ausente/reservations/perm-res-ausente/mark-paid", TOKENS.seller);
  const sellerCancel = await call("PATCH", `/api/admin/raffles/${RAFFLES.lojaKeep}/reservations/${RESERVATIONS.lojaKeep}/cancel`, TOKENS.seller);
  const sellerDelete = await call("DELETE", `/api/admin/raffles/${RAFFLES.lojaKeep}`, TOKENS.seller);
  assert.equal(sellerPaid.status, 403);
  assert.equal(sellerMissing.status, 403);
  assert.equal(sellerCancel.status, 403);
  assert.equal(sellerDelete.status, 403);

  const filialOtherPaid = await call("PATCH", `/api/admin/raffles/${RAFFLES.lojaKeep}/reservations/${RESERVATIONS.lojaKeep}/mark-paid`, TOKENS.filial);
  const filialMissingPaid = await call("PATCH", "/api/admin/raffles/perm-raffle-ausente/reservations/perm-res-ausente/mark-paid", TOKENS.filial);
  const filialOtherDelete = await call("DELETE", `/api/admin/raffles/${RAFFLES.lojaKeep}`, TOKENS.filial);
  const filialMissingDelete = await call("DELETE", "/api/admin/raffles/perm-raffle-ausente", TOKENS.filial);
  assert.equal(filialOtherPaid.status, 404);
  assert.equal(filialMissingPaid.status, 404);
  assert.equal(filialOtherDelete.status, 404);
  assert.equal(filialMissingDelete.status, 404);

  const [kept] = await db.select({ status: raffleReservationsTable.status }).from(raffleReservationsTable).where(eq(raffleReservationsTable.id, RESERVATIONS.lojaKeep));
  assert.equal(kept?.status, "reserved");
  const [keptRaffle] = await db.select({ id: rafflesTable.id }).from(rafflesTable).where(eq(rafflesTable.id, RAFFLES.lojaKeep));
  assert.equal(keptRaffle?.id, RAFFLES.lojaKeep);

  const filialPaid = await call("PATCH", `/api/admin/raffles/${RAFFLES.filialPaid}/reservations/${RESERVATIONS.filialPaid}/mark-paid`, TOKENS.filial);
  assert.equal(filialPaid.status, 200);
  const filialCancel = await call("PATCH", `/api/admin/raffles/${RAFFLES.filialCancel}/reservations/${RESERVATIONS.filialCancel}/cancel`, TOKENS.filial);
  assert.equal(filialCancel.status, 200);
  const filialDelete = await call("DELETE", `/api/admin/raffles/${RAFFLES.filialDelete}`, TOKENS.filial);
  assert.equal(filialDelete.status, 200);
  const primaryPaid = await call("PATCH", `/api/admin/raffles/${RAFFLES.lojaPaid}/reservations/${RESERVATIONS.lojaPaid}/mark-paid`, TOKENS.primary);
  assert.equal(primaryPaid.status, 200);
  const primaryDelete = await call("DELETE", `/api/admin/raffles/${RAFFLES.lojaDelete}`, TOKENS.primary);
  assert.equal(primaryDelete.status, 200);

  const [paid] = await db.select({ status: raffleReservationsTable.status, paidSource: raffleReservationsTable.paidSource }).from(raffleReservationsTable).where(eq(raffleReservationsTable.id, RESERVATIONS.filialPaid));
  assert.equal(paid?.status, "paid");
  assert.equal(paid?.paidSource, "manual");
  const [cancelled] = await db.select({ status: raffleReservationsTable.status }).from(raffleReservationsTable).where(eq(raffleReservationsTable.id, RESERVATIONS.filialCancel));
  assert.equal(cancelled?.status, "expired");
  const [removed] = await db.select({ id: rafflesTable.id }).from(rafflesTable).where(eq(rafflesTable.id, RAFFLES.filialDelete));
  assert.equal(removed, undefined);

  const sellerWallet = await call("GET", `/api/admin/wallet/${CUSTOMERS.loja}`, TOKENS.seller);
  const sellerWalletMissing = await call("GET", "/api/admin/wallet/perm-customer-ausente", TOKENS.seller);
  assert.equal(sellerWallet.status, 403);
  assert.equal(sellerWalletMissing.status, 403);

  const filialWallet = await call("GET", `/api/admin/wallet/${CUSTOMERS.filial}`, TOKENS.filial);
  assert.equal(filialWallet.status, 200);
  assert.equal(filialWallet.json.availableCredit, 8.25);
  const filialOtherWallet = await call("GET", `/api/admin/wallet/${CUSTOMERS.loja}`, TOKENS.filial);
  const filialMissingWallet = await call("GET", "/api/admin/wallet/perm-customer-ausente", TOKENS.filial);
  assert.equal(filialOtherWallet.status, 404);
  assert.equal(filialMissingWallet.status, 404);
  assert.equal(filialOtherWallet.json.availableCredit, undefined);

  const primaryWallet = await call("GET", `/api/admin/wallet/${CUSTOMERS.loja}`, TOKENS.primary);
  assert.equal(primaryWallet.status, 200);
  assert.equal(primaryWallet.json.availableCredit, 15.5);
  const primaryOther = await call("GET", `/api/admin/wallet/${CUSTOMERS.filial}`, TOKENS.primary);
  assert.equal(primaryOther.status, 404);
});

test.after(async () => {
  await db.delete(adminSessionsTable).where(inArray(adminSessionsTable.token, Object.values(TOKENS)));
  await db.delete(customerWalletLedgerTable).where(inArray(customerWalletLedgerTable.id, ["perm-ledger-loja", "perm-ledger-filial"]));
  await db.delete(customerUsersTable).where(inArray(customerUsersTable.id, Object.values(CUSTOMERS)));
  await db.delete(raffleReservationsTable).where(inArray(raffleReservationsTable.raffleId, Object.values(RAFFLES)));
  await db.delete(rafflesTable).where(inArray(rafflesTable.id, Object.values(RAFFLES)));
  await db.delete(sellersTable).where(inArray(sellersTable.slug, ["perm-joao", "perm-filial-joao", "perm-legado", "perm-corrida"]));
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await pool.end();
});
