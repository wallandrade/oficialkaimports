import { useEffect, useState } from "react";
import { fetchPublicSiteSettings } from "@/lib/public-settings";

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

function readCachedStoreThemePreset(): StoreThemePreset {
  try {
    const raw = JSON.parse(localStorage.getItem("siteSettings") || "{}") as Record<string, string>;
    return normalizeStoreThemePreset(String(raw.store_theme_preset || ""));
  } catch {
    return "default";
  }
}

export function useStoreThemePreset(): StoreThemePreset {
  const [preset, setPreset] = useState<StoreThemePreset>(readCachedStoreThemePreset);

  useEffect(() => {
    let active = true;
    fetchPublicSiteSettings()
      .then((data) => {
        if (!active || !data) return;
        setPreset(normalizeStoreThemePreset(String(data.store_theme_preset || "")));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return preset;
}
