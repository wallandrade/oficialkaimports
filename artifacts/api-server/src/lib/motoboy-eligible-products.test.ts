import assert from "node:assert/strict";
import test from "node:test";

import {
  cartProductIdsFromItems,
  isCartEligibleForMotoboy,
  parseMotoboyEligibleProductIds,
} from "./motoboy-eligible-products";

test("lista vazia libera qualquer carrinho", () => {
  assert.equal(isCartEligibleForMotoboy(["a", "b"], []), true);
  assert.equal(isCartEligibleForMotoboy(["a"], "[]"), true);
  assert.equal(isCartEligibleForMotoboy(["a"], ""), true);
});

test("todos os ids do carrinho precisam estar na lista", () => {
  assert.equal(isCartEligibleForMotoboy(["p1", "p2"], ["p1", "p2", "p3"]), true);
  assert.equal(isCartEligibleForMotoboy(["p1", "p9"], ["p1", "p2"]), false);
});

test("carrinho vazio com lista preenchida nao e elegivel", () => {
  assert.equal(isCartEligibleForMotoboy([], ["p1"]), false);
});

test("parse JSON e bumpProductId no carrinho", () => {
  assert.deepEqual(parseMotoboyEligibleProductIds('["a","b","a"]'), ["a", "b"]);
  assert.deepEqual(cartProductIdsFromItems([
    { id: "cart-line", bumpProductId: "real-sku" },
    { id: "plain" },
    null,
  ]), ["real-sku", "plain"]);
});
