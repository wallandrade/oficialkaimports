import assert from "node:assert/strict";
import test from "node:test";

import { isMainStoreFromSettings, resolveStoreThemePreset } from "./store-theme-preset.ts";

test("filial sem preset usa o tema padrão", () => {
  assert.equal(
    resolveStoreThemePreset("", {
      settings: { is_main_store: "0", tenant_id: "tenant_fh-imports" },
      hostname: "www.fh-imports.site",
    }),
    "default",
  );
});

test("filial não aplica pharma_compact nem preset inválido", () => {
  const settings = { is_main_store: "0", tenant_id: "tenant_fh-imports" };
  assert.equal(resolveStoreThemePreset("pharma_compact", { settings, hostname: "www.fh-imports.site" }), "default");
  assert.equal(resolveStoreThemePreset("PHARMA_COMPACT", { settings }), "default");
  assert.equal(resolveStoreThemePreset("tema-inexistente", { settings }), "default");
  assert.equal(resolveStoreThemePreset("classic_clean", { settings }), "classic_clean");
});

test("loja 1 mantém pharma_compact", () => {
  assert.equal(
    resolveStoreThemePreset("pharma_compact", {
      settings: { is_main_store: "1", tenant_id: "tenant_loja1" },
      hostname: "www.ka-imports.com",
    }),
    "pharma_compact",
  );
});

test("sem sinal da API, só o domínio da loja principal libera o tema compacto", () => {
  assert.equal(resolveStoreThemePreset("pharma_compact", { hostname: "ka-imports.com" }), "pharma_compact");
  assert.equal(resolveStoreThemePreset("pharma_compact", { hostname: "www.ka-imports.com" }), "pharma_compact");
  assert.equal(resolveStoreThemePreset("pharma_compact", { hostname: "www.fh-imports.site" }), "default");
  assert.equal(resolveStoreThemePreset("pharma_compact", { hostname: "localhost" }), "default");
  assert.equal(resolveStoreThemePreset("pharma_compact", { hostname: "preview.vercel.app" }), "default");
});

test("is_main_store e tenant_id vencem o hostname", () => {
  assert.equal(isMainStoreFromSettings({ is_main_store: "0" }, "ka-imports.com"), false);
  assert.equal(isMainStoreFromSettings({ is_main_store: "1" }, "www.fh-imports.site"), true);
  assert.equal(isMainStoreFromSettings({ tenant_id: "tenant_fh-imports" }, "ka-imports.com"), false);
  assert.equal(isMainStoreFromSettings({ tenant_id: "tenant_loja1" }, "localhost"), true);
});
