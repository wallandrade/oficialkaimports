/**
 * Canal Envio Shopee, só no MariaDB local.
 * Não lê .env de produção e não altera pedido real.
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
for (const key of ["ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_USERNAME_2", "ADMIN_PASSWORD_2", "GATEWAY_SECRET", "GATEWAY_IDENTIFIER", "DENTPEG_API_KEY", "N8N_ORDER_PAID_WEBHOOK_URL"]) {
  delete process.env[key];
}

const LOJA = "tenant_loja1";
const FILIAL = "tenant_ship_channel_filial";

const { db, pool, adminSessionsTable, adminUsersTable, adminUserTenantsTable, adminSellerScopesTable, orderEventsTable, ordersTable, sellersTable, tenantsTable } = await import("@workspace/db");
const { eq, inArray } = await import("drizzle-orm");
const { ensureRuntimeSchema } = await import("../runtime-schema");
const { default: adminAuthRouter } = await import("./admin-auth");
const { default: ordersRouter } = await import("./orders");

const app = express();
app.use(express.json());
app.use("/api", adminAuthRouter);
app.use("/api", ordersRouter);
const server: Server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
const base = `http://127.0.0.1:${address.port}`;

const primaryToken = "ship-channel-primary";
const filialToken = "ship-channel-filial";
const sellerToken = "ship-channel-seller";
const userIds = ["ship-admin-primary", "ship-admin-filial", "ship-admin-seller"];
const orderIds = ["ship-order-ana", "ship-order-bia", "ship-order-filial"];
const guestToken = "ship-guest-token-ana";

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
  return { status: response.status, json: text ? JSON.parse(text) as Record<string, unknown> : {} };
}

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
    shippingType: "PAC",
    subtotal: "10.00",
    shippingCost: "0.00",
    insuranceAmount: "0.00",
    total: "10.00",
    status: "paid",
    enviado: false,
    paymentMethod: "pix",
    guestAccessToken: id === "ship-order-ana" ? guestToken : null,
  };
}

async function stored(id: string) {
  const [row] = await db.select({
    status: ordersTable.status,
    enviado: ordersTable.enviado,
    shippingVia: ordersTable.shippingVia,
    tenantId: ordersTable.tenantId,
    sellerCode: ordersTable.sellerCode,
  }).from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
  return row;
}

test.before(async () => {
  await ensureRuntimeSchema();
  await db.delete(orderEventsTable).where(inArray(orderEventsTable.orderId, orderIds));
  await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  await db.delete(adminSessionsTable).where(inArray(adminSessionsTable.token, [primaryToken, filialToken, sellerToken]));
  await db.delete(adminSellerScopesTable).where(inArray(adminSellerScopesTable.adminUserId, userIds));
  await db.delete(adminUserTenantsTable).where(inArray(adminUserTenantsTable.adminUserId, userIds));
  await db.delete(adminUsersTable).where(inArray(adminUsersTable.id, userIds));
  await db.delete(sellersTable).where(inArray(sellersTable.slug, ["ship-ana", "ship-bia", "ship-filial-ana"]));
  await db.insert(tenantsTable).values({ id: FILIAL, slug: "ship-channel-filial", name: "Filial Sintetica", status: "active" }).onDuplicateKeyUpdate({ set: { name: "Filial Sintetica" } });
  await db.insert(sellersTable).values([
    { slug: "ship-ana", tenantId: LOJA, whatsapp: "11900000021", commissionRate: "5.00" },
    { slug: "ship-bia", tenantId: LOJA, whatsapp: "11900000022", commissionRate: "5.00" },
    { slug: "ship-filial-ana", tenantId: FILIAL, whatsapp: "11900000023", commissionRate: "5.00" },
  ]);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(adminUsersTable).values([
    { id: "ship-admin-primary", username: "ship-primary", passwordHash: "hash", salt: "salt", isPrimary: true },
    { id: "ship-admin-filial", username: "ship-filial", passwordHash: "hash", salt: "salt", isPrimary: false },
    { id: "ship-admin-seller", username: "ship-seller", passwordHash: "hash", salt: "salt", isPrimary: false },
  ]);
  await db.insert(adminUserTenantsTable).values({ adminUserId: "ship-admin-filial", tenantId: FILIAL, role: "owner" });
  await db.insert(adminSellerScopesTable).values({
    adminUserId: "ship-admin-seller",
    tenantId: LOJA,
    sellerCode: "ship-ana",
    status: "linked",
  });
  await db.insert(adminSessionsTable).values([
    { token: primaryToken, username: "ship-primary", adminUserId: "ship-admin-primary", tenantId: LOJA, isPrimary: 1, expiresAt, createdAt: new Date() },
    { token: filialToken, username: "ship-filial", adminUserId: "ship-admin-filial", tenantId: FILIAL, isPrimary: 0, expiresAt, createdAt: new Date() },
    { token: sellerToken, username: "ship-seller", adminUserId: "ship-admin-seller", tenantId: LOJA, isPrimary: 0, expiresAt, createdAt: new Date() },
  ]);
  await db.insert(ordersTable).values([
    order("ship-order-ana", LOJA, "ship-ana"),
    order("ship-order-bia", LOJA, "ship-bia"),
    order("ship-order-filial", FILIAL, "ship-filial-ana"),
  ]);
});

test("PATCH do canal Shopee respeita loja, vendedor e o texto do cliente", async () => {
  const missingAuth = await call("PATCH", "/api/admin/orders/ship-order-ana/shipping-channel", "", { shippingVia: "shopee" });
  assert.equal(missingAuth.status, 401);

  const missingField = await call("PATCH", "/api/admin/orders/ship-order-ana/shipping-channel", primaryToken, {});
  assert.equal(missingField.status, 400);
  const invalid = await call("PATCH", "/api/admin/orders/ship-order-ana/shipping-channel", primaryToken, { shippingVia: "correios" });
  assert.equal(invalid.status, 400);
  const postal = await call("PATCH", "/api/admin/orders/ship-order-ana/shipping-channel", primaryToken, { shippingVia: "postal" });
  assert.equal(postal.status, 400);
  const number = await call("PATCH", "/api/admin/orders/ship-order-ana/shipping-channel", primaryToken, { shippingVia: 12 });
  assert.equal(number.status, 400);
  assert.equal((await stored("ship-order-ana"))?.shippingVia ?? null, null);

  const shopee = await call("PATCH", "/api/admin/orders/ship-order-ana/shipping-channel", primaryToken, { shippingVia: "SHOPEE" });
  assert.equal(shopee.status, 200);
  assert.equal(shopee.json.shippingVia, "shopee");
  const afterShopee = await stored("ship-order-ana");
  assert.equal(afterShopee?.shippingVia, "shopee");
  assert.equal(afterShopee?.status, "paid");
  assert.equal(afterShopee?.enviado, false);

  for (const value of [null, "", "normal", "Padrão"]) {
    const cleared = await call("PATCH", "/api/admin/orders/ship-order-ana/shipping-channel", primaryToken, { shippingVia: value });
    assert.equal(cleared.status, 200, `valor ${JSON.stringify(value)}`);
    assert.equal(cleared.json.shippingVia, null);
    assert.equal((await stored("ship-order-ana"))?.shippingVia ?? null, null);
  }

  const sellerOwn = await call("PATCH", "/api/admin/orders/ship-order-ana/shipping-channel", sellerToken, { shippingVia: "shopee" });
  assert.equal(sellerOwn.status, 200);
  const sellerOther = await call("PATCH", "/api/admin/orders/ship-order-bia/shipping-channel", sellerToken, { shippingVia: "shopee" });
  assert.equal(sellerOther.status, 404);
  const sellerOtherStore = await call("PATCH", "/api/admin/orders/ship-order-filial/shipping-channel", sellerToken, { shippingVia: "shopee" });
  assert.equal(sellerOtherStore.status, 404);
  assert.equal((await stored("ship-order-bia"))?.shippingVia ?? null, null);
  assert.equal((await stored("ship-order-filial"))?.shippingVia ?? null, null);

  const otherStore = await call("PATCH", "/api/admin/orders/ship-order-filial/shipping-channel", primaryToken, { shippingVia: "shopee" });
  assert.equal(otherStore.status, 404);
  const missingOrder = await call("PATCH", "/api/admin/orders/ship-order-ausente/shipping-channel", primaryToken, { shippingVia: "shopee" });
  assert.equal(missingOrder.status, 404);
  assert.equal((await stored("ship-order-filial"))?.shippingVia ?? null, null);

  const filialOwn = await call("PATCH", "/api/admin/orders/ship-order-filial/shipping-channel", filialToken, { shippingVia: "shopee" });
  assert.equal(filialOwn.status, 200);
  assert.equal((await stored("ship-order-filial"))?.shippingVia, "shopee");
  const filialCross = await call("PATCH", "/api/admin/orders/ship-order-ana/shipping-channel", filialToken, { shippingVia: null });
  assert.equal(filialCross.status, 404);
  assert.equal((await stored("ship-order-ana"))?.shippingVia, "shopee");
  assert.equal((await stored("ship-order-ana"))?.status, "paid");

  const list = await call("GET", "/api/admin/orders", primaryToken);
  assert.equal(list.status, 200);
  const listed = (list.json.orders as Array<{ id: string; shippingVia?: string | null }>).find((row) => row.id === "ship-order-ana");
  assert.equal(listed?.shippingVia, "shopee");
  const sellerList = await call("GET", "/api/admin/orders", sellerToken);
  const sellerRows = sellerList.json.orders as Array<{ id: string; shippingVia?: string | null }>;
  assert.equal(sellerRows.some((row) => row.id === "ship-order-bia" || row.id === "ship-order-filial"), false);
  assert.equal(sellerRows.find((row) => row.id === "ship-order-ana")?.shippingVia, "shopee");

  const guest = await fetch(`${base}/api/orders/guest/ship-order-ana?token=${guestToken}`);
  const guestJson = await guest.json() as { order?: Record<string, unknown> };
  assert.equal(guest.status, 200);
  assert.equal(guestJson.order?.clientName, "Pessoa Sintetica");
  assert.equal(Object.prototype.hasOwnProperty.call(guestJson.order || {}, "shippingVia"), false);
});

test.after(async () => {
  await db.delete(orderEventsTable).where(inArray(orderEventsTable.orderId, orderIds));
  await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  await db.delete(adminSessionsTable).where(inArray(adminSessionsTable.token, [primaryToken, filialToken, sellerToken]));
  await db.delete(adminSellerScopesTable).where(inArray(adminSellerScopesTable.adminUserId, userIds));
  await db.delete(adminUserTenantsTable).where(inArray(adminUserTenantsTable.adminUserId, userIds));
  await db.delete(adminUsersTable).where(inArray(adminUsersTable.id, userIds));
  await db.delete(sellersTable).where(inArray(sellersTable.slug, ["ship-ana", "ship-bia", "ship-filial-ana"]));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, FILIAL));
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await pool.end();
});
