import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SESSION_KEY = "ka_site_unlocked";
const PAYMENT_SESSION_KEY = "ka_payment_unlocked";

interface SiteReleaseInfo {
  message: string;
  releaseAt: string;
  serverNow: string;
}

interface IsProtectedResponse {
  site: boolean;
  payment: boolean;
  release?: SiteReleaseInfo | null;
}

const RELEASE_COUNTDOWN_CSS = `
@keyframes ka-release-flip {
  0% { transform: translateY(42%) rotateX(-68deg); opacity: 0; filter: blur(1px); }
  100% { transform: translateY(0) rotateX(0deg); opacity: 1; filter: none; }
}
.ka-release-digit {
  display: block;
  animation: ka-release-flip 0.32s cubic-bezier(0.22, 0.8, 0.3, 1);
  transform-origin: center bottom;
}
@media (prefers-reduced-motion: reduce) {
  .ka-release-digit { animation: none; }
}
`;

const releaseCardStyle: CSSProperties = {
  background: "linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 24%, rgba(255,255,255,0.12)), rgba(255,255,255,0.05))",
  border: "1px solid color-mix(in srgb, var(--color-primary) 46%, rgba(255,255,255,0.32))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.34), 0 16px 34px rgba(0,0,0,0.28)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
};

const releaseDigitStyle: CSSProperties = {
  color: "color-mix(in srgb, var(--color-primary) 20%, white)",
  textShadow: "0 0 22px color-mix(in srgb, var(--color-primary) 70%, transparent)",
};

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProtection(): Promise<IsProtectedResponse | null> {
  try {
    return await fetchJsonWithTimeout<IsProtectedResponse>(`${BASE}/api/is-protected`, { cache: "no-store" });
  } catch {
    return null;
  }
}

async function checkIsProtected(): Promise<IsProtectedResponse> {
  return await fetchProtection() ?? { site: false, payment: false };
}

