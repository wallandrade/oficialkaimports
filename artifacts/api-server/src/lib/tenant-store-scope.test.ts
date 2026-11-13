import assert from "node:assert/strict";
import test from "node:test";
import {
  isMainStoreTenant,
  orderCatalogTenantId,
  whatsappServerEnv,
} from "./tenant-store-scope";

test("env do WhatsApp entra só na loja principal", () => {
  const envUrl = "https://n8n.example/webhook/pago";
  assert.equal(whatsappServerEnv("tenant_loja1", envUrl), envUrl);
  assert.equal(whatsappServerEnv(null, envUrl), envUrl);
  assert.equal(whatsappServerEnv("", "  5535999999999  "), "5535999999999");
  assert.equal(whatsappServerEnv("tenant_filial", envUrl), "");
  assert.equal(whatsappServerEnv("tenant_filial", "   "), "");
  assert.equal(isMainStoreTenant("tenant_filial"), false);
  assert.equal(isMainStoreTenant(""), true);
});

test("catálogo do pedido usa a loja do pedido e o legado cai na sessão", () => {
  assert.equal(orderCatalogTenantId("tenant_filial", "tenant_loja1"), "tenant_filial");
  assert.equal(orderCatalogTenantId(null, "tenant_loja1"), "tenant_loja1");
  assert.equal(orderCatalogTenantId("  ", "tenant_filial"), "tenant_filial");
  assert.equal(orderCatalogTenantId(null, null), "tenant_loja1");
});
