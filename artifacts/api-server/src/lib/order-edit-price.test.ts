import assert from "node:assert/strict";
import test from "node:test";

import { flashUnitPriceFromOrder } from "./order-edit-price";

test("edição de pedido mantém o preço da promoção relâmpago", () => {
  const lines = [
    { id: "tirze", price: 189.9, flashOffer: true },
    { id: "agua", price: 12 },
  ];
  assert.equal(flashUnitPriceFromOrder(lines, "tirze"), 189.9);
  assert.equal(flashUnitPriceFromOrder(lines, "agua"), null);
  assert.equal(flashUnitPriceFromOrder(lines, "outro"), null);
});
