import assert from "node:assert/strict";
import test from "node:test";
import { COST_PATCH_WINDOW_MS, planOrderCostPatch } from "./patch-orders-costprice-core";

const now = new Date("2026-11-08T15:00:00.000Z");

function plan(overrides: Partial<Parameters<typeof planOrderCostPatch>[0]>) {
  return planOrderCostPatch({
    status: "paid",
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    products: [{ id: "sku-a", name: "Item", quantity: "2", price: "50.00", lineDiscount: 5, flashOffer: true }],
    catalogCosts: new Map([["sku-a", "12.50"]]),
    now,
    ...overrides,
  });
}

test("pedido dentro de 72h ganha só o custo e preserva o resto", () => {
  const result = plan({});
  assert.equal(result.update, true);
  if (!result.update) return;
  assert.deepEqual(result.products, [{
    id: "sku-a",
    name: "Item",
    quantity: "2",
    price: "50.00",
    lineDiscount: 5,
    flashOffer: true,
    costPrice: 12.5,
  }]);
});

test("exatamente 72h entra e 1 ms antes fica fora", () => {
  const edge = plan({ createdAt: new Date(now.getTime() - COST_PATCH_WINDOW_MS) });
  assert.equal(edge.update, true);
  const older = plan({ createdAt: new Date(now.getTime() - COST_PATCH_WINDOW_MS - 1) });
  assert.equal(older.update, false);
  if (!older.update) assert.equal(older.reason, "outside_window");
});

test("criação no futuro ou inválida não atualiza", () => {
  const future = plan({ createdAt: new Date(now.getTime() + 1) });
  assert.equal(future.update, false);
  if (!future.update) assert.equal(future.reason, "future_created_at");
  const invalid = plan({ createdAt: "nao-e-data" });
  assert.equal(invalid.update, false);
  if (!invalid.update) assert.equal(invalid.reason, "invalid_created_at");
});

test("só paid e completed", () => {
  for (const status of ["pending", "awaiting_payment", "cancelled", ""]) {
    const result = plan({ status });
    assert.equal(result.update, false);
    if (!result.update) assert.equal(result.reason, "status");
  }
  assert.equal(plan({ status: "completed" }).update, true);
});

test("vários itens: só o que tem custo válido muda", () => {
  const result = plan({
    products: [
      { id: "sku-a", name: "A", quantity: 1, price: 10, selectedVariants: [{ groupName: "Cor", option: "Azul" }] },
      { id: "sku-b", name: "B", quantity: 1, price: 8, costPrice: 3 },
      { id: "sku-c", name: "C", quantity: 1, price: 4, costPrice: 1 },
    ],
    catalogCosts: new Map<string, unknown>([
      ["sku-a", 2],
      ["sku-c", 0],
      ["sku-d", "abc"],
    ]),
  });
  assert.equal(result.update, true);
  if (!result.update) return;
  assert.equal(result.products[0].costPrice, 2);
  assert.deepEqual(result.products[0].selectedVariants, [{ groupName: "Cor", option: "Azul" }]);
  assert.equal(result.products[1].costPrice, 3);
  assert.equal(result.products[2].costPrice, 1);
});

test("catálogo ausente, custo inválido e JSON ilegível não apagam nem zeram", () => {
  const missing = plan({ catalogCosts: new Map() });
  assert.equal(missing.update, false);
  if (!missing.update) assert.equal(missing.reason, "no_change");

  const invalidCost = plan({ catalogCosts: new Map([["sku-a", "-1"]]) });
  assert.equal(invalidCost.update, false);

  const broken = plan({ products: "{nao-json" });
  assert.equal(broken.update, false);
  if (!broken.update) assert.equal(broken.reason, "invalid_products_json");
});

test("custo igual não pede UPDATE e a segunda passagem fica parada", () => {
  const first = plan({});
  assert.equal(first.update, true);
  if (!first.update) return;
  const second = plan({ products: first.products });
  assert.equal(second.update, false);
  if (!second.update) assert.equal(second.reason, "no_change");
});
