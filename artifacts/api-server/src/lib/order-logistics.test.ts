import assert from "node:assert/strict";
import test from "node:test";
import { addBusinessDays, consumesLogisticsCapacity, getSaoPauloDate, isStandardShipping } from "./order-logistics-calendar";

test("adds logistics lead time in business days", () => {
  assert.equal(addBusinessDays("2026-08-10", 2), "2026-08-12");
  assert.equal(addBusinessDays("2026-08-14", 2), "2026-08-18");
});

test("reads the current calendar date in Sao Paulo", () => {
  assert.equal(getSaoPauloDate(new Date("2026-08-10T02:00:00.000Z")), "2026-08-09");
});

test("keeps motoboy and pickup orders outside standard logistics", () => {
  assert.equal(isStandardShipping("Padrão"), true);
  assert.equal(isStandardShipping("Motoboy"), false);
  assert.equal(isStandardShipping("Retirada"), false);
  assert.equal(isStandardShipping("Retirada na loja"), false);
});

test("keeps shipped orders consuming their original daily capacity", () => {
  assert.equal(consumesLogisticsCapacity("allocated"), true);
  assert.equal(consumesLogisticsCapacity("shipped"), true);
  assert.equal(consumesLogisticsCapacity("released"), false);
});