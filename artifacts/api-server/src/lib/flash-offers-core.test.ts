import assert from "node:assert/strict";
import test from "node:test";

import {
  flashLineQuantityError,
  isCampaignHourOpen,
  normalizeVisitorKey,
  rollDraw,
  saoPauloClock,
  saoPauloDayStart,
  unitPriceWithFlash,
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
  assert.equal(flashLineQuantityError({
    flashProductId: "p1",
    lines: [{ id: "p1", quantity: 2 }],
  }), "A promoção relâmpago vale para 1 unidade.");
});
