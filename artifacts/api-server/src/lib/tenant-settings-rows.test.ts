import assert from "node:assert/strict";
import test from "node:test";
import { decideSiteProtection } from "./site-release";
import { mergeTenantSettingRows } from "./tenant-settings-rows";

const PAST = "2026-11-13T09:00";
const AFTER = new Date("2026-11-21T00:00:00.000Z");

test("a leitura da loja 1 prefere tenant_loja1 mesmo quando o residual vem por último", () => {
  const merged = mergeTenantSettingRows([
    { tenantId: "tenant_loja1", key: "site_release_enabled", value: "0" },
    { tenantId: "tenant_loja1", key: "site_password", value: "segredo" },
    { tenantId: null, key: "site_release_enabled", value: "1" },
    { tenantId: "", key: "site_release_enabled", value: "1" },
    { tenantId: "", key: "site_release_at", value: PAST },
    { tenantId: null, key: "site_password", value: "antiga" },
  ], "tenant_loja1");

  assert.equal(merged.site_release_enabled, "0");
  assert.equal(merged.site_password, "segredo");
  assert.equal(merged.site_release_at, PAST);

  const decision = decideSiteProtection(merged, AFTER);
  assert.equal(decision.site, true);
  assert.equal(decision.release, null);
});

test("a linha exata ainda ganha quando chega depois do residual", () => {
  const merged = mergeTenantSettingRows([
    { tenantId: "", key: "site_release_enabled", value: "0" },
    { tenantId: null, key: "site_release_enabled", value: "0" },
    { tenantId: "tenant_loja1", key: "site_release_enabled", value: "1" },
    { tenantId: "tenant_loja1", key: "site_password", value: "segredo" },
    { tenantId: "tenant_loja1", key: "site_release_at", value: PAST },
  ], "tenant_loja1");

  assert.equal(merged.site_release_enabled, "1");
  const decision = decideSiteProtection(merged, AFTER);
  assert.equal(decision.site, false);
  assert.equal(decision.release, null);
});

test("sem linha exata o residual da loja 1 continua valendo", () => {
  const merged = mergeTenantSettingRows([
    { tenantId: "", key: "site_password", value: "segredo" },
    { tenantId: null, key: "site_release_enabled", value: "0" },
  ], "tenant_loja1");

  assert.equal(merged.site_password, "segredo");
  assert.equal(merged.site_release_enabled, "0");
  assert.equal(decideSiteProtection(merged, AFTER).site, true);
});

test("empate entre residuais fica com a primeira linha", () => {
  const merged = mergeTenantSettingRows([
    { tenantId: null, key: "site_release_enabled", value: "0" },
    { tenantId: "", key: "site_release_enabled", value: "1" },
  ], "tenant_loja1");
  assert.equal(merged.site_release_enabled, "0");
});

test("filial não herda residual nem a linha da loja 1", () => {
  const merged = mergeTenantSettingRows([
    { tenantId: null, key: "site_release_enabled", value: "1" },
    { tenantId: "", key: "site_password", value: "loja-1" },
    { tenantId: "tenant_loja1", key: "site_release_enabled", value: "1" },
    { tenantId: "tenant_loja1", key: "site_release_at", value: PAST },
    { tenantId: "tenant_fh-imports", key: "site_password", value: "filial" },
    { tenantId: "tenant_fh-imports", key: "site_release_enabled", value: "0" },
  ], "tenant_fh-imports");

  assert.equal(merged.site_password, "filial");
  assert.equal(merged.site_release_enabled, "0");
  assert.equal(merged.site_release_at, undefined);
  assert.equal(decideSiteProtection(merged, AFTER).site, true);
});
