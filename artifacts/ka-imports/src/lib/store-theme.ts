export type StoreThemePreset = "default" | "classic_clean" | "editorial_noir" | "market_showcase" | "pharma_compact";

export function normalizeStoreThemePreset(value: string): StoreThemePreset {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "classic_clean") return "classic_clean";
  if (normalized === "editorial_noir") return "editorial_noir";
  if (normalized === "market_showcase") return "market_showcase";
  if (normalized === "pharma_compact") return "pharma_compact";
  return "default";
}

export function isPharmaCompactPreset(value: string): boolean {
  return normalizeStoreThemePreset(value) === "pharma_compact";
}
