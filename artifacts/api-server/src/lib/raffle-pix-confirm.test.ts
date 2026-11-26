import assert from "node:assert/strict";
import test from "node:test";
import { canUndoManualRafflePayment, decideManualRafflePayment, rafflePaymentBlockReason } from "./raffle-pix-confirm-core";

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

test("só pagamento manual pago pode ser desfeito", () => {
  assert.equal(canUndoManualRafflePayment({ status: "paid", paidSource: "manual" }), true);
  assert.equal(canUndoManualRafflePayment({ status: "paid", paidSource: "pix" }), false);
  assert.equal(canUndoManualRafflePayment({ status: "paid", paidSource: null }), false);
  assert.equal(canUndoManualRafflePayment({ status: "reserved", paidSource: "manual" }), false);
  assert.equal(canUndoManualRafflePayment({ status: "expired", paidSource: "manual" }), false);
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

function forceDecision(overrides: Partial<Parameters<typeof decideManualRafflePayment>[0]> = {}) {
  return decideManualRafflePayment({
    force: true,
    reservationId: "a",
    reservationStatus: "expired",
    reservationExpiresAt: past,
    reservationNumbers: [24, 25],
    now,
    competing: [],
    raffleDrawn: false,
    ...overrides,
  });
}

test("forçar pagamento de expirada sem conflito é permitido", () => {
  assert.deepEqual(forceDecision(), { ok: true });
});

test("forçar pagamento de expirada com número pago ou reservado devolve os números", () => {
  const paid = forceDecision({
    competing: [{ id: "b", numbers: [25], status: "paid", expiresAt: past }],
  });
  assert.equal(paid.ok, false);
  if (!paid.ok) {
    assert.equal(paid.error, "NUMBER_ALREADY_ASSIGNED");
    assert.equal(paid.httpStatus, 409);
    assert.deepEqual(paid.conflictNumbers, [25]);
    assert.match(paid.message, /25/);
  }

  const active = forceDecision({
    reservationNumbers: [7, 8],
    competing: [{ id: "c", numbers: [8, 9], status: "reserved", expiresAt: future }],
  });
  assert.equal(active.ok, false);
  if (!active.ok) {
    assert.equal(active.error, "NUMBER_ALREADY_ASSIGNED");
    assert.deepEqual(active.conflictNumbers, [8]);
    assert.match(active.message, /8/);
  }
});

test("forçar pagamento bloqueia a reserva inteira e lista todos os números em conflito", () => {
  const decision = forceDecision({
    reservationNumbers: [7, 12, 30],
    competing: [
      { id: "paid", numbers: [30], status: "paid", expiresAt: past },
      { id: "hold", numbers: [12, 99], status: "reserved", expiresAt: future },
    ],
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.deepEqual(decision.conflictNumbers, [12, 30]);
    assert.equal(decision.message, "Os números 12 e 30 já estão em outra reserva ativa ou paga.");
  }
});

test("outra reserva expirada com o mesmo número não bloqueia o force", () => {
  assert.deepEqual(forceDecision({
    competing: [
      { id: "b", numbers: [24], status: "expired", expiresAt: past },
      { id: "c", numbers: [25], status: "reserved", expiresAt: past },
    ],
  }), { ok: true });
});

test("reservado com expiresAt no passado entra no force como expirado", () => {
  assert.deepEqual(forceDecision({
    reservationStatus: "reserved",
    reservationExpiresAt: past,
    competing: [{ id: "b", numbers: [24], status: "reserved", expiresAt: past }],
  }), { ok: true });
});

test("sem force a reserva expirada continua recusada", () => {
  const byStatus = forceDecision({ force: false, reservationStatus: "expired" });
  const byTime = forceDecision({
    force: false,
    reservationStatus: "reserved",
    reservationExpiresAt: past,
  });
  for (const decision of [byStatus, byTime]) {
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.error, "RESERVATION_EXPIRED");
      assert.equal(decision.httpStatus, 400);
      assert.equal(decision.message, "A reserva expirou. Não é possível aprovar o pagamento.");
      assert.equal(decision.conflictNumbers, undefined);
    }
  }
});

test("sem force o conflito de número mantém a mensagem genérica", () => {
  const decision = forceDecision({
    force: false,
    reservationStatus: "reserved",
    reservationExpiresAt: future,
    competing: [{ id: "b", numbers: [24], status: "paid", expiresAt: future }],
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.error, "NUMBER_ALREADY_ASSIGNED");
    assert.equal(decision.message, "Algum número desta reserva já está em outra reserva ativa ou paga.");
    assert.equal(decision.conflictNumbers, undefined);
  }
});

test("rifa já sorteada recusa o force", () => {
  const decision = forceDecision({ raffleDrawn: true });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.error, "RAFFLE_ALREADY_DRAWN");
    assert.equal(decision.httpStatus, 409);
    assert.equal(decision.message, "A rifa já foi sorteada. Não é possível forçar o pagamento.");
  }
});

test("sem force a rifa sorteada não muda a aprovação da reserva ativa", () => {
  assert.deepEqual(forceDecision({
    force: false,
    raffleDrawn: true,
    reservationStatus: "reserved",
    reservationExpiresAt: future,
    reservationNumbers: [24],
  }), { ok: true });
});
