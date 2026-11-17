import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "mysql://test:test@127.0.0.1:3306/ka_whatsapp_test";

const PHONE = "5500000000000";

test("direto enfileira e o n8n padrão não chama a Z-API", async () => {
  const { sendCustomerWhatsapp } = await import("./whatsapp-dispatch");
  const settings = new Map<string, string>([["zapi_channel_order_paid", "direto"]]);
  const queued: string[] = [];
  let posted = 0;
  const deps = {
    readSetting: async (_tenantId: string, key: string) => settings.get(key) || "",
    accept: async (draft: { origin: string; phone: string; immediate?: boolean }) => {
      queued.push(`${draft.origin}:${draft.phone}:${draft.immediate ? "agora" : "fila"}`);
      return { ok: true, queued: true };
    },
    postN8n: async () => {
      posted += 1;
      return true;
    },
    zapiReady: () => true,
  };
  const direct = await sendCustomerWhatsapp({
    origin: "paid",
    tenantId: "tenant_loja1",
    phone: PHONE,
    message: "pago",
    n8nUrl: "https://n8n.example/webhook/pago",
  }, deps);
  settings.clear();
  const legacy = await sendCustomerWhatsapp({
    origin: "paid",
    tenantId: "tenant_loja1",
    phone: PHONE,
    message: "pago",
    n8nUrl: "https://n8n.example/webhook/pago",
  }, deps);
  assert.equal(direct.queued, true);
  assert.deepEqual(queued, [`paid:${PHONE}:fila`]);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.queued, undefined);
  assert.equal(posted, 1);
});

test("n8n sem URL não dispara e a Rota Shopee vazia não chama o n8n", async () => {
  const { customerWhatsappReady, sendCustomerWhatsapp } = await import("./whatsapp-dispatch");
  const settings = new Map<string, string>();
  let posted = 0;
  let accepted = 0;
  const deps = {
    readSetting: async (_tenantId: string, key: string) => settings.get(key) || "",
    accept: async () => {
      accepted += 1;
      return { ok: true, queued: false };
    },
    postN8n: async () => {
      posted += 1;
      return true;
    },
    zapiReady: () => true,
  };
  assert.equal(await customerWhatsappReady({ origin: "tracking", tenantId: "tenant_loja1", n8nUrl: "" }, deps), false);
  const missing = await sendCustomerWhatsapp({
    origin: "tracking",
    tenantId: "tenant_loja1",
    phone: PHONE,
    message: "rastreio",
  }, deps);
  const shopee = await sendCustomerWhatsapp({
    origin: "shopee_route",
    tenantId: "tenant_loja1",
    phone: PHONE,
    message: "rota",
    preferImmediate: true,
    n8nUrl: "https://n8n.example/webhook/shopee",
  }, deps);
  assert.equal(missing.error, "not_configured");
  assert.equal(shopee.ok, true);
  assert.equal(posted, 0);
  assert.equal(accepted, 1);
});

test("escolha n8n da Rota Shopee usa o envio antigo", async () => {
  const { sendCustomerWhatsapp } = await import("./whatsapp-dispatch");
  const settings = new Map<string, string>([["zapi_channel_shopee_route", "n8n"]]);
  let usedLegacy = 0;
  const result = await sendCustomerWhatsapp({
    origin: "shopee_route",
    tenantId: "tenant_loja1",
    phone: PHONE,
    message: "rota",
    deliverN8n: async () => {
      usedLegacy += 1;
      return { ok: true };
    },
  }, {
    readSetting: async (_tenantId: string, key: string) => settings.get(key) || "",
    accept: async () => ({ ok: true, queued: true }),
    postN8n: async () => true,
    zapiReady: () => false,
  });
  assert.equal(result.ok, true);
  assert.equal(usedLegacy, 1);
});
