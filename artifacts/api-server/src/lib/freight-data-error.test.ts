import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFreightDataError,
  deliveryCorrectionMessage,
  deliveryCorrectionWhatsappPayload,
  isValidCnpj,
  isValidCpf,
  maskCpf,
  postDeliveryCorrectionWhatsapp,
  shouldAutoSendDeliveryCorrection,
} from "./freight-data-error";

test("códigos da Ka apontam CPF, CEP ou endereço", () => {
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_RECIPIENT",
    message: "CPF/CNPJ do pedido inválido. Edite o pedido e informe o documento correto.",
  }), ["cpf"]);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_CEP",
    message: "CEP de destino inválido no pedido.",
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
    code: "ENVIOECOM_ERROR",
    message: "The given data was invalid.",
    details: { errors: { "to.document": ["CPF inválido"], "to.postal_code": ["CEP não encontrado"] } },
  }), ["cpf", "cep"]);
  assert.deepEqual(classifyFreightDataError({
    code: "CREATE_INCOMPLETE",
    message: "EnvioEcom: CEP de destino inexistente",
  }), ["cep"]);
});

test("telefone, e-mail, CEP de origem e conta não abrem correção", () => {
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_RECIPIENT",
    message: "Telefone do pedido inválido. Edite o pedido e informe um telefone com DDD.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_RECIPIENT",
    message: "E-mail do pedido inválido. Edite o pedido e informe o e-mail do cliente.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "INVALID_PHONE",
    message: "Telefone do pedido inválido para criar envio EnvioEcom.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "ORIGIN_CEP_REQUIRED",
    message: "CEP de origem obrigatório. Configure na conta EnvioEcom.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "ENVIOECOM_ERROR",
    message: "CEP de origem da conta não foi encontrado.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "TOKEN_MISSING",
    message: "EnvioEcom não configurado: informe token ou e-mail e senha.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "UNSUPPORTED_SHIPPING",
    message: "EnvioEcom não se aplica a motoboy ou retirada.",
  }), []);
  assert.deepEqual(classifyFreightDataError({
    code: "ENVIOECOM_ERROR",
    message: "The given data was invalid.",
    details: { errors: { phone_number: ["Telefone inválido"] } },
  }), []);
});

test("mensagem, CPF e um envio automático por token", () => {
  assert.equal(isValidCpf("390.533.447-05"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(isValidCnpj("11.444.777/0001-61"), true);
  assert.equal(isValidCnpj("11.111.111/1111-11"), false);
  assert.equal(maskCpf("39053344705"), "***.533.447-**");
  const message = deliveryCorrectionMessage({
    name: "Ana Souza",
    orderNumber: "1842",
    fields: ["cpf", "endereco"],
    link: "https://www.ka-imports.com/corrigir-entrega?token=abc",
  });
  assert.equal(message, "Olá Ana! Para enviarmos seu pedido #1842 precisamos que você corrija seu CPF e endereço. É rapidinho, por este link: https://www.ka-imports.com/corrigir-entrega?token=abc");
  const payload = deliveryCorrectionWhatsappPayload({
    phone: "11999998888",
    name: "Ana Souza",
    orderNumber: "1842",
    fields: ["cpf"],
    message,
    link: "https://www.ka-imports.com/corrigir-entrega?token=abc",
  });
  assert.equal(payload?.event, "corrigir_dados_entrega");
  assert.equal(payload?.phone, "5511999998888");
  assert.deepEqual(payload?.fields, ["cpf"]);
  assert.equal(shouldAutoSendDeliveryCorrection(null), true);
  assert.equal(shouldAutoSendDeliveryCorrection({ whatsappAttemptedAt: null }), true);
  assert.equal(shouldAutoSendDeliveryCorrection({ whatsappAttemptedAt: new Date() }), false);
});

test("webhook de correção só aceita https e manda o evento", async () => {
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
  assert.equal(JSON.parse(calls[0]?.body || "{}").event, "corrigir_dados_entrega");
  const skipped = await postDeliveryCorrectionWhatsapp({
    url: "http://inseguro.exemplo.com/webhook",
    payload: payload!,
    fetchImpl: async () => {
      throw new Error("não deveria chamar");
    },
  });
  assert.equal(skipped.ok, false);
});
