import assert from "node:assert/strict";
import test from "node:test";

import { depositLinkRequiresNote, moneyToCents } from "./order-bank-deposits-math";

test("pede motivo no primeiro PIX parcial", () => {
  const result = depositLinkRequiresNote({
    orderTotal: 1380,
    existingSum: 0,
    creditAmount: 930,
    matchStatus: "ok",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.requiresNote, true);
  assert.equal(result.nextSumCents, 93000);
});

test("nao pede motivo quando o segundo PIX completa o total", () => {
  const result = depositLinkRequiresNote({
    orderTotal: 1380,
    existingSum: 930,
    creditAmount: 450,
    matchStatus: "ok",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.requiresNote, false);
  assert.equal(result.nextSumCents, moneyToCents(1380));
});

test("recusa confirmed_100 com valor diferente", () => {
  const result = depositLinkRequiresNote({
    orderTotal: 1380,
    existingSum: 0,
    creditAmount: 450,
    matchStatus: "confirmed_100",
  });
  assert.equal(result.blocked, true);
  assert.equal(result.requiresNote, false);
});
