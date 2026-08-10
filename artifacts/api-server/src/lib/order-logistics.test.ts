import assert from "node:assert/strict";
import test from "node:test";
import { addBusinessDays, consumesLogisticsCapacity, getLogisticsQueueSlot, getSaoPauloDate, isStandardShipping, shiftBusinessDays } from "./order-logistics-calendar";

test("adds logistics lead time in business days", () => {
  assert.equal(addBusinessDays("2026-08-10", 2), "2026-08-12");
  assert.equal(addBusinessDays("2026-08-14", 2), "2026-08-18");
  assert.equal(shiftBusinessDays("2026-08-17", -1), "2026-08-14");
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

test("releases capacity after an order is shipped", () => {
  assert.equal(consumesLogisticsCapacity("allocated"), true);
  assert.equal(consumesLogisticsCapacity("shipped"), false);
  assert.equal(consumesLogisticsCapacity("released"), false);
});

test("starts the queue at 48 hours", () => {
  assert.deepEqual(getLogisticsQueueSlot(0), { groupIndex: 0, promisedHours: 48, slotPosition: 1, availableSlots: 20 });
});

test("keeps the fourteenth queued order at 48 hours", () => {
  assert.deepEqual(getLogisticsQueueSlot(13), { groupIndex: 0, promisedHours: 48, slotPosition: 14, availableSlots: 7 });
});

test("opens 72 hours only after filling 48 hours", () => {
  assert.deepEqual(getLogisticsQueueSlot(19), { groupIndex: 0, promisedHours: 48, slotPosition: 20, availableSlots: 1 });
  assert.deepEqual(getLogisticsQueueSlot(20), { groupIndex: 1, promisedHours: 72, slotPosition: 1, availableSlots: 20 });
});

test("compacts later orders when earlier capacity is released", () => {
  assert.equal(getLogisticsQueueSlot(40).promisedHours, 96);
  assert.equal(getLogisticsQueueSlot(39).promisedHours, 72);
});