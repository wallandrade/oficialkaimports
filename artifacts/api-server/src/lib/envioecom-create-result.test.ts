import assert from "node:assert/strict";
import test from "node:test";

import { assessCreatedShipment, parseCreatedShipment } from "./envioecom-create-result";

test("create classico le shipping_id e barcode em results[0]", () => {
  const patch = parseCreatedShipment({
    shipping_create: {
      results: [{
        shipping_id: 726270,
        barcode: "888099999999999",
        status: "Envio criado",
        orderId: "2041-abcdefgh",
        shipping_company: "J&T Express envioEcom",
      }],
    },
    processed_barcodes: ["888099999999999"],
    freight_adjustments: [{ current: "19.85" }],
  });
  assert.equal(patch.shipmentId, 726270);
  assert.equal(patch.barcode, "888099999999999");
  assert.equal(patch.externalOrderNumber, "2041-abcdefgh");
  assert.equal(patch.freightCost, "19.85");
  assert.equal(patch.deliveryMode, "J&T Express envioEcom");
});

test("create aceita id na raiz, em data e em shipments", () => {
  assert.equal(assessCreatedShipment({ shipping_id: 10, barcode: "ABC123456BR" }).ok, true);
  assert.equal(assessCreatedShipment({ shipping_id: 10, barcode: "ABC123456BR" }).patch.shipmentId, 10);

  const nested = assessCreatedShipment({ data: { id: 11, tracking_code: "JT1234567890" } });
  assert.equal(nested.ok, true);
  assert.equal(nested.patch.shipmentId, 11);
  assert.equal(nested.patch.barcode, "JT1234567890");

  const list = assessCreatedShipment({ shipments: [{ shipment_id: 12, barcode: "JD123456" }] });
  assert.equal(list.ok, true);
  assert.equal(list.patch.shipmentId, 12);

  const direct = assessCreatedShipment({ shipping_create: { id: 13, barcode: "BR123456789BR" } });
  assert.equal(direct.ok, true);
  assert.equal(direct.patch.shipmentId, 13);
});

test("results vazio ou corpo de erro nao vira sucesso", () => {
  const empty = assessCreatedShipment({ shipping_create: { results: [] } });
  assert.equal(empty.ok, false);
  assert.equal(empty.summary.outcome, "empty");
  assert.equal(empty.patch.shipmentId, undefined);

  const refused = assessCreatedShipment({
    error: { code: "NO_BALANCE", message: "Saldo insuficiente" },
    shipping_create: { results: [{ shipping_id: 1, barcode: "AA123456789BR" }] },
  });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Saldo insuficiente/);
  assert.equal(refused.summary.errorCode, "NO_BALANCE");

  const failed = assessCreatedShipment({ success: false, message: "Documento inválido" });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /Documento inválido/);

  const item = assessCreatedShipment({ shipping_create: { results: [{ error: "CEP recusado" }] } });
  assert.equal(item.ok, false);
  assert.match(item.message, /CEP recusado/);
});

test("mensagem extra nao esconde um envio que ja tem id", () => {
  const assessed = assessCreatedShipment({
    code: "OK",
    message: "criado",
    shipping_create: { results: [{ shipping_id: 44, barcode: "AA123456789BR" }] },
  });
  assert.equal(assessed.ok, true);
  assert.equal(assessed.patch.shipmentId, 44);
});

test("codigo sozinho ainda conta; envelope de erro nao vira rastreio", () => {
  const codeOnly = assessCreatedShipment({
    shipping_create: { results: [{ barcode: "AA123456789BR" }] },
  });
  assert.equal(codeOnly.ok, true);
  assert.equal(codeOnly.patch.barcode, "AA123456789BR");

  const loose = assessCreatedShipment({
    shipping_create: { results: [] },
    processed_barcodes: ["AA123456789BR"],
  });
  assert.equal(loose.ok, true);
  assert.equal(loose.patch.barcode, "AA123456789BR");

  const envelope = assessCreatedShipment({ code: "VALIDATION", message: "não criou" });
  assert.equal(envelope.ok, false);
  assert.equal(envelope.summary.hasBarcode, false);

  const numbered = assessCreatedShipment({ code: "ERR400", message: "não criou" });
  assert.equal(numbered.ok, false);
  assert.equal(numbered.summary.hasBarcode, false);
  assert.match(numbered.message, /ERR400/);
});

test("resumo do create nao leva token nem dado do cliente", () => {
  const payload = {
    token: "secret-token-value",
    name: "Maria Silva",
    document_number: "123.456.789-00",
    phone_number: "11999998888",
    email: "maria@example.com",
    logradouro: "Rua das Flores",
    error: {
      code: "RECUSADO",
      message: "Falhou para Maria Silva CPF 123.456.789-00 fone 11999998888 em Rua das Flores token secret-token-value",
    },
    shipping_create: { results: [] },
  };
  const assessed = assessCreatedShipment(payload);
  const dumped = JSON.stringify({ message: assessed.message, summary: assessed.summary });
  assert.equal(assessed.ok, false);
  assert.equal(dumped.includes("secret-token-value"), false);
  assert.equal(dumped.includes("Maria Silva"), false);
  assert.equal(dumped.includes("123.456.789-00"), false);
  assert.equal(dumped.includes("11999998888"), false);
  assert.equal(dumped.includes("maria@example.com"), false);
  assert.equal(dumped.includes("Rua das Flores"), false);
  assert.match(assessed.message, /Falhou para \[oculto\]/);
});
