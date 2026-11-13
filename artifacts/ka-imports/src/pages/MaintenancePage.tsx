import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/BrandLoader";
import { fallbackSiteName } from "@/lib/store-host";

type CachedBranding = {
  siteName: string;
  logo: string;
};

function readCachedBranding(): CachedBranding {
  try {
    const parsed = JSON.parse(localStorage.getItem("siteSettings") || "{}") as {
      site_name?: unknown;
      logo?: unknown;
    };
    const siteName = String(parsed?.site_name ?? "").trim() || fallbackSiteName();
    const logo = String(parsed?.logo ?? "").trim();
    return { siteName, logo };
  } catch {
    return { siteName: fallbackSiteName(), logo: "" };
  }
}

export function MaintenancePage() {
  const [{ siteName, logo }] = useState(readCachedBranding);

  useEffect(() => {
    document.title = `${siteName} — Manutenção`;
  }, [siteName]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        {logo ? (
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
