import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFreightDataError,
  deliveryCorrectionLink,
  deliveryCorrectionMessage,
  deliveryCorrectionWhatsappPayload,
  isMainStoreDeliveryCorrectionTenant,
  isValidCnpj,
  isValidCpf,
  maskCpf,
  postDeliveryCorrectionWhatsapp,
  shipmentBlocksDeliveryCorrection,
  shouldAutoSendDeliveryCorrection,
} from "./freight-data-error";

test("SuperFrete e EnvioEcom apontam CPF, CEP ou endereço", () => {
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_DOCUMENT",
    message: "CPF ou CNPJ do destinatário é obrigatório na SuperFrete.",
  }), ["cpf"]);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_RECIPIENT",
    message: "CPF/CNPJ do pedido inválido. Edite o pedido e informe o documento correto.",
  }), ["cpf"]);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_ADDRESS",
    message: "Pedido sem CEP de destino válido.",
  }), ["cep"]);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_CEP",
    message: "CEP de destino inválido no pedido.",
  }), ["cep"]);
  assert.deepEqual(classifyFreightDataError({
    code: "CREATE_INCOMPLETE",
    message: "EnvioEcom: CEP de destino inexistente",
  }), ["cep"]);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_ADDRESS",
    message: "Endereço do pedido incompleto (rua, cidade, UF e CEP).",
  }), ["cep", "endereco"]);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_ADDRESS",
    message: "Endereço incompleto no pedido (rua, bairro, cidade e UF são obrigatórios).",
  }), ["endereco"]);
  assert.deepEqual(classifyFreightDataError({
    code: "SUPERFRETE_ERROR",
    message: "The given data was invalid.",
    details: { errors: { "to.document": ["CPF inválido"], "to.postal_code": ["CEP não encontrado"] } },
  }), ["cpf", "cep"]);
});

test("telefone, CEP de origem, duplicado e saldo não abrem o fluxo", () => {
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_PHONE",
    message: "Telefone do pedido inválido. Edite o pedido e informe um telefone com DDD.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_RECIPIENT",
    message: "Telefone do pedido inválido. Edite o pedido e informe um telefone com DDD.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_RECIPIENT",
    message: "E-mail do pedido inválido. Edite o pedido e informe o e-mail do cliente.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "ORIGIN_CEP",
    message: "CEP de origem da conta SuperFrete não foi encontrado.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "MISSING_ORIGIN_CEP",
    message: "CEP de origem obrigatório. Informe o CEP na conta EnvioEcom.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "ORIGIN_CEP_REQUIRED",
    message: "CEP de origem obrigatório. Configure na conta EnvioEcom.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "DUPLICATE_ORDER",
    message: "Order already exists",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "SHIPMENT_EXISTS",
    message: "Já existe envio EnvioEcom. Desvincule ou cancele antes de criar outro.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "INSUFFICIENT_BALANCE",
    message: "Saldo insuficiente para emitir a etiqueta.",
    details: { errors: { "to.postal_code": ["não usar"] } },
  }), []);
});

test("mensagem, CPF e um envio automático por token só na loja principal", () => {
  assert.equal(isMainStoreDeliveryCorrectionTenant("tenant_loja1"), true);
  assert.equal(isMainStoreDeliveryCorrectionTenant(""), true);
  assert.equal(isMainStoreDeliveryCorrectionTenant(null), true);
  assert.equal(isMainStoreDeliveryCorrectionTenant("tenant_filial_sp"), false);
  assert.equal(isValidCpf("390.533.447-05"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(isValidCnpj("11.444.777/0001-61"), true);
  assert.equal(maskCpf("39053344705"), "***.533.447-**");
  const link = deliveryCorrectionLink("abc");
  assert.equal(link, "https://www.ka-imports.com/corrigir-entrega?token=abc");
  const message = deliveryCorrectionMessage({
    name: "Ana Souza",
    orderNumber: "1842",
    fields: ["cpf", "endereco"],
    link,
  });
  assert.equal(message, "Olá Ana! Para enviarmos seu pedido #1842 precisamos que você corrija seu CPF e endereço. É rapidinho, por este link: https://www.ka-imports.com/corrigir-entrega?token=abc");
  const payload = deliveryCorrectionWhatsappPayload({
    phone: "11999998888",
    name: "Ana Souza",
    orderNumber: "1842",
    fields: ["cpf", "endereco"],
    message,
    link,
  });
  assert.deepEqual(payload, {
    event: "corrigir_dados_entrega",
    phone: "5511999998888",
    name: "Ana Souza",
    orderNumber: "1842",
    fields: ["cpf", "endereco"],
    message,
    link,
  });
  assert.equal(shouldAutoSendDeliveryCorrection(null), true);
  assert.equal(shouldAutoSendDeliveryCorrection({ whatsappAttemptedAt: null }), true);
  assert.equal(shouldAutoSendDeliveryCorrection({ whatsappAttemptedAt: new Date() }), false);
  assert.equal(shipmentBlocksDeliveryCorrection({ shipmentId: 10, status: "Envio criado" }), true);
  assert.equal(shipmentBlocksDeliveryCorrection({ labelUrl: "https://etiqueta", status: "Cancelado" }), false);
  assert.equal(shipmentBlocksDeliveryCorrection({}), false);
});

test("webhook de correção não sai da máquina e manda o evento novo", async () => {
  const payload = deliveryCorrectionWhatsappPayload({
    phone: "11988887777",
    name: "Ana",
    orderNumber: "10",
    fields: ["cep"],
    message: "Olá Ana! Para enviarmos seu pedido #10 precisamos que você corrija seu CEP. É rapidinho, por este link: https://www.ka-imports.com/corrigir-entrega?token=abc",
    link: "https://www.ka-imports.com/corrigir-entrega?token=abc",
  });
  assert.ok(payload);
  const calls: Array<{ url: string; body: string }> = [];
  const sent = await postDeliveryCorrectionWhatsapp({
    url: "https://n8n.exemplo.com/webhook/corrigir",
    payload: payload!,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body || "") });
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(sent.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://n8n.exemplo.com/webhook/corrigir");
  const body = JSON.parse(calls[0]?.body || "{}") as Record<string, unknown>;
  assert.equal(body.event, "corrigir_dados_entrega");
  assert.deepEqual(Object.keys(body).sort(), ["event", "fields", "link", "message", "name", "orderNumber", "phone"]);
  const skipped = await postDeliveryCorrectionWhatsapp({
    url: "http://inseguro.exemplo.com/webhook",
    payload: payload!,
    fetchImpl: async () => {
      throw new Error("não deveria chamar");
    },
  });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.error, "WhatsApp não configurado.");
  const missing = await postDeliveryCorrectionWhatsapp({
    url: "",
    payload: payload!,
    fetchImpl: async () => {
      throw new Error("não deveria chamar");
    },
  });
  assert.equal(missing.ok, false);
});
