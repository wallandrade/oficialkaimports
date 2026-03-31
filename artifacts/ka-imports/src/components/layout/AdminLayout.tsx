import { ReactNode } from "react";
import { Link } from "wouter";
import { ShieldCheck, ExternalLink } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Admin header */}
      <header className="sticky top-0 z-40 bg-white border-b border-border/60 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-foreground text-sm">KA Imports</span>
            <span className="text-muted-foreground text-xs">·</span>
            <span className="text-primary text-xs font-semibold">Painel Admin</span>
          </div>
          <div className="ml-auto">
            <Link
              href={`${BASE}/`}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-3 py-1.5 rounded-lg hover:bg-muted/60"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Ver loja
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex flex-col">{children}</main>

      {/* Admin footer */}
      <footer className="bg-white border-t border-border/50 py-3">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} KA Imports &middot; Painel Administrativo &middot; Área restrita
        </div>
      </footer>
    </div>
  );
}
