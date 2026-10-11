import assert from "node:assert/strict";
import test from "node:test";
import { rafflePaymentBlockReason } from "./raffle-pix-confirm-core";

const now = new Date("2026-10-11T12:00:00.000Z");
const future = new Date("2026-10-11T18:00:00.000Z");
const past = new Date("2026-10-11T11:00:00.000Z");

test("reserva ativa sem conflito pode ser paga", () => {
  assert.equal(rafflePaymentBlockReason({
    reservationId: "a",
    reservationStatus: "reserved",
    reservationExpiresAt: future,
    reservationNumbers: [24],
    now,
    competing: [],
  }), null);
});

test("reserva expirada não vira paga", () => {
  assert.equal(rafflePaymentBlockReason({
    reservationId: "a",
    reservationStatus: "reserved",
    reservationExpiresAt: past,
    reservationNumbers: [24],
    now,
    competing: [],
  }), "RESERVATION_EXPIRED");
});

test("número já pago em outra reserva bloqueia", () => {
  assert.equal(rafflePaymentBlockReason({
    reservationId: "a",
    reservationStatus: "reserved",
    reservationExpiresAt: future,
    reservationNumbers: [24, 25],
    now,
    competing: [{ id: "b", numbers: [25], status: "paid", expiresAt: future }],
  }), "NUMBER_ALREADY_ASSIGNED");
});

test("reserva concorrente já expirada não bloqueia", () => {
  assert.equal(rafflePaymentBlockReason({
    reservationId: "a",
    reservationStatus: "reserved",
    reservationExpiresAt: future,
    reservationNumbers: [24],
    now,
    competing: [{ id: "b", numbers: [24], status: "reserved", expiresAt: past }],
  }), null);
});
