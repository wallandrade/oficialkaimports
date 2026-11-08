/**
 * Roda o patch só contra o MariaDB local descartável.
 * Recusa qualquer outro host. Não lê .env.
 */
import assert from "node:assert/strict";
import test from "node:test";

const databaseUrl = String(process.env.DATABASE_URL || "");
const parsed = new URL(databaseUrl);
if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/pix_settlement_test") {
  throw new Error("Recusando banco que não é o pix_settlement_test em 127.0.0.1.");
}

const now = new Date("2026-11-08T15:00:00.000Z");
const recent = new Date(now.getTime() - 2 * 60 * 60 * 1000);
const exactly = new Date(now.getTime() - 72 * 60 * 60 * 1000);
const older = new Date(now.getTime() - 72 * 60 * 60 * 1000 - 60 * 1000);

const { db, pool, ordersTable, productsTable } = await import("../../lib/db/src/index.ts");
const { eq, inArray } = await import("drizzle-orm");
const { patchRecentPaidOrderCostPrices } = await import("./patch-orders-costprice.ts");

const ids = ["cost-recent", "cost-edge", "cost-old", "cost-pending", "cost-broken", "cost-same"];

function order(id: string, status: string, createdAt: Date, products: unknown) {
  return {
    id,
    tenantId: "tenant_loja1",
    clientName: "Pessoa Sintetica",
    clientEmail: "sintetico@example.test",
    clientPhone: "11999999999",
    clientDocument: "00000000000",
    products,
    shippingType: "normal",
    subtotal: "10.00",
    shippingCost: "0.00",
    insuranceAmount: "0.00",
    total: "10.00",
    status,
    paymentMethod: "pix",
    createdAt,
  };
}

test.before(async () => {
  await db.delete(ordersTable).where(inArray(ordersTable.id, ids));
  await db.insert(productsTable).values({
    id: "sku-cost",
    tenantId: "tenant_loja1",
    name: "Item sintetico",
    price: "50.00",
    costPrice: "12.50",
  }).onDuplicateKeyUpdate({ set: { costPrice: "12.50" } });
  await db.insert(productsTable).values({
    id: "sku-zero",
    tenantId: "tenant_loja1",
    name: "Sem custo",
    price: "8.00",
    costPrice: "0.00",
  }).onDuplicateKeyUpdate({ set: { costPrice: "0.00" } });

  await db.insert(ordersTable).values([
    order("cost-recent", "paid", recent, [
      { id: "sku-cost", name: "Item", quantity: "2", price: "50.00", lineDiscount: 5, flashOffer: true },
      { id: "sku-zero", name: "Outro", quantity: 1, price: 8, costPrice: 3 },
      { id: "sku-ausente", name: "Fora", quantity: 1, price: 4, swappedFrom: "antigo" },
    ]),
    order("cost-edge", "completed", exactly, [
      { id: "sku-cost", name: "Borda", quantity: 1, price: 10 },
    ]),
    order("cost-old", "paid", older, [
      { id: "sku-cost", name: "Antigo", quantity: 1, price: 10, costPrice: 1, lineDiscount: 2 },
    ]),
    order("cost-pending", "pending", recent, [
      { id: "sku-cost", name: "Pendente", quantity: 1, price: 10 },
    ]),
    order("cost-broken", "paid", recent, { not: "a list" }),
    order("cost-same", "paid", recent, [
      { id: "sku-cost", name: "Igual", quantity: 1, price: "10", costPrice: 12.5, selectedVariants: [{ groupName: "Cor", option: "Azul" }] },
    ]),
  ]);
});

function storedProducts(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

test("patch local só grava custo novo dentro de 72h", async () => {
  const first = await patchRecentPaidOrderCostPrices(now);
  assert.ok(first.updated >= 2);

  const rows = await db.select({
    id: ordersTable.id,
    status: ordersTable.status,
    total: ordersTable.total,
    products: ordersTable.products,
  }).from(ordersTable).where(inArray(ordersTable.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));

  const recentProducts = storedProducts(byId.get("cost-recent")?.products) as Array<Record<string, unknown>>;
  assert.equal(recentProducts[0].costPrice, 12.5);
  assert.equal(recentProducts[0].quantity, "2");
  assert.equal(recentProducts[0].price, "50.00");
  assert.equal(recentProducts[0].lineDiscount, 5);
  assert.equal(recentProducts[0].flashOffer, true);
  assert.equal(recentProducts[1].costPrice, 3);
  assert.equal(recentProducts[2].swappedFrom, "antigo");
  assert.equal(recentProducts[2].costPrice, undefined);
  assert.equal(byId.get("cost-recent")?.status, "paid");
  assert.equal(String(byId.get("cost-recent")?.total), "10.00");

  const edge = storedProducts(byId.get("cost-edge")?.products) as Array<Record<string, unknown>>;
  assert.equal(edge[0].costPrice, 12.5);

  const old = storedProducts(byId.get("cost-old")?.products) as Array<Record<string, unknown>>;
  assert.equal(old[0].costPrice, 1);
  assert.equal(old[0].lineDiscount, 2);

  const pending = storedProducts(byId.get("cost-pending")?.products) as Array<Record<string, unknown>>;
  assert.equal(pending[0].costPrice, undefined);

  assert.deepEqual(storedProducts(byId.get("cost-broken")?.products), { not: "a list" });

  const same = storedProducts(byId.get("cost-same")?.products) as Array<Record<string, unknown>>;
  assert.equal(same[0].costPrice, 12.5);
  assert.deepEqual(same[0].selectedVariants, [{ groupName: "Cor", option: "Azul" }]);

  const second = await patchRecentPaidOrderCostPrices(now);
  assert.equal(second.updated, 0);
});

test.after(async () => {
  await db.delete(ordersTable).where(inArray(ordersTable.id, ids));
  await pool.end();
});
