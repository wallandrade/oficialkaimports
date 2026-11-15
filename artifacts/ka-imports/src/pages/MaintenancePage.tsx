import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/BrandLoader";
import { StoreWordmark } from "@/components/layout/StoreWordmark";
import { fallbackSiteName } from "@/lib/store-host";
import { resolveStoreLogo } from "@/lib/store-logo";

type CachedBranding = {
  siteName: string;
  logo: string;
  isDefault: boolean;
};

function readCachedBranding(): CachedBranding {
  try {
    const parsed = JSON.parse(localStorage.getItem("siteSettings") || "{}") as Record<string, string>;
    const siteName = String(parsed?.site_name ?? "").trim() || fallbackSiteName();
    const branding = resolveStoreLogo(parsed);
    return { siteName, logo: branding.src || "", isDefault: branding.isDefault };
  } catch {
    return { siteName: fallbackSiteName(), logo: "", isDefault: false };
  }
}

export function MaintenancePage() {
  const [{ siteName, logo, isDefault }] = useState(readCachedBranding);

  useEffect(() => {
    document.title = `${siteName} — Manutenção`;
  }, [siteName]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        {logo && isDefault ? (
          <StoreWordmark src={logo} alt={siteName} variant="maintenance" />
        ) : logo ? (
          <img
            src={logo}
            alt={siteName}
            className="max-h-16 w-auto max-w-[240px] object-contain"
          />
        ) : (
          <BrandLoader size="lg" label={siteName} />
        )}
        <p className="text-sm font-semibold tracking-wide text-muted-foreground">{siteName}</p>
        <div className="w-full rounded-xl border bg-card p-8 text-card-foreground shadow">
          <h1 className="text-2xl font-bold text-foreground">Estamos em manutenção</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Estamos em manutenção. Voltamos em breve! Obrigado pela paciência.
          </p>
        </div>
      </div>
    </div>
  );
}

export default MaintenancePage;
