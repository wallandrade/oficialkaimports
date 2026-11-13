import { useEffect, useState } from "react";
import { fetchPublicSiteSettings } from "@/lib/public-settings";
import { resolveStoreThemePreset, type StoreThemePreset } from "@/lib/store-theme-preset";

export type { StoreThemePreset };
export {
  isMainStoreFromSettings,
  isPharmaCompactPreset,
  normalizeStoreThemePreset,
  resolveStoreThemePreset,
} from "@/lib/store-theme-preset";

function readCachedStoreThemePreset(): StoreThemePreset {
  try {
    const raw = JSON.parse(localStorage.getItem("siteSettings") || "{}") as Record<string, string>;
    return resolveStoreThemePreset(String(raw.store_theme_preset || ""), { settings: raw });
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
        setPreset(resolveStoreThemePreset(String(data.store_theme_preset || ""), { settings: data }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return preset;
}
