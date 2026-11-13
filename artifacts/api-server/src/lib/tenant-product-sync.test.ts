import assert from "node:assert/strict";
import test from "node:test";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "mysql://unit:test@127.0.0.1:3306/unused";
}

const { buildReplicatedProductWrite } = await import("./tenant-product-sync");

const source = {
  id: "prod-1",
  tenantId: "tenant_loja1",
  name: "Caneta",
  description: null,
  category: "Geral",
  unit: "unidade",
  price: "100.00",
  costPrice: "40.00",
  promoPrice: "80.00",
  promoEndsAt: null,
  bulkDiscountEnabled: false,
  bulkDiscountTiers: null,
  variantGroups: null,
  image: null,
  brand: "KA",
  isActive: true,
  isSoldOut: false,
  isLaunch: false,
  sortOrder: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

test("cópia para filial nasce com custo 0 e o sync seguinte não regrava o custo", () => {
  const write = buildReplicatedProductWrite(source, {
    tenantId: "tenant_filial",
    enabled: true,
    marginPercent: 10,
    marginFixedBrl: 1,
  });

  assert.equal(write.values.tenantId, "tenant_filial");
  assert.equal(write.values.id, "loja1sync_tenant_filial_prod-1");
  assert.equal(write.values.price, "111.00");
  assert.equal(write.values.promoPrice, "89.00");
  assert.equal(write.values.costPrice, "0.00");
  assert.equal(Object.prototype.hasOwnProperty.call(write.set, "costPrice"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(write.set, "price"), false);
  assert.equal(write.set.name, "Caneta");
});

test("custo vazio da loja 1 também não vira preço de venda na filial", () => {
  const write = buildReplicatedProductWrite(
    { ...source, costPrice: null as unknown as string },
    { tenantId: "tenant_filial", enabled: true, marginPercent: 0, marginFixedBrl: 0 },
  );
  assert.equal(write.values.costPrice, "0.00");
  assert.equal(write.values.price, "100.00");
});
