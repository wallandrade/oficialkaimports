import { useState, useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SESSION_KEY = "ka_site_unlocked";
const PAYMENT_SESSION_KEY = "ka_payment_unlocked";

interface IsProtectedResponse {
  site: boolean;
  payment: boolean;
}

async function checkIsProtected(): Promise<IsProtectedResponse> {
  try {
    const r = await fetch(`${BASE}/api/is-protected`);
    return await r.json() as IsProtectedResponse;
  } catch {
    return { site: false, payment: false };
  }
}

async function verifyPassword(type: "site" | "payment", password: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/verify-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, password }),
    });
    const data = await r.json() as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}

function PasswordScreen({
  title,
  subtitle,
  onVerify,
}: {
  title: string;
  subtitle: string;
  onVerify: (pw: string) => Promise<boolean>;
}) {
  const [input, setInput] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    const ok = await onVerify(input);
    setLoading(false);
    if (!ok) {
      setError(true);
      setInput("");
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-white text-2xl font-bold">{title}</h1>
          <p className="text-slate-400 text-sm mt-1 text-center">{subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur rounded-2xl p-6 space-y-4">
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Digite a senha de acesso"
              autoFocus
              className={`w-full h-12 px-4 pr-12 rounded-xl bg-white/10 border-2 text-white placeholder:text-slate-400 outline-none transition-colors ${
                error ? "border-red-500" : "border-white/20 focus:border-primary"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm text-center">Senha incorreta. Tente novamente.</p>}
          <Button type="submit" className="w-full h-12" disabled={!input.trim() || loading}>
            {loading ? "Verificando..." : "Acessar"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// Paths that should NEVER be blocked by the site password gate.
// These are customer-facing payment flows — customers cannot know the admin password.
const PAYMENT_PATHS = ["/checkout", "/pix/", "/pix", "/success", "/pagamento", "/payment-link"];
function isPaymentPath(location: string) {
  return PAYMENT_PATHS.some((p) => location === p || location.startsWith(p + "/") || location.startsWith(p + "?"));
}

export function SitePasswordGate({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const isAdminPath   = location.startsWith("/admin");
  const isKycPath     = location.startsWith("/kyc");
  const isPmtPath     = isPaymentPath(location);
  const isExemptPath  = isAdminPath || isKycPath || isPmtPath;

  // Read sessionStorage synchronously so authenticated users see content immediately
  // (no race condition where form appears then password screen replaces it mid-session)
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (isExemptPath) return true;
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
  });
  const [protected_, setProtected] = useState<boolean | null>(null);

  useEffect(() => {
    if (isExemptPath || unlocked) { setProtected(false); return; }
    checkIsProtected().then((r) => setProtected(r.site));
  }, [isExemptPath, unlocked]);

  // Already unlocked or exempt — render immediately without any flash
  if (unlocked || isExemptPath) return <>{children}</>;

  // Still waiting for protection check — show minimal loader so we never flash
  // the children before knowing if a password is required.
  if (protected_ === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Site not protected
  if (!protected_) return <>{children}</>;

  // Site is protected and user is not yet unlocked
  return (
    <PasswordScreen
      title="Acesso Restrito"
      subtitle="Esta loja está com acesso por senha. Insira a senha para continuar."
      onVerify={async (pw) => {
        const ok = await verifyPassword("site", pw);
        if (ok) {
          sessionStorage.setItem(SESSION_KEY, "1");
          setUnlocked(true);
        }
        return ok;
      }}
    />
  );
}

export function PaymentPasswordGate({ children }: { children: ReactNode }) {
  // Read sessionStorage synchronously — same fix as SitePasswordGate
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try { return sessionStorage.getItem(PAYMENT_SESSION_KEY) === "1"; } catch { return false; }
  });
  const [protected_, setProtected] = useState<boolean | null>(null);

  useEffect(() => {
    if (unlocked) { setProtected(true); return; }
    checkIsProtected().then((r) => setProtected(r.payment));
  }, [unlocked]);

  // Already unlocked — render immediately
  if (unlocked) return <>{children}</>;

  // Still waiting for protection check — show minimal loader
  if (protected_ === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not protected
  if (!protected_) return <>{children}</>;

  return (
    <PasswordScreen
      title="Link de Pagamento"
      subtitle="Digite a senha para acessar a página de pagamento."
      onVerify={async (pw) => {
        const ok = await verifyPassword("payment", pw);
        if (ok) {
          sessionStorage.setItem(PAYMENT_SESSION_KEY, "1");
          setUnlocked(true);
        }
        return ok;
      }}
    />
  );
}
