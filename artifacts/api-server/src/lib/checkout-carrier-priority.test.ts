import assert from "node:assert/strict";
import test from "node:test";

import {
  checkoutDeliveryCacheKey,
  parseCheckoutCarrierPriority,
  pickCheckoutDelivery,
  readCheckoutDeliveryCache,
  resetCheckoutDeliveryEstimateState,
  takeCheckoutQuoteSlot,
  writeCheckoutDeliveryCache,
} from "./checkout-carrier-priority";

test("fila vazia e JSON na ordem, sem nome fora da lista", () => {
  assert.deepEqual(parseCheckoutCarrierPriority(""), { ok: true, carriers: [] });
  assert.deepEqual(parseCheckoutCarrierPriority("[]"), { ok: true, carriers: [] });
  assert.deepEqual(parseCheckoutCarrierPriority('["correios sedex","Jadlog envioEcom","correios sedex"]'), {
    ok: true,
    carriers: ["Correios Sedex", "Jadlog envioEcom"],
  });
  const rejected = parseCheckoutCarrierPriority('["Loggi"]');
  assert.equal(rejected.ok, false);
});

test("escolhe a primeira da fila com prazo de pelo menos 1 dia", () => {
  const quotes = {
    quotes: [
      { carrier: "J&T Express envioEcom", price: "18.90", delivery_time: "5" },
      { carrier: "correios sedex", price: "40", delivery_time: 0 },
      { carrier: "Jadlog envioEcom", price: "22", delivery_time: "3 dias" },
    ],
  };

  assert.deepEqual(
    pickCheckoutDelivery(["Correios Sedex", "J&T Express envioEcom"], quotes),
    { carrier: "J&T Express envioEcom", deliveryTimeDays: 5 },
  );
  assert.equal(pickCheckoutDelivery(["Correios Pac"], quotes), null);
  assert.deepEqual(
    pickCheckoutDelivery(["Jadlog envioEcom", "J&T Express envioEcom"], quotes),
    { carrier: "Jadlog envioEcom", deliveryTimeDays: 3 },
  );
});

test("cache de 10 minutos e 30 cotacoes reais por IP", () => {
  resetCheckoutDeliveryEstimateState();
  const key = checkoutDeliveryCacheKey("01310100", ["Correios Sedex"]);
  const now = 1_000_000;
  writeCheckoutDeliveryCache(key, { carrier: "Correios Sedex", deliveryTimeDays: 4 }, now);
  assert.deepEqual(readCheckoutDeliveryCache(key, now + 9 * 60 * 1000), {
    carrier: "Correios Sedex",
    deliveryTimeDays: 4,
  });
  assert.equal(readCheckoutDeliveryCache(key, now + 10 * 60 * 1000), null);

  for (let i = 0; i < 30; i += 1) {
    assert.equal(takeCheckoutQuoteSlot("203.0.113.8", now).allowed, true);
  }
  const blocked = takeCheckoutQuoteSlot("203.0.113.8", now);
  assert.equal(blocked.allowed, false);
  assert.equal(takeCheckoutQuoteSlot("203.0.113.9", now).allowed, true);
  assert.equal(takeCheckoutQuoteSlot("203.0.113.8", now + 10 * 60 * 1000).allowed, true);
  resetCheckoutDeliveryEstimateState();
});
