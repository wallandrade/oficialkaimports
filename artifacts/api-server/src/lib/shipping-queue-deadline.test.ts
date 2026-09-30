import assert from "node:assert/strict";
import test from "node:test";
import {
  isManualShippingDeadlineEnabled,
  normalizeShippingQueueManualHours,
  resolveCheckoutDeadlineHours,
} from "./shipping-queue-deadline";

test("keeps the queue hours when the manual deadline is off", () => {
  assert.equal(resolveCheckoutDeadlineHours(72, "0", "48"), 72);
  assert.equal(resolveCheckoutDeadlineHours(72, "", "48"), 72);
  assert.equal(resolveCheckoutDeadlineHours(72, "enabled", "48"), 72);
  assert.equal(isManualShippingDeadlineEnabled("yes"), true);
  assert.equal(isManualShippingDeadlineEnabled("ON"), true);
});

test("replaces only the checkout hours when the manual deadline is valid", () => {
  assert.equal(resolveCheckoutDeadlineHours(72, "1", "48"), 48);
  assert.equal(resolveCheckoutDeadlineHours(48, "true", "48,4"), 48);
  assert.equal(resolveCheckoutDeadlineHours(48, "on", "1000"), 999);
});

test("falls back to the queue when the manual hours are unusable", () => {
  assert.equal(resolveCheckoutDeadlineHours(72, "1", ""), 72);
  assert.equal(resolveCheckoutDeadlineHours(72, "1", "0"), 72);
  assert.equal(resolveCheckoutDeadlineHours(72, "1", "texto"), 72);
  assert.equal(resolveCheckoutDeadlineHours(72, "yes", "0,4"), 72);
});

test("rejects invalid hours on save and caps the stored value at 999", () => {
  assert.deepEqual(normalizeShippingQueueManualHours("48,6"), { ok: true, value: "49" });
  assert.deepEqual(normalizeShippingQueueManualHours("1000"), { ok: true, value: "999" });
  assert.equal(normalizeShippingQueueManualHours("0").ok, false);
  assert.equal(normalizeShippingQueueManualHours("abc").ok, false);
  assert.equal(normalizeShippingQueueManualHours("").ok, false);
});
