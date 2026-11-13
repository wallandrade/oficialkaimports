import { currentHostname, isKaImportsStoreHost } from "./store-host";

export type StoreThemePreset = "default" | "classic_clean" | "editorial_noir" | "market_showcase" | "pharma_compact";

export const MAIN_STORE_TENANT_ID = "tenant_loja1";
export const DEFAULT_STORE_THEME_PRESET: StoreThemePreset = "default";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

export function normalizeStoreThemePreset(value: string): StoreThemePreset {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "classic_clean") return "classic_clean";
  if (normalized === "editorial_noir") return "editorial_noir";
  if (normalized === "market_showcase") return "market_showcase";
  if (normalized === "pharma_compact") return "pharma_compact";
  return DEFAULT_STORE_THEME_PRESET;
}

export function isPharmaCompactPreset(value: string): boolean {
  return normalizeStoreThemePreset(value) === "pharma_compact";
}

/**
 * Loja principal vem da API (`is_main_store` ou `tenant_id`).
 * Sem esses campos, só ka-imports.com e www.ka-imports.com contam.
 */
export function isMainStoreFromSettings(
  settings: Record<string, string | undefined> | null | undefined,
  hostname = currentHostname(),
): boolean {
  const flag = String(settings?.is_main_store ?? "").trim().toLowerCase();
  if (TRUTHY.has(flag)) return true;
  if (FALSY.has(flag)) return false;

  const tenantId = String(settings?.tenant_id ?? "").trim();
  if (tenantId) return tenantId === MAIN_STORE_TENANT_ID;

  return isKaImportsStoreHost(hostname);
}

/** Preset ausente, inválido ou `pharma_compact` fora da loja 1 vira o tema padrão. */
export function resolveStoreThemePreset(
  value: string,
  options?: {
    isMainStore?: boolean;
    hostname?: string;
    settings?: Record<string, string | undefined> | null;
  },
): StoreThemePreset {
  const isMainStore = options?.isMainStore
    ?? isMainStoreFromSettings(options?.settings, options?.hostname ?? currentHostname());
  const preset = normalizeStoreThemePreset(value);
  if (preset === "pharma_compact" && !isMainStore) return DEFAULT_STORE_THEME_PRESET;
  return preset;
}
