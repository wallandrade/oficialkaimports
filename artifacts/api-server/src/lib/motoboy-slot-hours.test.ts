import assert from "node:assert/strict";
import test from "node:test";

import {
  findPeriodByStartTime,
  listAvailableSlotOptions,
  nextDraftPeriod,
  occupiedIntervalsFromReservations,
  resolveMotoboySlotPeriods,
  serializeMotoboySlotHours,
  validateMotoboySlotHours,
} from "./motoboy-slot-hours";

const periods = [
  { startHour: 8, endHour: 11 },
  { startHour: 13, endHour: 17 },
  { startHour: 19, endHour: 24 },
];

test("sem valor salvo usa 10:00 às 20:00", () => {
  assert.deepEqual(resolveMotoboySlotPeriods(null), [{ startHour: 10, endHour: 20 }]);
  assert.deepEqual(resolveMotoboySlotPeriods("  "), [{ startHour: 10, endHour: 20 }]);
});

test("aceita períodos que só se encostam e ordena pelo início", () => {
  const parsed = validateMotoboySlotHours({
    periods: [
      { startHour: 11, endHour: 14 },
      { startHour: 8, endHour: 11 },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.periods, [
    { startHour: 8, endHour: 11 },
    { startHour: 11, endHour: 14 },
  ]);
});

test("recusa períodos que se cruzam", () => {
  const parsed = validateMotoboySlotHours({
    periods: [
      { startHour: 8, endHour: 12 },
      { startHour: 11, endHour: 14 },
    ],
  });
  assert.equal(parsed.ok, false);
});

test("recusa início ou fim fora da hora inteira", () => {
  assert.equal(validateMotoboySlotHours({ periods: [{ startHour: 24, endHour: 24 }] }).ok, false);
  assert.equal(validateMotoboySlotHours({ periods: [{ startHour: 8, endHour: 8 }] }).ok, false);
  assert.equal(validateMotoboySlotHours({ periods: [{ startHour: 8.5, endHour: 11 }] }).ok, false);
  assert.equal(validateMotoboySlotHours({ periods: [] }).ok, false);
  assert.equal(validateMotoboySlotHours({ periods: [{ startHour: 19, endHour: 24 }] }).ok, true);
});

test("JSON inválido na leitura cai no período padrão", () => {
  assert.deepEqual(resolveMotoboySlotPeriods("{"), [{ startHour: 10, endHour: 20 }]);
});

test("salvar devolve o JSON ordenado", () => {
  assert.equal(
    serializeMotoboySlotHours([{ startHour: 13, endHour: 17 }, { startHour: 8, endHour: 11 }]),
    JSON.stringify({
      periods: [
        { startHour: 8, endHour: 11 },
        { startHour: 13, endHour: 17 },
      ],
    }),
  );
});

test("08–11 às 10h ainda aparece e às 11h some", () => {
  const atTen = listAvailableSlotOptions({
    periods,
    date: "2026-09-28",
    now: { date: "2026-09-28", hour: 10 },
    occupied: [],
    isSunday: false,
  });
  assert.deepEqual(atTen.map((slot) => slot.start), ["08:00", "13:00", "19:00"]);

  const atEleven = listAvailableSlotOptions({
    periods,
    date: "2026-09-28",
    now: { date: "2026-09-28", hour: 11 },
    occupied: [],
    isSunday: false,
  });
  assert.deepEqual(atEleven.map((slot) => slot.start), ["13:00", "19:00"]);
  assert.equal(atEleven[0]?.label, "Entrega das 13:00 às 17:00");
});

test("domingo e dia além de 14 dias não devolvem período", () => {
  assert.deepEqual(listAvailableSlotOptions({
    periods,
    date: "2026-09-27",
    now: { date: "2026-09-26", hour: 9 },
    occupied: [],
    isSunday: true,
  }), []);

  assert.deepEqual(listAvailableSlotOptions({
    periods,
    date: "2026-10-11",
    now: { date: "2026-09-26", hour: 9 },
    occupied: [],
    isSunday: false,
  }), []);
});

test("um pedido no período não bloqueia a faixa seguinte", () => {
  const slots = listAvailableSlotOptions({
    periods,
    date: "2026-09-28",
    now: { date: "2026-09-26", hour: 9 },
    occupied: [{ start: 8, end: 11 }],
    isSunday: false,
  });
  assert.deepEqual(slots.map((slot) => slot.start), ["13:00", "19:00"]);
});

test("reserva antiga em várias horas conta uma vez, pelo início e pela duração", () => {
  const occupied = occupiedIntervalsFromReservations([
    { orderId: "order-1", slotHour: 10, startTime: "10:00", durationHours: 2 },
    { orderId: "order-1", slotHour: 11, startTime: "10:00", durationHours: 2 },
  ]);
  assert.deepEqual(occupied, [{ start: 10, end: 12 }]);

  const slots = listAvailableSlotOptions({
    periods: [{ startHour: 8, endHour: 12 }, { startHour: 13, endHour: 17 }],
    date: "2026-09-28",
    now: { date: "2026-09-26", hour: 9 },
    occupied,
    isSunday: false,
  });
  assert.deepEqual(slots.map((slot) => slot.start), ["13:00"]);
});

test("a reserva procura o período pelo início, não pelo texto do botão", () => {
  assert.deepEqual(findPeriodByStartTime(periods, "08:00"), { startHour: 8, endHour: 11 });
  assert.equal(findPeriodByStartTime(periods, "09:00"), null);
  assert.equal(findPeriodByStartTime(periods, "08:30"), null);
});

test("o próximo período começa no fim do anterior e dura 3 horas, no máximo até 24", () => {
  assert.deepEqual(nextDraftPeriod([{ startHour: 8, endHour: 11 }]), { startHour: 11, endHour: 14 });
  assert.deepEqual(nextDraftPeriod([{ startHour: 19, endHour: 22 }]), { startHour: 22, endHour: 24 });
  assert.equal(nextDraftPeriod([{ startHour: 19, endHour: 24 }]), null);
});
