import assert from "node:assert/strict";
import test from "node:test";

import {
  filmagemShouldMark,
  inboundTypeShouldIgnore,
  isHttpsWebhookUrl,
  normalizeWhatsappPhone,
  planShipmentWhatsappNotices,
  shouldBackfillShipmentNotice,
  toWhatsappText,
} from "./whatsapp-notices";

test("telefone ganha 55 e quem já tem 55 permanece", () => {
  assert.equal(normalizeWhatsappPhone("(11) 99999-8888"), "5511999998888");
  assert.equal(normalizeWhatsappPhone("5511999998888"), "5511999998888");
  assert.equal(normalizeWhatsappPhone("1199998888"), "551199998888");
  assert.equal(normalizeWhatsappPhone("011999998888"), "5511999998888");
  assert.equal(normalizeWhatsappPhone("99998888"), null);
  assert.equal(normalizeWhatsappPhone("5511999"), null);
});

test("negrito do WhatsApp troca ** por *", () => {
  assert.equal(toWhatsappText("**Pedido** confirmado"), "*Pedido* confirmado");
});

test("URL vazia ou http não envia filmagem", () => {
  assert.equal(filmagemShouldMark(""), false);
  assert.equal(filmagemShouldMark("http://wallandrade.app.n8n.cloud/webhook/filmagem"), false);
  assert.equal(isHttpsWebhookUrl("https://n8n.example/webhook/filmagem"), true);
  assert.equal(filmagemShouldMark("https://n8n.example/webhook/filmagem"), true);
});

test("salto de aguardando coleta para saiu para entrega manda postado e saiu", () => {
  assert.deepEqual(planShipmentWhatsappNotices({
    previousStatus: "Aguardando coleta",
    nextStatus: "Saiu para entrega",
    nextCode: "AA123456789BR",
  }), ["tracking", "posted", "out_for_delivery"]);
});

test("já em trânsito só manda saiu para entrega", () => {
  assert.deepEqual(planShipmentWhatsappNotices({
    previousStatus: "Em trânsito",
    nextStatus: "Saiu para entrega",
    nextCode: "AA123456789BR",
  }), ["tracking", "out_for_delivery"]);
});

test("em rota na primeira postagem manda postado e saiu", () => {
  assert.deepEqual(planShipmentWhatsappNotices({
    previousStatus: "Aguardando coleta",
    nextStatus: "EM ROTA - CO SAMAMBAIA 01",
    previousCode: "AA123456789BR",
    nextCode: "AA123456789BR",
  }), ["posted", "out_for_delivery"]);
});

test("em rota depois de em trânsito avisa saiu sem repetir postado", () => {
  assert.deepEqual(planShipmentWhatsappNotices({
    previousStatus: "Em trânsito",
    nextStatus: "EM ROTA - CO SAMAMBAIA 01",
    previousCode: "AA123456789BR",
    nextCode: "AA123456789BR",
  }), ["out_for_delivery"]);
});

test("coluna vazia repete postado, saiu e rastreio; entregue espera a coluna existir", () => {
  assert.equal(shouldBackfillShipmentNotice("posted", false, [], "order"), true);
  assert.equal(shouldBackfillShipmentNotice("out_for_delivery", false, [], "pkg-1"), true);
  assert.equal(shouldBackfillShipmentNotice("posted", true, ["order"], "order"), false);
  assert.equal(shouldBackfillShipmentNotice("delivered", false, [], "order"), false);
  assert.equal(shouldBackfillShipmentNotice("delivered", true, [], "order"), true);
  assert.equal(shouldBackfillShipmentNotice("tracking", false, [], "order"), true);
  assert.equal(shouldBackfillShipmentNotice("tracking", true, ["order"], "order"), false);
});

test("código EC não dispara rastreio, postado, saiu nem entregue", () => {
  assert.deepEqual(planShipmentWhatsappNotices({
    previousStatus: "Aguardando coleta",
    nextStatus: "Saiu para entrega",
    nextCode: "EC123456",
  }), []);
});

test("create não avisa rastreio dentro do persist", () => {
  assert.deepEqual(planShipmentWhatsappNotices({
    previousStatus: "Aguardando coleta",
    nextStatus: "Postado",
    nextCode: "AA123456789BR",
    skipTracking: true,
  }), ["posted"]);
});

test("entregue olha a frase da transportadora e não repete postado", () => {
  assert.deepEqual(planShipmentWhatsappNotices({
    previousStatus: "Em trânsito",
    nextStatus: "Entregue",
    nextCode: "AA123456789BR",
  }), ["tracking", "delivered"]);
});

test("etiqueta pronta com código real só avisa rastreio", () => {
  assert.deepEqual(planShipmentWhatsappNotices({
    previousStatus: "",
    nextStatus: "Etiqueta emitida",
    nextCode: "AA123456789BR",
  }), ["tracking"]);
});

test("type vazio segue e type sem received é ignorado", () => {
  assert.equal(inboundTypeShouldIgnore(""), false);
  assert.equal(inboundTypeShouldIgnore(undefined), false);
  assert.equal(inboundTypeShouldIgnore("ReceivedCallback"), false);
  assert.equal(inboundTypeShouldIgnore("DeliveryCallback"), true);
});
