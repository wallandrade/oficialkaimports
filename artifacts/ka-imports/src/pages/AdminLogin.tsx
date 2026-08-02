import { useState, FormEvent, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Lock, User, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchPublicSiteSettings } from "@/lib/public-settings";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [siteSettings, setSiteSettings] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("siteSettings") || "{}"); } catch { return {}; }
  });

  useEffect(() => {
    fetchPublicSiteSettings()
      .then((data) => {
        if (!data) return;
        localStorage.setItem("siteSettings", JSON.stringify(data));
        setSiteSettings(data);
      })
      .catch(() => {});
  }, []);

  const siteName = String(siteSettings.site_name || "").trim() || "KA Imports";
  const logo = String(siteSettings.logo || "").trim();
  const logoScale = Math.min(240, Math.max(100, Number(siteSettings.logo_scale ?? 180) || 180));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      toast.error("Preencha usuário e senha.");
      return;
    }

    setLoading(true);
    try {
      const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
      const loginUrl = API_URL ? `${API_URL}/api/admin/login` : `${BASE}/api/admin/login`;

      const res = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json() as { token?: string; message?: string; tenantId?: string };

      if (!res.ok || !data.token) {
        toast.error(data.message || "Credenciais inválidas.");
        return;
      }

      sessionStorage.setItem("adminToken", data.token);
  if (data.tenantId) localStorage.setItem("adminTenantId", data.tenantId);
      localStorage.removeItem("adminToken");
      toast.success("Login realizado com sucesso!");
      setLocation("/admin");
    } catch {
      toast.error("Erro ao conectar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-primary/20 to-slate-900 flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", duration: 0.6 }}
        className="w-full max-w-md"
      >
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center min-h-20 bg-white rounded-2xl shadow-2xl shadow-primary/20 mb-4 border border-border/10 px-4 py-3">
            {logo ? (
              <div style={{ width: `${logoScale}px`, maxWidth: "50vw" }} className="flex items-center justify-center">
                <img src={logo} alt={siteName} className="max-h-16 w-full object-contain" />
              </div>
            ) : (
              <div className="w-20 h-20 flex items-center justify-center">
                <ShieldCheck className="w-10 h-10 text-primary" />
              </div>
            )}
          </div>
          <h1 className="text-3xl font-bold text-white">{siteName}</h1>
          <p className="text-slate-400 mt-1">Painel Administrativo</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl shadow-black/30 p-8">
          <h2 className="text-xl font-bold text-foreground mb-6 text-center">Entrar na sua conta</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground ml-1">Usuário</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Digite seu usuário"
                  autoComplete="username"
                  className="w-full h-12 pl-11 pr-4 rounded-xl border-2 border-border bg-muted/40 focus:bg-white focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none text-base transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground ml-1">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  className="w-full h-12 pl-11 pr-12 rounded-xl border-2 border-border bg-muted/40 focus:bg-white focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none text-base transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full text-base mt-2"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Entrando...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Entrar
                </span>
              )}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Área restrita — somente administradores autorizados.
          </p>
        </div>

        <p className="text-center text-slate-500 text-sm mt-6">
          <a href="/" className="hover:text-slate-300 transition-colors">← Voltar para a loja</a>
        </p>
      </motion.div>
    </div>
  );
}
