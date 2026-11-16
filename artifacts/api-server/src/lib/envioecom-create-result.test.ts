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

test("lote recusado da doc usa results[0].error e nao vira envio criado", () => {
  const assessed = assessCreatedShipment({
    shipping_create: {
      success: false,
      created: 0,
      results: [{
        index: 0,
        order_id: "PED-1001",
        error: "CEP inválido não aceito pelos Correios. Confirme o CEP completo do destinatário.",
      }],
    },
    payment_processing: { processed: 0, errors: [] },
    processed_barcodes: [],
  });
  assert.equal(assessed.ok, false);
  assert.equal(assessed.summary.outcome, "error");
  assert.equal(assessed.summary.errorCode, null);
  assert.equal(assessed.summary.hasShipmentId, false);
  assert.equal(assessed.summary.hasBarcode, false);
  assert.equal(assessed.patch.shipmentId, undefined);
  assert.equal(
    assessed.message,
    "A EnvioEcom recusou o envio: CEP inválido não aceito pelos Correios. Confirme o CEP completo do destinatário.",
  );
  assert.equal(assessed.message.includes("PED-1001"), false);
});

test("lote recusado com error_code guarda o codigo e a frase", () => {
  const assessed = assessCreatedShipment({
    shipping_create: {
      success: false,
      created: 0,
      results: [{
        index: 0,
        order_id: "PED-1001",
        error_code: "ORIGIN_NOT_CONFIGURED",
        error: "Conta sem local de coleta configurado.",
      }],
    },
    payment_processing: { processed: 0, errors: [] },
    processed_barcodes: ["EC85***************"],
  });
  assert.equal(assessed.ok, false);
  assert.equal(assessed.summary.errorCode, "ORIGIN_NOT_CONFIGURED");
  assert.equal(assessed.summary.hasBarcode, false);
  assert.equal(assessed.summary.hasShipmentId, false);
  assert.equal(
    assessed.message,
    "A EnvioEcom recusou o envio: Conta sem local de coleta configurado. — ORIGIN_NOT_CONFIGURED",
  );
});

test("lote recusado sem frase usa so o error_code", () => {
  const assessed = assessCreatedShipment({
    shipping_create: {
      success: false,
      created: 0,
      results: [{ index: 0, order_id: "PED-1001", error_code: "CARRIER_INVALID" }],
    },
    payment_processing: { processed: 0, errors: [] },
    processed_barcodes: [],
  });
  assert.equal(assessed.ok, false);
  assert.equal(assessed.summary.errorCode, "CARRIER_INVALID");
  assert.equal(assessed.message, "A EnvioEcom recusou o envio: CARRIER_INVALID");
});

test("lote recusado junta credito do item com erros do pagamento", () => {
  const assessed = assessCreatedShipment({
    shipping_create: {
      success: false,
      created: 0,
      results: [{
        index: 0,
        order_id: "PED-1001",
        error_code: "CREDIT_VALIDATION_FAILED",
        error: "Não foi possível validar o crédito da conta.",
      }],
    },
    payment_processing: {
      processed: 0,
      error_code: "CREDIT_VALIDATION_FAILED",
      errors: ["Saldo insuficiente para debitar o frete."],
    },
    processed_barcodes: [],
  });
  assert.equal(assessed.ok, false);
  assert.equal(assessed.summary.errorCode, "CREDIT_VALIDATION_FAILED");
  assert.match(assessed.message, /^A EnvioEcom recusou o envio: /);
  assert.match(assessed.message, /Não foi possível validar o crédito da conta/);
  assert.match(assessed.message, /CREDIT_VALIDATION_FAILED/);
  assert.match(assessed.message, /Saldo insuficiente para debitar o frete/);
  assert.equal(assessed.message.includes("PED-1001"), false);
});

test("sem motivo no item, o 502 usa payment_processing.errors e o codigo", () => {
  const strings = assessCreatedShipment({
    shipping_create: {
      success: false,
      created: 0,
      results: [{ index: 0, order_id: "PED-1001" }],
    },
    payment_processing: {
      processed: 0,
      errors: ["Saldo insuficiente para debitar o frete."],
    },
    processed_barcodes: [],
  });
  assert.equal(strings.ok, false);
  assert.equal(strings.summary.errorCode, null);
  assert.equal(strings.message, "A EnvioEcom recusou o envio: Saldo insuficiente para debitar o frete.");

  const coded = assessCreatedShipment({
    shipping_create: {
      success: false,
      created: 0,
      results: [{ index: 0 }],
    },
    payment_processing: {
      processed: 0,
      errors: [{ error_code: "CREDIT_VALIDATION_FAILED", message: "Crédito recusado nesta conta." }],
    },
    processed_barcodes: [],
  });
  assert.equal(coded.summary.errorCode, "CREDIT_VALIDATION_FAILED");
  assert.match(coded.message, /Crédito recusado nesta conta/);
  assert.match(coded.message, /CREDIT_VALIDATION_FAILED/);

  const byMessage = assessCreatedShipment({
    shipping_create: {
      success: false,
      created: 0,
      results: [{ message: "Bairro não informado.", errors: ["não usar este"] }],
    },
    payment_processing: { errors: ["Saldo insuficiente para debitar o frete."] },
    processed_barcodes: [],
  });
  assert.match(byMessage.message, /Bairro não informado/);
  assert.match(byMessage.message, /Saldo insuficiente para debitar o frete/);
  assert.equal(byMessage.message.includes("não usar este"), false);
});

test("lote recusado nao leva token nem dado do cliente na frase", () => {
  const payload = {
    token: "secret-token-value",
    name: "Maria Silva",
    document_number: "123.456.789-00",
    phone_number: "11999998888",
    email: "maria@example.com",
    shipping_create: {
      success: false,
      created: 0,
      results: [{
        error_code: "CREDIT_VALIDATION_FAILED",
        error: "Falhou para Maria Silva CPF 123.456.789-00 token secret-token-value",
      }],
    },
    payment_processing: {
      errors: ["Débito de Maria Silva no fone 11999998888 recusado"],
    },
    processed_barcodes: [],
  };
  const assessed = assessCreatedShipment(payload);
  const dumped = JSON.stringify({ message: assessed.message, summary: assessed.summary });
  assert.equal(assessed.ok, false);
  assert.equal(assessed.summary.errorCode, "CREDIT_VALIDATION_FAILED");
  assert.equal(dumped.includes("secret-token-value"), false);
  assert.equal(dumped.includes("Maria Silva"), false);
  assert.equal(dumped.includes("123.456.789-00"), false);
  assert.equal(dumped.includes("11999998888"), false);
  assert.equal(dumped.includes("maria@example.com"), false);
  assert.match(assessed.message, /A EnvioEcom recusou o envio:/);
  assert.match(assessed.message, /CREDIT_VALIDATION_FAILED/);
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
