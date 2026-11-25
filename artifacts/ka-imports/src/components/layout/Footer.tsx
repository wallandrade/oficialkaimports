import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openSellerWhatsAppChat, prefetchActiveSellerWhatsApp } from "@/lib/utils";
import { fetchPublicSiteSettings } from "@/lib/public-settings";
import { fallbackSiteName } from "@/lib/store-host";
import { isMainStoreFromSettings, resolveStoreThemePreset } from "@/lib/store-theme-preset";
import { resolveStoreLogo } from "@/lib/store-logo";
import { StoreWordmark } from "@/components/layout/StoreWordmark";

function openWhatsApp(text: string) {
  openSellerWhatsAppChat(text, (message) => toast.error(message));
}

export function Footer() {
  const [siteSettings, setSiteSettings] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("siteSettings") || "{}"); } catch { return {}; }
  });

  useEffect(() => {
    void prefetchActiveSellerWhatsApp();
  }, []);

  useEffect(() => {
    fetchPublicSiteSettings()
      .then((data) => {
        if (!data) return;
        localStorage.setItem("siteSettings", JSON.stringify(data));
        setSiteSettings(data);
      })
      .catch(() => {});
  }, []);

  const siteName = String(siteSettings.site_name || "").trim() || fallbackSiteName(undefined, "upper");
  const isMainStore = isMainStoreFromSettings(siteSettings);
  const themePreset = resolveStoreThemePreset(String(siteSettings.store_theme_preset || ""), { settings: siteSettings });
  const branding = resolveStoreLogo(siteSettings, { onDark: themePreset === "editorial_noir" });

  return (
    <footer className="ka-main-footer bg-white border-t border-border mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              {isMainStore && branding.src ? (
                branding.isDefault ? (
                  <StoreWordmark src={branding.src} alt={siteName} variant="footer" />
                ) : (
                  <img src={branding.src} alt={siteName} className="h-auto max-h-12 w-auto max-w-[220px] object-contain" />
                )
              ) : (
                <span className="ka-footer-brand font-bold text-xl text-primary">{siteName}</span>
              )}
            </div>
            <p className="ka-footer-text text-muted-foreground text-sm">
              A sua loja de importados com os melhores preços e garantia de qualidade.
            </p>
          </div>

          <div>
            <h3 className="ka-footer-heading font-bold text-foreground mb-4">Links Úteis</h3>
            <ul className="ka-footer-links space-y-2 text-sm text-muted-foreground">
              <li><a href="/" className="ka-footer-link hover:text-primary transition-colors">Produtos</a></li>
              <li>
                <button
                  type="button"
                  onClick={() => openWhatsApp("Olá, gostaria de suporte.")}
                  className="ka-footer-link hover:text-primary transition-colors"
                >
                  Suporte
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="ka-footer-heading font-bold text-foreground mb-4">Atendimento</h3>
            <p className="ka-footer-text text-muted-foreground text-sm mb-4">
              Precisa de ajuda? Fale com nosso suporte diretamente pelo WhatsApp.
            </p>
            <Button
              type="button"
              variant="outline"
              className="ka-footer-whatsapp w-full border-green-500 text-green-600 hover:bg-green-50 hover:border-green-600"
              onClick={() => openWhatsApp("Olá, gostaria de tirar uma dúvida.")}
            >
              <MessageCircle className="w-5 h-5 mr-2" />
              Suporte via WhatsApp
            </Button>
          </div>
        </div>

        <div className="ka-footer-copyright mt-12 pt-8 border-t border-border text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} {siteName} - Todos os direitos reservados</p>
        </div>
      </div>
    </footer>
  );
}
