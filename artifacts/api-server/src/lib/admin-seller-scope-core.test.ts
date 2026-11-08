import assert from "node:assert/strict";
import test from "node:test";
import { resolveSellerAccess, sellerRowBelongsToTenant } from "./admin-seller-scope-core";

const base = {
  isPrimary: false,
  sessionTenantId: "tenant_loja1",
  defaultTenantId: "tenant_loja1",
  explicit: null,
  legacySellerCode: null,
  storeAdminTenantId: null,
};

test("superadmin não fica preso a vendedor", () => {
  const access = resolveSellerAccess({ ...base, isPrimary: true, legacySellerCode: "ana" });
  assert.equal(access.hasGlobalAccess, true);
  assert.equal(access.sellerCode, null);
  assert.equal(access.denied, false);
});

test("vínculo do painel vale e ignora o mapa antigo", () => {
  const access = resolveSellerAccess({
    ...base,
    explicit: { status: "linked", tenantId: "tenant_filial", sellerCode: "bia", sellerValid: true },
    legacySellerCode: "ana",
  });
  assert.equal(access.hasGlobalAccess, false);
  assert.equal(access.sellerCode, "bia");
  assert.equal(access.tenantId, "tenant_filial");
});

test("vínculo removido não reabre o mapa antigo", () => {
  const access = resolveSellerAccess({
    ...base,
    explicit: { status: "cleared", tenantId: "tenant_loja1", sellerCode: null, sellerValid: false },
    legacySellerCode: "ana",
  });
  assert.equal(access.denied, true);
  assert.equal(access.sellerCode, null);
});

test("admin da filial continua na loja inteira", () => {
  const access = resolveSellerAccess({ ...base, sessionTenantId: "tenant_filial", storeAdminTenantId: "tenant_filial", legacySellerCode: "ana" });
  assert.equal(access.hasGlobalAccess, true);
  assert.equal(access.sellerCode, null);
  assert.equal(access.tenantId, "tenant_filial");
});

test("conta antiga sem vínculo usa o mapa só na loja 1", () => {
  const access = resolveSellerAccess({ ...base, legacySellerCode: "ana" });
  assert.equal(access.hasGlobalAccess, false);
  assert.equal(access.sellerCode, "ana");
  assert.equal(access.denied, false);
});

test("slug de outra loja não pertence", () => {
  assert.equal(sellerRowBelongsToTenant("tenant_filial", "tenant_loja1", "tenant_loja1"), false);
  assert.equal(sellerRowBelongsToTenant(null, "tenant_loja1", "tenant_loja1"), true);
});
