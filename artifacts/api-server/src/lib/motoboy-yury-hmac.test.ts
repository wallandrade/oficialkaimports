import assert from "node:assert/strict";
import test from "node:test";

import { buildYuryMotoboySignatureHeader, isYuryMotoboyTimestampFresh, verifyYuryMotoboySignature } from "./motoboy-yury-hmac";
import { parseYuryCoverageEvent, parseYuryCoveragePayload } from "./motoboy-yury-coverage";

test("hmac aceita body cru e rejeita assinatura errada", () => {
  const raw = Buffer.from('{"eventId":"evt_1"}');
  const secret = "shared-secret";
  const header = buildYuryMotoboySignatureHeader(secret, raw);
  assert.equal(verifyYuryMotoboySignature(secret, raw, header), true);
  assert.equal(verifyYuryMotoboySignature(secret, raw, "sha256=deadbeef"), false);
  assert.equal(verifyYuryMotoboySignature("other", raw, header), false);
});

test("timestamp rejeita replay maior que 5 minutos", () => {
  const now = 1_724_688_000_000;
  assert.equal(isYuryMotoboyTimestampFresh(1_724_688_000, now), true);
  assert.equal(isYuryMotoboyTimestampFresh(1_724_687_700, now), true);
  assert.equal(isYuryMotoboyTimestampFresh(1_724_687_699, now), false);
  assert.equal(isYuryMotoboyTimestampFresh(now, now), true);
  assert.equal(isYuryMotoboyTimestampFresh("abc", now), false);
});

test("parse coverage ignora bairro sem id e faixa invertida", () => {
  const payload = parseYuryCoveragePayload({
    syncedAt: "2026-08-26T16:00:00.000Z",
    neighborhoods: [
      { id: "a1", neighborhoodName: "Centro", city: "Santo André", price: 70, intervalHours: 1, isActive: true, sortOrder: 1 },
      { neighborhoodName: "sem id", price: 10 },
    ],
    cepRanges: [
      { id: "cr1", label: "SP 039", city: "São Paulo", cepStart: 3900000, cepEnd: 3999999, price: 80, intervalHours: 2, isActive: true, sortOrder: 10 },
      { id: "bad", label: "invertida", cepStart: 20, cepEnd: 10, price: 1 },
    ],
  });
  assert.ok(payload);
  assert.equal(payload.neighborhoods.length, 1);
  assert.equal(payload.neighborhoods[0].neighborhoodName, "Centro");
  assert.equal(payload.cepRanges.length, 1);
  assert.equal(payload.cepRanges[0].cepStart, 3900000);
});

test("parse event aceita upsert e ignora tipo desconhecido", () => {
  const event = parseYuryCoverageEvent({
    eventId: "evt_01",
    eventType: "motoboy.neighborhood.upserted",
    data: { id: "a1", neighborhoodName: "Centro", price: 70 },
  });
  assert.ok(event);
  assert.equal(event.eventType, "motoboy.neighborhood.upserted");
  assert.equal(parseYuryCoverageEvent({ eventId: "x", eventType: "motoboy.unknown" }), null);
});
