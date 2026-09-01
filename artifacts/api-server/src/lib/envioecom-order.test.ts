import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExternalOrderNumber,
  buildNextExternalOrderNumber,
  isDuplicateOrderIdError,
  shipmentEventMatchesOrder,
} from "./envioecom-order-ref";

test("primeiro envio usa orderId estavel; depois do historico gera sufixo", () => {
  const order = { id: "abcdefghij1234", orderNumber: 2041 };
  assert.equal(buildExternalOrderNumber(order), "2041-abcdefgh");
  assert.equal(buildNextExternalOrderNumber(order), "2041-abcdefgh");
  const next = buildNextExternalOrderNumber({
    ...order,
    envioecomStatusHistory: [{ at: "2026-08-31T12:00:00.000Z", status: "Etiqueta gerada" }],
  }, "xyz1");
  assert.equal(next, "2041-abcdefgh-xyz1");
  assert.notEqual(next, buildExternalOrderNumber(order));
});

test("pedido ainda ligado reusa o orderId atual", () => {
  assert.equal(buildNextExternalOrderNumber({
    id: "abcdefghij1234",
    orderNumber: 2041,
    envioecomShipmentId: 726270,
    envioecomExternalOrderNumber: "2041-abcdefgh",
  }), "2041-abcdefgh");
});

test("webhook so casa o envio atual; pedido solto ignora 8880 antigo", () => {
  const unbound = {
    envioecomShipmentId: null,
    envioecomBarcode: null,
    trackingCode: null,
    envioecomExternalOrderNumber: null,
  };
  assert.equal(shipmentEventMatchesOrder(unbound, { barcode: "888030905777936", shipmentId: 1 }), false);

  const bound = {
    envioecomShipmentId: 99,
    envioecomBarcode: "888099999999999",
    trackingCode: "888099999999999",
    envioecomExternalOrderNumber: "2041-abcdefgh-xyz1",
  };
  assert.equal(shipmentEventMatchesOrder(bound, {
    barcode: "888030905777936",
    shipmentId: 1,
    externalOrderNumber: "2041-abcdefgh",
  }), false);
  assert.equal(shipmentEventMatchesOrder(bound, {
    barcode: "888099999999999",
    shipmentId: 99,
    externalOrderNumber: "2041-abcdefgh-xyz1",
  }), true);
});

test("detecta DUPLICATE_ORDER da EnvioEcom", () => {
  assert.equal(isDuplicateOrderIdError({ code: "DUPLICATE_ORDER", message: "Order already exists" }), true);
  assert.equal(isDuplicateOrderIdError({ code: "OTHER", message: "ok" }), false);
});
