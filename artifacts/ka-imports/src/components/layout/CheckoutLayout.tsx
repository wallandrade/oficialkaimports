import { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Footer } from "./Footer";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function useSiteLogo() {
  try {
    const cached = JSON.parse(localStorage.getItem("siteSettings") || "{}");
    return cached.logo ?? null;
  } catch {
    return null;
  }
}

export function CheckoutLayout({ children }: { children: ReactNode }) {
  const logo = useSiteLogo();
  const logoScale = (() => {
    try {
      const cached = JSON.parse(localStorage.getItem("siteSettings") || "{}");
      return Math.min(240, Math.max(100, Number(cached.logo_scale ?? 180) || 180));
    } catch {
      return 180;
    }
  })();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 w-full glass border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16 gap-4">
            <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">Voltar</span>
            </Link>
            <div className="flex-1 flex items-center justify-center gap-2">
              {logo && (
                <div
                  className="overflow-hidden rounded-2xl h-12 border border-primary/10 bg-white/80 px-3 py-1.5"
                  style={{ width: `${logoScale}px`, maxWidth: "48vw" }}
                >
                  <img src={logo} alt="KA Imports" className="h-full w-auto max-h-[48px] object-contain" />
                </div>
              )}
              <span className="font-display font-bold text-lg tracking-tight text-primary">KA IMPORTS</span>
            </div>
            <div className="w-16" />
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
      <Footer />
    </div>
  );
}