async function verifyPassword(type: "site" | "payment", password: string): Promise<boolean> {
  try {
    const data = await fetchJsonWithTimeout<{ ok: boolean }>(`${BASE}/api/verify-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, password }),
    });
    return data.ok;
  } catch {
    return false;
  }
}

function initialCountdownMs(release: SiteReleaseInfo): number {
  const releaseMs = Date.parse(release.releaseAt);
  const serverMs = Date.parse(release.serverNow);
  if (!Number.isFinite(releaseMs) || !Number.isFinite(serverMs)) return 0;
  return Math.max(0, releaseMs - serverMs);
}

function splitCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function CountdownCard({ value, label }: { value: number; label: string }) {
  const text = String(value).padStart(2, "0");
  return (
    <div
      className="flex min-w-0 flex-col items-center justify-center rounded-2xl px-1.5 py-3 sm:px-3 sm:py-4"
      style={releaseCardStyle}
      aria-hidden="true"
    >
      <span
        key={text}
        className="ka-release-digit font-display text-[1.75rem] font-semibold leading-none tabular-nums min-[380px]:text-4xl sm:text-5xl"
        style={releaseDigitStyle}
      >
        {text}
      </span>
      <span className="mt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-300 sm:text-xs">
        {label}
      </span>
    </div>
  );
}

function ReleaseCountdown({
  release,
  onElapsed,
}: {
  release: SiteReleaseInfo;
  onElapsed: () => Promise<boolean>;
}) {
  const signature = `${release.releaseAt}|${release.serverNow}`;
  const [seenSignature, setSeenSignature] = useState(signature);
  const [remaining, setRemaining] = useState(() => initialCountdownMs(release));
  const asked = useRef(false);
  const retryTimer = useRef(0);
  if (seenSignature !== signature) {
    setSeenSignature(signature);
    setRemaining(initialCountdownMs(release));
  }

  useEffect(() => {
    const releaseMs = Date.parse(release.releaseAt);
    const serverMs = Date.parse(release.serverNow);
    if (!Number.isFinite(releaseMs) || !Number.isFinite(serverMs)) return;
    const monoStart = performance.now();
    const initialLeft = releaseMs - serverMs;
    asked.current = false;

    const tick = () => {
      const left = initialLeft - (performance.now() - monoStart);
      const next = Math.max(0, left);
      setRemaining((prev) => {
        if (next === 0) return prev === 0 ? prev : 0;
        if (Math.floor(prev / 1000) === Math.floor(next / 1000)) return prev;
        return next;
      });
      if (left <= 0 && !asked.current) {
        asked.current = true;
        void onElapsed().then((stillLocked) => {
          if (!stillLocked) return;
          retryTimer.current = window.setTimeout(() => {
            asked.current = false;
          }, 2000);
        });
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(retryTimer.current);
    };
  }, [release.releaseAt, release.serverNow, onElapsed]);

  const parts = splitCountdown(remaining);
  const spoken = `${release.message}: ${parts.days} dias, ${parts.hours} horas, ${parts.minutes} minutos e ${parts.seconds} segundos`;

  return (
    <div className="mb-6" role="timer" aria-label={spoken}>
      <style>{RELEASE_COUNTDOWN_CSS}</style>
      <p className="mb-3 text-center text-base font-medium text-white sm:text-lg">{release.message}</p>
      <div className="grid grid-cols-2 gap-2.5 min-[420px]:grid-cols-4">
        <CountdownCard value={parts.days} label="Dias" />
        <CountdownCard value={parts.hours} label="Horas" />
        <CountdownCard value={parts.minutes} label="Minutos" />
        <CountdownCard value={parts.seconds} label="Segundos" />
      </div>
    </div>
  );
}

function PasswordScreen({
  title,
  subtitle,
  onVerify,
  release,
  onReleaseElapsed,
}: {
  title: string;
  subtitle: string;
  onVerify: (pw: string) => Promise<boolean>;
  release?: SiteReleaseInfo | null;
  onReleaseElapsed?: () => Promise<boolean>;
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
    <div className="flex min-h-dvh flex-col items-center justify-center overflow-y-auto bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/20">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="mt-1 text-center text-sm text-slate-400">{subtitle}</p>
        </div>

        {release && onReleaseElapsed ? (
          <ReleaseCountdown release={release} onElapsed={onReleaseElapsed} />
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white/10 p-6 backdrop-blur">
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Digite a senha de acesso"
              autoFocus
              className={`h-12 w-full rounded-xl border-2 bg-white/10 px-4 pr-12 text-white outline-none transition-colors placeholder:text-slate-400 ${
                error ? "border-red-500" : "border-white/20 focus:border-primary"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              aria-label={showPw ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          {error ? <p className="text-center text-sm text-red-400">Senha incorreta. Tente novamente.</p> : null}
          <Button type="submit" className="h-12 w-full" disabled={!input.trim() || loading}>
            {loading ? "Verificando..." : "Acessar"}
          </Button>
        </form>
      </div>
    </div>
  );
}

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

  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (isExemptPath) return true;
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
  });
  const [protected_, setProtected] = useState<boolean | null>(null);
  const [release, setRelease] = useState<SiteReleaseInfo | null>(null);

  const handleReleaseElapsed = useCallback(async () => {
    const data = await fetchProtection();
    if (!data) return true;
    setProtected(data.site);
    setRelease(data.site && data.release ? data.release : null);
    return data.site;
  }, []);

  useEffect(() => {
    if (isExemptPath || unlocked) { setProtected(false); setRelease(null); return; }
    let cancelled = false;
    fetchProtection().then((data) => {
      if (cancelled) return;
      if (!data) {
        setProtected(false);
        setRelease(null);
        return;
      }
      setProtected(data.site);
      setRelease(data.site && data.release ? data.release : null);
    });
    return () => { cancelled = true; };
  }, [isExemptPath, unlocked]);

  if (unlocked || isExemptPath) return <>{children}</>;

  if (protected_ === null) return <>{children}</>;

  if (!protected_) return <>{children}</>;

  return (
    <PasswordScreen
      title="Acesso Restrito"
      subtitle="Esta loja está com acesso por senha. Insira a senha para continuar."
      release={release}
      onReleaseElapsed={handleReleaseElapsed}
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
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try { return sessionStorage.getItem(PAYMENT_SESSION_KEY) === "1"; } catch { return false; }
  });
  const [protected_, setProtected] = useState<boolean | null>(null);

  useEffect(() => {
    if (unlocked) { setProtected(true); return; }
    checkIsProtected().then((r) => setProtected(r.payment));
  }, [unlocked]);

  if (unlocked) return <>{children}</>;

  if (protected_ === null) return <>{children}</>;

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
