import assert from "node:assert/strict";
import test from "node:test";

import { envioEcomResponseStatus } from "./envioecom-client";
import {
  ENVIOECOM_DECLARED_CAP,
  capEnvioEcomDeclaredValue,
  carrierDeclaredLimitFromQuote,
  fitDeclaredShipmentItems,
} from "./envioecom-declared-cap";

test("valor declarado abaixo de 1000 nao muda", () => {
  const capped = capEnvioEcomDeclaredValue(89.9);
  assert.equal(capped.capped, false);
  assert.equal(capped.value, 89.9);
  assert.equal(capped.limit, ENVIOECOM_DECLARED_CAP);
});

test("cotacao e create cortam o valor segurado em 1000", () => {
  const quote = capEnvioEcomDeclaredValue(1800);
  assert.equal(quote.capped, true);
  assert.equal(quote.value, 1000);
  assert.equal(quote.from, 1800);
  assert.equal(quote.limit, 1000);

  const created = fitDeclaredShipmentItems(
    [{ name: "Peça", quantity: 1, unit_cost: 1800 }],
    1800,
  );
  assert.equal(created.capped, true);
  assert.equal(created.declaredCost, 1000);
  assert.equal(created.items[0].unit_cost, 1000);
  assert.equal(created.items[0].quantity * created.items[0].unit_cost, created.declaredCost);
});

test("quantidade maior reparte o teto e a DC-e nao passa de 1000", () => {
  const created = fitDeclaredShipmentItems(
    [{ name: "Peça", quantity: 2, unit_cost: 918.39 }],
    1836.78,
  );
  assert.equal(created.declaredCost, 1000);
  assert.equal(created.items[0].unit_cost, 500);
  assert.equal(created.items[0].quantity * created.items[0].unit_cost, created.declaredCost);

  const odd = fitDeclaredShipmentItems(
    [{ name: "Peça", quantity: 3, unit_cost: 500 }],
    1500,
  );
  assert.equal(odd.capped, true);
  assert.equal(odd.declaredCost <= 1000, true);
  assert.equal(odd.items[0].quantity * odd.items[0].unit_cost, odd.declaredCost);
});

test("teto da transportadora na cotacao substitui o padrao", () => {
  assert.equal(carrierDeclaredLimitFromQuote({ carrier: "J&T Express envioEcom", price: 19.85 }), null);
  assert.equal(carrierDeclaredLimitFromQuote({ max_declared_value: 750 }), 750);
  assert.equal(carrierDeclaredLimitFromQuote({ limits: { declared_value_limit: "500,00" } }), 500);
  assert.equal(carrierDeclaredLimitFromQuote({ max_declared_value: 9000 }), null);

  const tighter = fitDeclaredShipmentItems(
    [{ name: "Peça", quantity: 1, unit_cost: 800 }],
    800,
    500,
  );
  assert.equal(tighter.declaredCost, 500);
  assert.equal(tighter.limit, 500);

  const looser = capEnvioEcomDeclaredValue(1800, 2500);
  assert.equal(looser.capped, false);
  assert.equal(looser.value, 1800);
  assert.equal(looser.limit, 2500);
});

test("recusa de negocio do create nao usa 502", () => {
  assert.equal(envioEcomResponseStatus("CREATE_REJECTED", 502), 422);
  assert.equal(envioEcomResponseStatus("CREATE_FAILED", 502), 502);
  assert.equal(envioEcomResponseStatus("TOKEN_INVALID", 502), 502);
  assert.equal(envioEcomResponseStatus("INSUFFICIENT_BALANCE", 402), 402);
});
