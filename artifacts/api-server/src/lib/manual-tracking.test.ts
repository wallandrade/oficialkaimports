import assert from "node:assert/strict";
import test from "node:test";
import {
  decideManualTrackingUpdate,
  isManualTrackingCodeValid,
  manualTrackingKeepsEnviado,
  normalizeManualTrackingCode,
} from "./manual-tracking-logic";

test("normaliza o código do balcão", () => {
  assert.equal(normalizeManualTrackingCode(" aa 123456789 br "), "AA123456789BR");
  assert.equal(normalizeManualTrackingCode("  "), "");
});

test("aceita Correios e código com letra e número", () => {
  assert.equal(isManualTrackingCodeValid("AA123456789BR"), true);
  assert.equal(isManualTrackingCodeValid("BR12CD34EF"), true);
  assert.equal(isManualTrackingCodeValid("12345678"), false);
  assert.equal(isManualTrackingCodeValid("ABCDEFGH"), false);
  assert.equal(isManualTrackingCodeValid("AB12"), false);
  assert.equal(isManualTrackingCodeValid("AB-12345678"), false);
});

test("gravar marca enviado e coloca Correios se não havia transportadora", () => {
  const saved = decideManualTrackingUpdate({
    rawCode: "aa123456789br",
    currentDeliveryMode: "",
    hasEnvioEcomLabel: false,
  });
  assert.deepEqual(saved, { code: "AA123456789BR", enviado: true, setCorreios: true });
});

test("não troca a transportadora que já existe", () => {
  const saved = decideManualTrackingUpdate({
    rawCode: "AA123456789BR",
    currentDeliveryMode: "Jadlog",
    hasEnvioEcomLabel: false,
  });
  assert.equal("error" in saved, false);
  if ("error" in saved) return;
  assert.equal(saved.setCorreios, false);
  assert.equal(saved.enviado, true);
});

test("limpar apaga o código e só mantém enviado se houver etiqueta EnvioEcom", () => {
  const cleared = decideManualTrackingUpdate({
    rawCode: "   ",
    currentDeliveryMode: "Correios",
    hasEnvioEcomLabel: false,
  });
  assert.deepEqual(cleared, { code: null, enviado: false, setCorreios: false });

  const kept = decideManualTrackingUpdate({
    rawCode: "",
    hasEnvioEcomLabel: true,
  });
  assert.deepEqual(kept, { code: null, enviado: true, setCorreios: false });
});

test("etiqueta pronta da EnvioEcom segura o enviado; envio criado não", () => {
  assert.equal(manualTrackingKeepsEnviado({ envioecomStatus: "Etiqueta gerada" }), true);
  assert.equal(manualTrackingKeepsEnviado({ envioecomLabelUrl: "https://cdn.example/a.pdf" }), true);
  assert.equal(manualTrackingKeepsEnviado({ envioecomStatus: "Envio criado" }), false);
  assert.equal(manualTrackingKeepsEnviado({ envioecomStatus: null, envioecomLabelUrl: null }), false);
});

test("código inválido não grava", () => {
  const rejected = decideManualTrackingUpdate({
    rawCode: "12345678",
    hasEnvioEcomLabel: false,
  });
  assert.equal("error" in rejected, true);
});
