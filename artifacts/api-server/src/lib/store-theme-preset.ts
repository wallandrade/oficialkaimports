/** Igual a `DEFAULT_TENANT_ID` em `tenant-context.ts`. Não importar aquele módulo: ele abre o MySQL. */
export const MAIN_STORE_TENANT_ID = "tenant_loja1";
export const PHARMA_COMPACT_PRESET = "pharma_compact";
export const DEFAULT_STORE_THEME_PRESET = "default";

const STORE_THEME_PRESETS = new Set([
  "default",
  "classic_clean",
  "editorial_noir",
  "market_showcase",
  PHARMA_COMPACT_PRESET,
]);

export function isMainStoreTenant(tenantId: string): boolean {
  return String(tenantId || "").trim() === MAIN_STORE_TENANT_ID;
}

export function isPharmaCompactForbidden(tenantId: string, value: string | undefined): boolean {
  return !isMainStoreTenant(tenantId)
    && String(value || "").trim().toLowerCase() === PHARMA_COMPACT_PRESET;
}

/** null = valor vazio (apagar). string = erro para o cliente. */
export function storeThemePresetWriteError(tenantId: string, value: string | undefined): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!STORE_THEME_PRESETS.has(normalized)) return "Tema inválido.";
  if (isPharmaCompactForbidden(tenantId, normalized)) return "Este tema não está disponível para filiais.";
  return null;
}

/**
 * Preset público já saneado.
 * Filial sem valor, com valor inválido ou com `pharma_compact` recebe `default`.
 * Loja 1 sem valor válido omite a chave (undefined).
 */
export function publicStoreThemePreset(tenantId: string, value: string | undefined): string | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (STORE_THEME_PRESETS.has(normalized) && !isPharmaCompactForbidden(tenantId, normalized)) {
    return normalized;
  }
  if (!isMainStoreTenant(tenantId)) return DEFAULT_STORE_THEME_PRESET;
  return undefined;
}

export function publicStoreIdentity(tenantId: string): { tenant_id: string; is_main_store: "0" | "1" } {
  const id = String(tenantId || "").trim();
  return {
    tenant_id: id,
    is_main_store: isMainStoreTenant(id) ? "1" : "0",
  };
}
