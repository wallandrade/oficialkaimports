import assert from "node:assert/strict";
import test from "node:test";

import {
  isPharmaCompactForbidden,
  publicStoreIdentity,
  publicStoreThemePreset,
  storeThemePresetWriteError,
} from "./store-theme-preset.ts";

test("filial sem preset público recebe default e não é a loja principal", () => {
  assert.equal(publicStoreThemePreset("tenant_fh-imports", undefined), "default");
  assert.equal(publicStoreThemePreset("tenant_fh-imports", ""), "default");
  assert.equal(publicStoreThemePreset("tenant_fh-imports", "pharma_compact"), "default");
  assert.equal(publicStoreThemePreset("tenant_fh-imports", "nao-existe"), "default");
  assert.equal(publicStoreThemePreset("tenant_fh-imports", "market_showcase"), "market_showcase");
  assert.deepEqual(publicStoreIdentity("tenant_fh-imports"), {
    tenant_id: "tenant_fh-imports",
    is_main_store: "0",
  });
});

test("loja 1 mantém pharma_compact e omite preset vazio", () => {
  assert.equal(publicStoreThemePreset("tenant_loja1", "pharma_compact"), "pharma_compact");
  assert.equal(publicStoreThemePreset("tenant_loja1", "  Pharma_Compact "), "pharma_compact");
  assert.equal(publicStoreThemePreset("tenant_loja1", undefined), undefined);
  assert.equal(publicStoreThemePreset("tenant_loja1", "lixo"), undefined);
  assert.deepEqual(publicStoreIdentity("tenant_loja1"), {
    tenant_id: "tenant_loja1",
    is_main_store: "1",
  });
});

test("gravar pharma_compact na filial é recusado; na loja 1 passa", () => {
  assert.equal(isPharmaCompactForbidden("tenant_fh-imports", "pharma_compact"), true);
  assert.equal(
    storeThemePresetWriteError("tenant_fh-imports", "pharma_compact"),
    "Este tema não está disponível para filiais.",
  );
  assert.equal(storeThemePresetWriteError("tenant_loja1", "pharma_compact"), null);
  assert.equal(storeThemePresetWriteError("tenant_fh-imports", "classic_clean"), null);
  assert.equal(storeThemePresetWriteError("tenant_fh-imports", ""), null);
  assert.equal(storeThemePresetWriteError("tenant_fh-imports", "tema-x"), "Tema inválido.");
});
