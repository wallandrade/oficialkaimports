import assert from "node:assert/strict";
import test from "node:test";

import { settleOrderEdit } from "./order-edit-settlement";

test("edição abate o saldo só na diferença já paga", () => {
  const plan = settleOrderEdit({
    commercialTotal: 6519,
    existingStoreCredit: 0,
    existingAffiliateCredit: 0,
    paidAmount: 4071,
    previousTotal: 4071,
    status: "paid",
    hasProof: true,
    storeCreditToApply: 1000,
  });
  assert.equal(plan.amountDueBeforeCredit, 2448);
  assert.equal(plan.storeCreditApplied, 1000);
  assert.equal(plan.payableTotal, 5519);
  assert.equal(plan.stillDue, 1448);
  assert.equal(plan.nextStatus, "awaiting_payment");
});

test("saldo que cobre a diferença deixa o pedido pago", () => {
  const plan = settleOrderEdit({
    commercialTotal: 6519,
    existingStoreCredit: 0,
    existingAffiliateCredit: 0,
    paidAmount: 4071,
    previousTotal: 4071,
    status: "paid",
    hasProof: false,
    storeCreditToApply: 3000,
  });
  assert.equal(plan.storeCreditApplied, 2448);
  assert.equal(plan.payableTotal, 4071);
  assert.equal(plan.stillDue, 0);
  assert.equal(plan.nextStatus, "paid");
});

test("pedido ainda não pago abate o saldo do total inteiro", () => {
  const plan = settleOrderEdit({
    commercialTotal: 200,
    existingStoreCredit: 0,
    existingAffiliateCredit: 0,
    paidAmount: null,
    previousTotal: 200,
    status: "pending",
    hasProof: false,
    storeCreditToApply: 50,
  });
  assert.equal(plan.amountDueBeforeCredit, 200);
  assert.equal(plan.storeCreditApplied, 50);
  assert.equal(plan.payableTotal, 150);
  assert.equal(plan.stillDue, 150);
  assert.equal(plan.nextStatus, "pending");
});

test("crédito já usado no checkout não volta a ser cobrado na edição", () => {
  const plan = settleOrderEdit({
    commercialTotal: 120,
    existingStoreCredit: 30,
    existingAffiliateCredit: 0,
    paidAmount: 70,
    previousTotal: 70,
    status: "paid",
    hasProof: false,
    storeCreditToApply: 0,
  });
  assert.equal(plan.payableTotal, 90);
  assert.equal(plan.stillDue, 20);
  assert.equal(plan.nextStatus, "awaiting_payment");
});
