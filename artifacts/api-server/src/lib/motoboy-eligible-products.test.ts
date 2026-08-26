import assert from "node:assert/strict";
import test from "node:test";

import {
  isCartEligibleForMotoboy,
  parseMotoboyEligibleProductIds,
  serializeMotoboyEligibleProductIds,
} from "./motoboy-eligible-products";

test("lista vazia libera qualquer carrinho", () => {
  assert.equal(isCartEligibleForMotoboy(["a", "b"], []), true);
  assert.equal(isCartEligibleForMotoboy([], []), true);
});

test("whitelist exige que todos os itens estejam na lista", () => {
  assert.equal(isCartEligibleForMotoboy(["a"], ["a", "b"]), true);
  assert.equal(isCartEligibleForMotoboy(["a", "b"], ["a", "b"]), true);
  assert.equal(isCartEligibleForMotoboy(["a", "c"], ["a", "b"]), false);
  assert.equal(isCartEligibleForMotoboy(["c"], ["a", "b"]), false);
});

test("parser aceita JSON e CSV", () => {
  assert.deepEqual(parseMotoboyEligibleProductIds('["x","y"]'), ["x", "y"]);
  assert.deepEqual(parseMotoboyEligibleProductIds("x, y"), ["x", "y"]);
  assert.deepEqual(parseMotoboyEligibleProductIds(""), []);
  assert.deepEqual(parseMotoboyEligibleProductIds(["a", "a", ""]), ["a"]);
});

test("serialize produz JSON estável", () => {
  assert.equal(serializeMotoboyEligibleProductIds(["b", "a", "b"]), '["b","a"]');
});
