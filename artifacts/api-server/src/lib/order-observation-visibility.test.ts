import assert from "node:assert/strict";
import test from "node:test";

import { isObservationVisibleToCustomer, observationForCustomerApi } from "./order-observation-visibility";

test("flag desligada esconde a nota do cliente", () => {
  assert.equal(isObservationVisibleToCustomer(false), false);
  assert.equal(isObservationVisibleToCustomer(0), false);
  assert.equal(isObservationVisibleToCustomer(null), false);
  assert.equal(observationForCustomerApi("Recado interno", false), null);
  assert.equal(observationForCustomerApi("REENVIO DO PEDIDO x", 0), null);
});

test("flag ligada devolve o texto só se houver conteúdo", () => {
  assert.equal(isObservationVisibleToCustomer(true), true);
  assert.equal(isObservationVisibleToCustomer(1), true);
  assert.equal(observationForCustomerApi("  Atraso na postagem  ", true), "Atraso na postagem");
  assert.equal(observationForCustomerApi("   ", true), null);
  assert.equal(observationForCustomerApi(null, true), null);
});
