import { FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Lock, Mail, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveCustomerToken } from "@/lib/customer-auth";
import { getStoredReferralCode } from "@/lib/affiliate";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AuthMode = "login" | "register";

type AuthResponse = {
  token?: string;
  message?: string;
};

export default function CustomerLogin() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      toast.error("Preencha e-mail e senha.");
      return;
    }

    if (mode === "register" && !name.trim()) {
      toast.error("Preencha seu nome para criar a conta.");
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const affiliateCode = getStoredReferralCode();
      const payload = mode === "login"
        ? { email: email.trim(), password }
        : { name: name.trim(), email: email.trim(), password, affiliateCode: affiliateCode || undefined };

      const res = await fetch(`${BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data: AuthResponse = {};
      try {
        data = (await res.json()) as AuthResponse;
      } catch {
        // Response was not JSON (e.g. server still deploying)
        toast.error("Serviço indisponível no momento. Tente novamente em segundos.");
        return;
      }

      if (!res.ok || !data.token) {
        toast.error(data.message || "Não foi possível autenticar.");
        return;
      }

      saveCustomerToken(data.token);
      toast.success(mode === "login" ? "Login realizado com sucesso!" : "Conta criada com sucesso!");
      setLocation("/minha-conta/pedidos");
    } catch {
      toast.error("Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white border border-border rounded-3xl shadow-xl p-7 sm:p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-foreground">Entrar na sua conta</h1>
          <p className="text-sm text-muted-foreground mt-1">Acompanhe seus pedidos com segurança.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-6 p-1 bg-muted rounded-xl">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`h-10 rounded-lg text-sm font-semibold transition-colors ${mode === "login" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`h-10 rounded-lg text-sm font-semibold transition-colors ${mode === "register" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Nome</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-input bg-white text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                autoComplete="email"
                className="w-full h-11 pl-9 pr-3 rounded-xl border border-input bg-white text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Senha</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="w-full h-11 pl-9 pr-3 rounded-xl border border-input bg-white text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary"
              />
            </div>
          </div>

          <Button type="submit" className="w-full h-11 rounded-xl" disabled={loading}>
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Processando...
              </span>
            ) : mode === "login" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <div className="text-center mt-6">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Voltar para a loja
          </Link>
        </div>
      </div>
    </div>
  );
}
