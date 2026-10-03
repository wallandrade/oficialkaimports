import assert from "node:assert/strict";
import test from "node:test";

import { affiliateAvailableCredit, affiliateBalanceDelta } from "./affiliate-credit";

test("disponível é liberado menos usado mais ajuste, nunca abaixo de zero", () => {
  assert.equal(affiliateAvailableCredit(100, 40, 0), 60);
  assert.equal(affiliateAvailableCredit(100, 40, 15), 75);
  assert.equal(affiliateAvailableCredit(100, 40, -70), 0);
});

test("adicionar soma, editar define o saldo e zerar tira o disponível", () => {
  assert.deepEqual(affiliateBalanceDelta({ mode: "add", available: 20, amount: 5.5 }), { delta: 5.5 });
  assert.deepEqual(affiliateBalanceDelta({ mode: "set", available: 20, amount: 8 }), { delta: -12 });
  assert.deepEqual(affiliateBalanceDelta({ mode: "set", available: 20, amount: 35 }), { delta: 15 });
  assert.deepEqual(affiliateBalanceDelta({ mode: "zero", available: 20 }), { delta: -20 });
});

test("valor inválido ou saldo já igual não gera ajuste", () => {
  assert.deepEqual(affiliateBalanceDelta({ mode: "add", available: 20, amount: 0 }), { error: "INVALID_AMOUNT" });
  assert.deepEqual(affiliateBalanceDelta({ mode: "add", available: 20, amount: -3 }), { error: "INVALID_AMOUNT" });
  assert.deepEqual(affiliateBalanceDelta({ mode: "set", available: 20, amount: -1 }), { error: "INVALID_AMOUNT" });
  assert.deepEqual(affiliateBalanceDelta({ mode: "set", available: 20, amount: 20 }), { error: "NO_CHANGE" });
  assert.deepEqual(affiliateBalanceDelta({ mode: "zero", available: 0 }), { error: "NO_CHANGE" });
});
