import assert from "node:assert/strict";
import test from "node:test";
import { pickPreferredAdminTenant } from "./admin-tenant-pick";

test("sem vínculo cai fora da escolha", () => {
  assert.equal(pickPreferredAdminTenant([]), null);
  assert.equal(pickPreferredAdminTenant([{ tenantId: "  ", role: "owner" }]), null);
});

test("vínculo só da loja padrão permanece na loja 1", () => {
  const picked = pickPreferredAdminTenant([
    { tenantId: "tenant_loja1", role: "owner", tenantName: "Loja padrão" },
  ]);
  assert.equal(picked?.tenantId, "tenant_loja1");
  assert.equal(picked?.tenantName, "Loja padrão");
});

test("owner de filial vence o backfill da loja 1", () => {
  const picked = pickPreferredAdminTenant([
    { tenantId: "tenant_loja1", role: "owner", tenantName: "Loja padrão" },
    { tenantId: "tenant_minas", role: "owner", tenantName: "Minas" },
  ]);
  assert.equal(picked?.tenantId, "tenant_minas");
  assert.equal(picked?.tenantName, "Minas");
});

test("qualquer vínculo fora da loja 1 vence a loja padrão", () => {
  const picked = pickPreferredAdminTenant([
    { tenantId: "tenant_loja1", role: "platform_admin", tenantName: "Loja padrão" },
    { tenantId: " tenant_sul ", role: "member", tenantName: "Sul" },
  ]);
  assert.equal(picked?.tenantId, "tenant_sul");
  assert.equal(picked?.role, "member");
});
