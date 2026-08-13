import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

type Config = {
  configured: boolean;
  tokenMasked: string | null;
  email: string;
  originCep: string;
  carriers: string[];
  defaults: { weightKg: number; lengthCm: number; heightCm: number; widthCm: number };
};

export function EnvioEcomSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [suggestedUrl, setSuggestedUrl] = useState("");
  const [form, setForm] = useState({
    token: "",
    email: "",
    password: "",
    originCep: "",
    carriers: "",
    defaultWeight: "0.3",
    defaultLength: "20",
    defaultHeight: "10",
    defaultWidth: "15",
  });

  async function load() {
    setLoading(true);
    try {
      const [configRes, webhookRes] = await Promise.all([
        fetch(`${BASE}/api/admin/envioecom/config`, { headers: adminHeaders() }),
        fetch(`${BASE}/api/admin/envioecom/webhook`, { headers: adminHeaders() }),
      ]);
      if (configRes.ok) {
        const data = await configRes.json() as Config;
        setConfig(data);
        setForm((current) => ({
          ...current,
          email: data.email || "",
          originCep: data.originCep || "",
          carriers: (data.carriers || []).join(", "),
          defaultWeight: String(data.defaults?.weightKg ?? 0.3),
          defaultLength: String(data.defaults?.lengthCm ?? 20),
          defaultHeight: String(data.defaults?.heightCm ?? 10),
          defaultWidth: String(data.defaults?.widthCm ?? 15),
        }));
      }
      if (webhookRes.ok) {
        const data = await webhookRes.json() as { url?: string | null; suggestedUrl?: string };
        setWebhookUrl(data.url || null);
        setSuggestedUrl(data.suggestedUrl || "");
      }
    } catch {
      toast.error("Não foi possível carregar a configuração EnvioEcom.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        email: form.email,
        originCep: form.originCep,
        carriers: form.carriers,
        defaultWeight: form.defaultWeight,
        defaultLength: form.defaultLength,
        defaultHeight: form.defaultHeight,
        defaultWidth: form.defaultWidth,
      };
      if (form.token.trim()) payload.token = form.token.trim();
      if (form.password.trim()) payload.password = form.password.trim();
      const res = await fetch(`${BASE}/api/admin/envioecom/config`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Falha ao salvar.");
      toast.success("Configuração EnvioEcom salva.");
      setForm((current) => ({ ...current, token: "", password: "" }));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function registerWebhook() {
    setRegistering(true);
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/webhook`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ url: suggestedUrl }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string; url?: string };
      if (!res.ok) throw new Error(data.message || "Falha ao registrar webhook.");
      setWebhookUrl(data.url || suggestedUrl);
      toast.success("Webhook EnvioEcom registrado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no webhook.");
    } finally {
      setRegistering(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando EnvioEcom...</p>;
  }

  return (
    <div className="rounded-xl border bg-emerald-50/70 border-emerald-200 p-5 space-y-4">
      <div>
        <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">EnvioEcom</p>
        <p className="text-sm text-emerald-800/80">
          Conta desta loja. Token permanente ou e-mail+senha. CEP de origem é obrigatório no create.
        </p>
        <p className="text-xs mt-1">{config?.configured ? "Configurado" : "Não configurado"}{config?.tokenMasked ? ` · token ${config.tokenMasked}` : ""}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Token permanente" value={form.token} onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="E-mail (se não houver token)" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        <input type="password" className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Senha (só se for alterar)" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="CEP origem (8 dígitos)" value={form.originCep} onChange={(e) => setForm((f) => ({ ...f, originCep: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm sm:col-span-2" placeholder="Transportadoras (CSV opcional)" value={form.carriers} onChange={(e) => setForm((f) => ({ ...f, carriers: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Peso kg" value={form.defaultWeight} onChange={(e) => setForm((f) => ({ ...f, defaultWeight: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Comp. cm" value={form.defaultLength} onChange={(e) => setForm((f) => ({ ...f, defaultLength: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Alt. cm" value={form.defaultHeight} onChange={(e) => setForm((f) => ({ ...f, defaultHeight: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Larg. cm" value={form.defaultWidth} onChange={(e) => setForm((f) => ({ ...f, defaultWidth: e.target.value }))} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar EnvioEcom
        </Button>
        <Button variant="outline" onClick={() => void registerWebhook()} disabled={registering || !suggestedUrl}>
          {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Registrar webhook
        </Button>
      </div>
      <p className="text-xs text-emerald-900/80 break-all">Webhook: {webhookUrl || "não registrado"} {suggestedUrl ? `· sugerido ${suggestedUrl}` : ""}</p>
    </div>
  );
}
