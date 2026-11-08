/**
 * Login de vendedor e histórico do pedido, só no MariaDB local.
 * Não lê .env e não usa conta real.
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
process.env.ADMIN_SELLER_SCOPE_MAP = JSON.stringify({ "perm-legado": "perm-mapa" });

const LOJA = "tenant_loja1";
const FILIAL = "tenant_perm_scope_filial";

const { db, pool, adminSessionsTable, adminUsersTable, adminUserTenantsTable, adminSellerScopesTable, orderEventsTable, ordersTable, sellersTable, tenantsTable } = await import("@workspace/db");
const { eq, inArray } = await import("drizzle-orm");
const { ensureRuntimeSchema } = await import("../runtime-schema");
const { default: adminAuthRouter } = await import("./admin-auth");
const { default: ordersRouter } = await import("./orders");
const { default: productsRouter } = await import("./products");

const app = express();
app.use(express.json());
app.use("/api", adminAuthRouter);
app.use("/api", ordersRouter);
app.use("/api", productsRouter);
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
  return { status: response.status, json: text ? JSON.parse(text) as Record<string, unknown> : {} };
}

const primaryToken = "perm-scope-primary";
const filialToken = "perm-scope-filial";
const legacyToken = "perm-scope-legacy";
const userIds = ["perm-admin-primary", "perm-admin-filial", "perm-admin-legacy"];
const orderIds = ["perm-order-ana", "perm-order-bia", "perm-order-filial", "perm-order-mapa"];

test.before(async () => {
  await ensureRuntimeSchema();
  await db.delete(orderEventsTable).where(inArray(orderEventsTable.orderId, orderIds));
  await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  await db.delete(adminSessionsTable).where(inArray(adminSessionsTable.token, [primaryToken, filialToken, legacyToken]));
  await db.delete(adminSellerScopesTable).where(inArray(adminSellerScopesTable.adminUserId, userIds));
  await db.delete(adminUserTenantsTable).where(inArray(adminUserTenantsTable.adminUserId, userIds));
  await db.delete(adminUsersTable).where(inArray(adminUsersTable.id, userIds));
  await db.delete(sellersTable).where(inArray(sellersTable.slug, ["perm-ana", "perm-bia", "perm-filial-ana", "perm-mapa"]));
  await db.insert(tenantsTable).values({ id: FILIAL, slug: "perm-scope-filial", name: "Filial Sintetica", status: "active" }).onDuplicateKeyUpdate({ set: { name: "Filial Sintetica" } });
  await db.insert(sellersTable).values([
    { slug: "perm-ana", tenantId: LOJA, whatsapp: "11900000001", commissionRate: "5.00" },
    { slug: "perm-bia", tenantId: LOJA, whatsapp: "11900000002", commissionRate: "5.00" },
    { slug: "perm-filial-ana", tenantId: FILIAL, whatsapp: "11900000003", commissionRate: "5.00" },
    { slug: "perm-mapa", tenantId: LOJA, whatsapp: "11900000004", commissionRate: "5.00" },
  ]);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(adminUsersTable).values([
    { id: "perm-admin-primary", username: "perm-primary", passwordHash: "hash", salt: "salt", isPrimary: true },
    { id: "perm-admin-filial", username: "perm-filial", passwordHash: "hash", salt: "salt", isPrimary: false },
    { id: "perm-admin-legacy", username: "perm-legado", passwordHash: "hash", salt: "salt", isPrimary: false },
  ]);
  await db.insert(adminUserTenantsTable).values({ adminUserId: "perm-admin-filial", tenantId: FILIAL, role: "owner" });
  await db.insert(adminSessionsTable).values([
    { token: primaryToken, username: "perm-primary", adminUserId: "perm-admin-primary", tenantId: LOJA, isPrimary: 1, expiresAt, createdAt: new Date() },
    { token: filialToken, username: "perm-filial", adminUserId: "perm-admin-filial", tenantId: FILIAL, isPrimary: 0, expiresAt, createdAt: new Date() },
    { token: legacyToken, username: "perm-legado", adminUserId: "perm-admin-legacy", tenantId: LOJA, isPrimary: 0, expiresAt, createdAt: new Date() },
  ]);
  await db.insert(ordersTable).values([
    order("perm-order-ana", LOJA, "perm-ana"),
    order("perm-order-bia", LOJA, "perm-bia"),
    order("perm-order-filial", FILIAL, "perm-filial-ana"),
    order("perm-order-mapa", LOJA, "perm-mapa"),
  ]);
});

function order(id: string, tenantId: string, sellerCode: string) {
  return {
    id,
    tenantId,
    sellerCode,
    clientName: "Pessoa Sintetica",
    clientEmail: `${id}@example.test`,
    clientPhone: "11999999999",
    clientDocument: "00000000000",
    products: [{ id: "sku", name: "Item", quantity: 1, price: 10 }],
    shippingType: "normal",
    subtotal: "10.00",
    shippingCost: "0.00",
    insuranceAmount: "0.00",
    total: "10.00",
    status: "pending",
    paymentMethod: "pix",
  };
}

test("superadmin vincula o vendedor e a filial não ganha essa tela", async () => {
  const wrongStore = await call("POST", "/api/admin/users", primaryToken, {
    username: "perm-errado", password: "senha-teste-123", fullAccess: false, sellerTenantId: LOJA, sellerSlug: "perm-filial-ana",
  });
  assert.equal(wrongStore.status, 400);

  const created = await call("POST", "/api/admin/users", primaryToken, {
    username: "perm-ana-login", password: "senha-teste-123", fullAccess: false, sellerTenantId: LOJA, sellerSlug: "perm-ana",
  });
  assert.equal(created.status, 201);
  const filialSeller = await call("POST", "/api/admin/users", primaryToken, {
    username: "perm-filial-login", password: "senha-teste-123", fullAccess: false, sellerTenantId: FILIAL, sellerSlug: "perm-filial-ana",
  });
  assert.equal(filialSeller.status, 201);

  const filialTries = await call("POST", "/api/admin/users", filialToken, {
    username: "perm-nao", password: "senha-teste-123", fullAccess: false, sellerTenantId: FILIAL, sellerSlug: "perm-filial-ana",
  });
  assert.equal(filialTries.status, 403);

  const login = await call("POST", "/api/admin/login", "", { username: "perm-ana-login", password: "senha-teste-123" });
  assert.equal(login.status, 200);
  const sellerToken = String(login.json.token || "");
  assert.equal(login.json.sellerCode, "perm-ana");
  assert.equal(login.json.hasGlobalAccess, false);

  const own = await call("PATCH", "/api/admin/orders/perm-order-ana/status", sellerToken, { status: "paid" });
  assert.equal(own.status, 200);
  const other = await call("PATCH", "/api/admin/orders/perm-order-bia/status", sellerToken, { status: "paid" });
  assert.equal(other.status, 404);
  const otherStore = await call("PATCH", "/api/admin/orders/perm-order-filial/status", sellerToken, { status: "paid" });
  assert.equal(otherStore.status, 404);
  const products = await call("GET", "/api/admin/products", sellerToken);
  assert.equal(products.status, 403);
  const filialProducts = await call("GET", "/api/admin/products", filialToken);
  assert.equal(filialProducts.status, 200);
  const filialSellerLogin = await call("POST", "/api/admin/login", "", { username: "perm-filial-login", password: "senha-teste-123" });
  assert.equal(filialSellerLogin.json.hasGlobalAccess, false);
  const filialSellerProducts = await call("GET", "/api/admin/products", String(filialSellerLogin.json.token || ""));
  assert.equal(filialSellerProducts.status, 403);

  const events = await call("GET", "/api/admin/orders/perm-order-ana/events", sellerToken);
  const list = events.json.events as Array<{ action: string; actorUsername: string | null; actorAdminUserId: string | null }>;
  const paid = list.find((event) => event.action === "marked_paid");
  assert.equal(paid?.actorUsername, "perm-ana-login");
  assert.ok(paid?.actorAdminUserId);
  const adminId = String(paid?.actorAdminUserId);

  await db.update(adminUsersTable).set({ username: "perm-ana-nova" }).where(eq(adminUsersTable.username, "perm-ana-login"));
  const again = await call("PATCH", "/api/admin/orders/perm-order-ana/status", sellerToken, { status: "completed" });
  assert.equal(again.status, 200);
  const eventsAfter = await call("GET", "/api/admin/orders/perm-order-ana/events", sellerToken);
  const rows = eventsAfter.json.events as Array<{ action: string; actorUsername: string | null; actorAdminUserId: string | null }>;
  const first = rows.find((event) => event.action === "marked_paid");
  const second = rows.find((event) => event.action === "status_changed");
  assert.equal(first?.actorUsername, "perm-ana-login");
  assert.equal(first?.actorAdminUserId, adminId);
  assert.equal(second?.actorUsername, "perm-ana-nova");
  assert.equal(second?.actorAdminUserId, adminId);

  const legacy = await call("PATCH", "/api/admin/orders/perm-order-mapa/status", legacyToken, { status: "paid" });
  assert.equal(legacy.status, 200);
  const removed = await call("PATCH", "/api/admin/users/perm-admin-legacy/seller-scope", primaryToken, { clear: true });
  assert.equal(removed.status, 200);
  const legacyAfter = await call("GET", "/api/admin/orders", legacyToken);
  assert.equal(legacyAfter.status, 403);

  const moved = await call("PATCH", `/api/admin/users/${adminId}/seller-scope`, primaryToken, { tenantId: LOJA, sellerSlug: "perm-bia" });
  assert.equal(moved.status, 200);
  const nowBia = await call("PATCH", "/api/admin/orders/perm-order-bia/status", sellerToken, { status: "paid" });
  assert.equal(nowBia.status, 200);
  const notAna = await call("PATCH", "/api/admin/orders/perm-order-ana/status", sellerToken, { status: "cancelled" });
  assert.equal(notAna.status, 404);
});

test.after(async () => {
  const created = await db.select({ id: adminUsersTable.id }).from(adminUsersTable).where(inArray(adminUsersTable.username, ["perm-ana-login", "perm-ana-nova", "perm-filial-login", "perm-errado"]));
  const createdIds = created.map((row) => row.id);
  await db.delete(orderEventsTable).where(inArray(orderEventsTable.orderId, orderIds));
  await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  await db.delete(adminSessionsTable).where(inArray(adminSessionsTable.adminUserId, [...userIds, ...createdIds]));
  await db.delete(adminSellerScopesTable).where(inArray(adminSellerScopesTable.adminUserId, [...userIds, ...createdIds]));
  await db.delete(adminUserTenantsTable).where(inArray(adminUserTenantsTable.adminUserId, [...userIds, ...createdIds]));
  await db.delete(adminUsersTable).where(inArray(adminUsersTable.id, [...userIds, ...createdIds]));
  await db.delete(sellersTable).where(inArray(sellersTable.slug, ["perm-ana", "perm-bia", "perm-filial-ana", "perm-mapa"]));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, FILIAL));
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await pool.end();
});
