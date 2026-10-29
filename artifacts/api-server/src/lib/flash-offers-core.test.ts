import assert from "node:assert/strict";
import test from "node:test";

import {
  isCampaignHourOpen,
  normalizeVisitorKey,
  rollDraw,
  saoPauloClock,
  saoPauloDayStart,
  unitPriceWithFlash,
  compareFlashCampaigns,
  mergeFlashOffers,
  visitStillBlocks,
} from "./flash-offers-core";

test("relógio de São Paulo lê hora e dia", () => {
  const clock = saoPauloClock(new Date("2026-10-19T21:30:00Z"));
  assert.equal(clock.hour, 18);
  assert.equal(clock.dayKey, "2026-10-19");
  assert.equal(saoPauloDayStart(new Date("2026-10-19T02:30:00Z")).toISOString(), "2026-10-18T03:00:00.000Z");
});

test("janela da campanha", () => {
  assert.equal(isCampaignHourOpen(null, null, 10), true);
  assert.equal(isCampaignHourOpen(18, null, 17), false);
  assert.equal(isCampaignHourOpen(18, null, 18), true);
  assert.equal(isCampaignHourOpen(18, 22, 22), true);
  assert.equal(isCampaignHourOpen(18, 22, 23), false);
});

test("a ordem escolhida vem antes da data de criação", () => {
  const older = { displayOrder: 1, createdAt: new Date("2026-10-01T00:00:00Z") };
  const newer = { displayOrder: 0, createdAt: new Date("2026-10-20T00:00:00Z") };
  const same = { displayOrder: 0, createdAt: new Date("2026-10-02T00:00:00Z") };
  assert.ok(compareFlashCampaigns(newer, older) < 0);
  assert.ok(compareFlashCampaigns(same, newer) < 0);
  assert.equal(compareFlashCampaigns({ displayOrder: 0, createdAt: same.createdAt }, same), 0);
});

test("produto habilitado entra na frente e não repete", () => {
  const merged = mergeFlashOffers(
    [{ productId: "sempre" }, { productId: "comum" }],
    [{ productId: "comum" }, { productId: "outro" }],
  );
  assert.deepEqual(merged.map((item) => item.productId), ["sempre", "comum", "outro"]);
});

test("sorteio usa a chance configurada", () => {
  assert.equal(rollDraw(25, 0.24), true);
  assert.equal(rollDraw(25, 0.25), false);
  assert.equal(rollDraw(0, 0), false);
  assert.equal(rollDraw(100, 0.99), true);
});

test("visitante e preço da reserva", () => {
  assert.equal(normalizeVisitorKey("abc"), "");
  assert.equal(normalizeVisitorKey("123e4567-e89b-12d3-a456-426614174000"), "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(unitPriceWithFlash({
    catalogUnitPrice: 100,
    flash: { productId: "p1", unitPrice: 70 },
    productId: "p1",
    isBump: false,
  }), 70);
  assert.equal(unitPriceWithFlash({
    catalogUnitPrice: 100,
    flash: { productId: "p1", unitPrice: 70 },
    productId: "p2",
    isBump: false,
  }), 100);
  assert.equal(unitPriceWithFlash({
    catalogUnitPrice: 100,
    flash: [{ productId: "p1", unitPrice: 70 }],
    productId: "p1",
    isBump: false,
  }), 70);
});

test("bloqueio da oferta libera depois das horas da campanha", () => {
  const seenAt = new Date("2026-10-19T21:00:00-03:00");
  const dayStart = new Date("2026-10-19T00:00:00-03:00");
  assert.equal(visitStillBlocks({
    outcome: "seen",
    createdAt: seenAt,
    now: new Date("2026-10-20T20:00:00-03:00"),
    repeatAfterHours: 0,
    dayStart,
  }), true);
  assert.equal(visitStillBlocks({
    outcome: "seen",
    createdAt: seenAt,
    now: new Date("2026-10-20T22:00:00-03:00"),
    repeatAfterHours: 24,
    dayStart,
  }), false);
  assert.equal(visitStillBlocks({
    outcome: "seen",
    createdAt: seenAt,
    now: new Date("2026-10-20T20:00:00-03:00"),
    repeatAfterHours: 48,
    dayStart,
  }), true);
});
