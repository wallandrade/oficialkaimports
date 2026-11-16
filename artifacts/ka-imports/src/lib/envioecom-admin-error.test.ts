import assert from "node:assert/strict";
import test from "node:test";

import {
  envioEcomAdminErrorCode,
  envioEcomAdminErrorMessage,
  parseEnvioEcomErrorBody,
} from "./envioecom-admin-error";

const sentence = "A EnvioEcom recusou o envio: Não foi possível validar o crédito da conta. — CREDIT_VALIDATION_FAILED — Saldo insuficiente para debitar o frete.";

test("toast usa message do 502 e nao cai em Erro EnvioEcom", () => {
  const raw = JSON.stringify({
    error: "CREATE_REJECTED",
    message: sentence,
    details: { outcome: "error", resultsCount: 1, errorCode: "CREDIT_VALIDATION_FAILED" },
  });
  const data = parseEnvioEcomErrorBody(raw);
  const message = envioEcomAdminErrorMessage(data, raw);
  assert.equal(envioEcomAdminErrorCode(data), "CREATE_REJECTED");
  assert.equal(message, sentence);
  assert.equal(message.includes("outcome"), false);
  assert.equal(message.includes("resultsCount"), false);
  assert.equal(message.split("CREDIT_VALIDATION_FAILED").length - 1, 1);
});

test("toast ainda mostra field e message e ignora o resumo interno", () => {
  const message = envioEcomAdminErrorMessage({
    message: "Documento inválido",
    details: [
      { field: "document_number", message: "CPF inválido" },
      { outcome: "error", resultsCount: 1, errorCode: "NO_BALANCE" },
    ],
  });
  assert.equal(message, "Documento inválido — document_number: CPF inválido");

  const mapped = envioEcomAdminErrorMessage({
    message: "Dados recusados",
    details: { errors: { "to.document": ["CPF inválido"] } },
  });
  assert.match(mapped, /CPF inválido/);
  assert.equal(mapped.includes("outcome"), false);
  assert.equal(mapped.includes("resultsCount"), false);
});

test("toast le message com BOM ou texto antes do JSON", () => {
  const raw = `\uFEFFaviso\n${JSON.stringify({ error: "CREATE_REJECTED", message: sentence })}`;
  const data = parseEnvioEcomErrorBody(raw);
  assert.match(envioEcomAdminErrorMessage(data, raw), /CREDIT_VALIDATION_FAILED/);
  assert.equal(envioEcomAdminErrorMessage(data, raw).includes("Erro EnvioEcom"), false);
});

test("toast le error.message quando error nao e string", () => {
  const data = { error: { code: "CREDIT_VALIDATION_FAILED", message: "Crédito recusado nesta conta." } };
  assert.equal(envioEcomAdminErrorCode(data), "CREDIT_VALIDATION_FAILED");
  assert.match(envioEcomAdminErrorMessage(data), /Crédito recusado nesta conta/);
  assert.equal(envioEcomAdminErrorMessage(data).includes("Erro EnvioEcom"), false);
  assert.equal(envioEcomAdminErrorMessage(data).includes("[object Object]"), false);
});

test("corpo vazio ou HTML continua no fallback", () => {
  assert.equal(envioEcomAdminErrorMessage(parseEnvioEcomErrorBody(""), ""), "Erro EnvioEcom");
  assert.equal(envioEcomAdminErrorMessage({}, "<html>erro</html>"), "Erro EnvioEcom");
});

test("texto curto que nao e JSON aparece no toast", () => {
  const raw = "Saldo insuficiente para debitar o frete.";
  assert.equal(envioEcomAdminErrorMessage(parseEnvioEcomErrorBody(raw), raw), raw);
});
