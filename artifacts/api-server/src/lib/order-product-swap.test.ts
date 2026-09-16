import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductSwap,
  applySwapToShipmentItems,
  assertOrderCanSwapProduct,
  lineCost,
  lineTotal,
  parseOrderProductLines,
  pickPackageForProductSwap,
} from "./order-product-swap";

test("keep_price congela o preco da linha e troca o custo", () => {
  const result = applyProductSwap({
    products: [{ id: "retagen", name: "Retagen", quantity: 1, price: 978, costPrice: 400 }],
    lineIndex: 0,
    replacement: { id: "semax", name: "Semax", unitPrice: 1200, costPrice: 520 },
    mode: "keep_price",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.to.id, "semax");
  assert.equal(result.to.price, 978);
  assert.equal(result.to.costPrice, 520);
  assert.equal(result.to.swapMode, "keep_price");
  assert.equal(result.to.swappedFrom?.name, "Retagen");
  assert.equal(lineTotal(result.to), 978);
  assert.equal(lineCost(result.to), 520);
});

test("pass_difference usa o preco de catalogo do produto novo", () => {
  const result = applyProductSwap({
    products: [{ id: "retagen", name: "Retagen", quantity: 1, price: 978, costPrice: 400 }],
    lineIndex: 0,
    replacement: { id: "semax", name: "Semax", unitPrice: 1200, costPrice: 520 },
    mode: "pass_difference",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.to.price, 1200);
  assert.equal(result.to.swapMode, "pass_difference");
});

test("quantidade parcial parte a linha", () => {
  const result = applyProductSwap({
    products: [{ id: "retagen", name: "Retagen", quantity: 2, price: 978, costPrice: 400 }],
    lineIndex: 0,
    quantity: 1,
    replacement: { id: "semax", name: "Semax", unitPrice: 800, costPrice: 300 },
    mode: "keep_price",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.products.length, 2);
  assert.equal(result.products[0].id, "retagen");
  assert.equal(result.products[0].quantity, 1);
  assert.equal(result.products[1].id, "semax");
  assert.equal(result.products[1].quantity, 1);
  assert.equal(result.products[1].price, 978);
});

test("recusa o mesmo SKU e quantidade acima da linha", () => {
  const same = applyProductSwap({
    products: [{ id: "retagen", name: "Retagen", quantity: 1, price: 10 }],
    lineIndex: 0,
    replacement: { id: "retagen", name: "Retagen", unitPrice: 10, costPrice: 1 },
    mode: "keep_price",
  });
  assert.equal(same.ok, false);
  if (!same.ok) assert.equal(same.code, "SAME_PRODUCT");

  const qty = applyProductSwap({
    products: [{ id: "retagen", name: "Retagen", quantity: 1, price: 10 }],
    lineIndex: 0,
    quantity: 2,
    replacement: { id: "semax", name: "Semax", unitPrice: 10, costPrice: 1 },
    mode: "keep_price",
  });
  assert.equal(qty.ok, false);
  if (!qty.ok) assert.equal(qty.code, "QTY_TOO_HIGH");
});

test("bloqueia pedido enviado, baixado ou filho de reenvio", () => {
  assert.equal(assertOrderCanSwapProduct({ enviado: true }).ok, false);
  assert.equal(assertOrderCanSwapProduct({ inventoryReserved: true }).ok, false);
  assert.equal(assertOrderCanSwapProduct({ inventoryExitedPools: "loja" }).ok, false);
  assert.equal(assertOrderCanSwapProduct({ parentOrderId: "abc" }).ok, false);
  assert.equal(assertOrderCanSwapProduct({ observation: "REENVIO DO PEDIDO #1" }).ok, false);
  assert.equal(assertOrderCanSwapProduct({ status: "cancelled" }).ok, false);
  assert.equal(assertOrderCanSwapProduct({ packages: [{ enviado: true }] }).ok, false);
  assert.equal(assertOrderCanSwapProduct({ status: "paid" }).ok, true);
});

test("pacote do split: troca o SKU ou pede packageId se estiver nos dois", () => {
  const items = applySwapToShipmentItems({
    items: [
      { productId: "retagen", productName: "Retagen", quantity: 1 },
      { productId: "ghk", productName: "GHK", quantity: 1 },
    ],
    fromProductId: "retagen",
    quantity: 1,
    replacement: { id: "semax", name: "Semax" },
  });
  assert.equal(items.ok, true);
  if (!items.ok) return;
  assert.equal(items.items.some((row) => row.productId === "retagen"), false);
  assert.equal(items.items.find((row) => row.productId === "semax")?.quantity, 1);

  const auto = pickPackageForProductSwap([
    { id: "pkg-minas", items: [{ productId: "semax" }] },
    { id: "pkg-moto", items: [{ productId: "retagen" }] },
  ], "retagen");
  assert.equal(auto.ok, true);
  if (auto.ok) assert.equal(auto.packageId, "pkg-moto");

  const need = pickPackageForProductSwap([
    { id: "a", items: [{ productId: "retagen" }] },
    { id: "b", items: [{ productId: "retagen" }] },
  ], "retagen");
  assert.equal(need.ok, false);
  if (!need.ok) assert.equal(need.code, "NEED_PACKAGE_ID");
});

test("parse preserva swappedFrom", () => {
  const lines = parseOrderProductLines([
    { id: "semax", name: "Semax", quantity: 1, price: 978, swappedFrom: { id: "retagen", name: "Retagen", quantity: 1, price: 978 }, swapMode: "keep_price" },
  ]);
  assert.equal(lines[0]?.swappedFrom?.name, "Retagen");
  assert.equal(lines[0]?.swapMode, "keep_price");
});
