import assert from "node:assert/strict";
import test from "node:test";
import {
  WHATSAPP_HOURLY_CAP,
  WHATSAPP_SEND_GAP_MS,
  isFakeWhatsappPhone,
  maskWhatsappPhone,
  normalizeWhatsappChannelSetting,
  parseWhatsappChannel,
  whatsappBackoffMs,
  whatsappInstanceCanSend,
} from "./whatsapp-outbound-policy";

test("aviso vazio continua no n8n e a Rota Shopee vazia continua direta", () => {
  assert.equal(parseWhatsappChannel("paid", ""), "n8n");
  assert.equal(parseWhatsappChannel("paid", "direto"), "direto");
  assert.equal(parseWhatsappChannel("support", "N8N"), "n8n");
  assert.equal(parseWhatsappChannel("shopee_route", ""), "direto");
  assert.equal(parseWhatsappChannel("shopee_route", "n8n"), "n8n");
  assert.equal(normalizeWhatsappChannelSetting("zapi_channel_order_paid", "direto"), "direto");
  assert.equal(normalizeWhatsappChannelSetting("zapi_channel_order_paid", "fila"), null);
});

test("ritmo é 10 minutos e no máximo 10 por hora", () => {
  assert.equal(WHATSAPP_SEND_GAP_MS, 10 * 60 * 1000);
  assert.deepEqual(whatsappInstanceCanSend({ sentInLastHour: 0, sentInLastGap: false }), { ok: true });
  assert.deepEqual(whatsappInstanceCanSend({ sentInLastHour: 1, sentInLastGap: true }), { ok: false, reason: "gap" });
  assert.deepEqual(
    whatsappInstanceCanSend({ sentInLastHour: WHATSAPP_HOURLY_CAP, sentInLastGap: false }),
    { ok: false, reason: "hourly" },
  );
  assert.equal(whatsappBackoffMs(1), 10 * 60 * 1000);
  assert.equal(whatsappBackoffMs(2), 20 * 60 * 1000);
  assert.equal(whatsappBackoffMs(3), 40 * 60 * 1000);
  assert.equal(whatsappBackoffMs(8), 60 * 60 * 1000);
});

test("telefone de log fica mascarado e o número de teste não parece celular real", () => {
  assert.equal(maskWhatsappPhone("5511999991234"), "***1234");
  assert.equal(maskWhatsappPhone("5500000000000"), "***0000");
  assert.equal(isFakeWhatsappPhone("5500000000000"), true);
  assert.equal(isFakeWhatsappPhone("5511999991234"), false);
});
