import assert from "node:assert/strict";
import test from "node:test";

import {
  parseFreeShippingMinSubtotalSetting,
  pickFreeShippingMinSubtotal,
  resolveShippingCostWithFreeThreshold,
} from "./free-shipping";

test("frete normal quando subtotal abaixo do limite", () => {
  const shipping = resolveShippingCostWithFreeThreshold({
    subtotal: 2499.99,
    shippingBaseCost: 120,
    freeShippingMinSubtotal: 2500,
  });

  assert.equal(shipping, 120);
});

test("frete gratis quando subtotal igual ao limite", () => {
  const shipping = resolveShippingCostWithFreeThreshold({
    subtotal: 2500,
    shippingBaseCost: 120,
    freeShippingMinSubtotal: 2500,
  });

  assert.equal(shipping, 0);
});

test("frete gratis quando subtotal acima do limite", () => {
  const shipping = resolveShippingCostWithFreeThreshold({
    subtotal: 3000,
    shippingBaseCost: 120,
    freeShippingMinSubtotal: 2500,
  });

  assert.equal(shipping, 0);
});

test("parser ignora valor invalido de configuracao", () => {
  assert.equal(parseFreeShippingMinSubtotalSetting(""), null);
  assert.equal(parseFreeShippingMinSubtotalSetting("0"), null);
  assert.equal(parseFreeShippingMinSubtotalSetting("abc"), null);
  assert.equal(parseFreeShippingMinSubtotalSetting("2500"), 2500);
});

test("pick usa limiar motoboy so quando o frete e motoboy", () => {
  assert.equal(pickFreeShippingMinSubtotal({
    shippingType: "Motoboy",
    standardMin: 2500,
    motoboyMin: 400,
  }), 400);
  assert.equal(pickFreeShippingMinSubtotal({
    shippingType: "Frete Normal",
    standardMin: 2500,
    motoboyMin: 400,
  }), 2500);
  assert.equal(pickFreeShippingMinSubtotal({
    shippingType: "Motoboy",
    standardMin: 2500,
    motoboyMin: null,
  }), null);
  assert.equal(pickFreeShippingMinSubtotal({
    shippingType: "Motoboy",
    neighborhoodId: "dist",
    standardMin: 2500,
    motoboyMin: 400,
  }), null);
});
