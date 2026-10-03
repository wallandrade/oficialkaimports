import { FormEvent, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveCustomerToken } from "@/lib/customer-auth";
import { getStoredReferralCode } from "@/lib/affiliate";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AuthMode = "login" | "register";

function formatCPF(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function PharmaLoginDialog({
  open,
  onClose,
  onAuthenticated,
}: {
  open: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [document, setDocument] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("Preencha e-mail e senha.");
      return;
    }
    if (mode === "register" && !name.trim()) {
      toast.error("Preencha seu nome para criar a conta.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      toast.error("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    const documentDigits = document.replace(/\D/g, "");
    if (documentDigits && documentDigits.length !== 11) {
      toast.error("Informe um CPF válido ou deixe em branco.");
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const affiliateCode = getStoredReferralCode();
      const payload = mode === "login"
        ? { email: email.trim(), password, document: documentDigits || undefined }
        : {
          name: name.trim(),
          email: email.trim(),
          password,
          document: documentDigits || undefined,
          affiliateCode: affiliateCode || undefined,
        };
      const res = await fetch(`${BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data: { token?: string; message?: string } = {};
      try {
        data = (await res.json()) as { token?: string; message?: string };
      } catch {
        toast.error("Serviço indisponível no momento. Tente novamente em segundos.");
        return;
      }
      if (!res.ok || !data.token) {
        toast.error(data.message || "Não foi possível autenticar.");
        return;
      }
      saveCustomerToken(data.token);
      toast.success(mode === "login" ? "Login realizado com sucesso!" : "Conta criada com sucesso!");
      onAuthenticated();
      onClose();
    } catch {
      toast.error("Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-24" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-neutral-900">{mode === "login" ? "Entrar" : "Criar conta"}</h2>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-neutral-700">Nome</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Seu nome"
                className="h-11 w-full rounded-xl border-0 bg-neutral-100 px-3 text-sm outline-none"
              />
            </label>
          ) : null}
          <label className="block space-y-1">
            <span className="text-sm font-medium text-neutral-700">E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@email.com"
              autoComplete="email"
              className="h-11 w-full rounded-xl border-0 bg-neutral-100 px-3 text-sm outline-none"
            />
          </label>
          {mode === "register" ? (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-neutral-700">CPF <span className="font-normal text-neutral-400">(opcional)</span></span>
              <input
                type="text"
                inputMode="numeric"
                value={document}
                onChange={(event) => setDocument(formatCPF(event.target.value))}
                placeholder="000.000.000-00"
                autoComplete="off"
                className="h-11 w-full rounded-xl border-0 bg-neutral-100 px-3 text-sm outline-none"
              />
            </label>
          ) : null}
          <label className="block space-y-1">
            <span className="text-sm font-medium text-neutral-700">Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="h-11 w-full rounded-xl border-0 bg-neutral-100 px-3 text-sm outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-neutral-950 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>
        <button
          type="button"
          className="mt-4 flex min-h-11 w-full items-center justify-center px-2 text-center text-sm text-neutral-500"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMode((current) => (current === "login" ? "register" : "login"));
          }}
        >
          {mode === "login" ? "Esqueci ou ainda não tenho senha" : "Já tenho conta"}
        </button>
      </div>
    </div>
  );
}
