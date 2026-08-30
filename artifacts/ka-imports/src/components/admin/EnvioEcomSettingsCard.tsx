import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

type Account = {
  id: string;
  name: string;
  fromEnv: boolean;
  configured: boolean;
  tokenMasked: string | null;
  emailMasked: string | null;
  originCep: string;
};

type Defaults = { weightKg: number; lengthCm: number; heightCm: number; widthCm: number };

type AccountForm = {
  name: string;
  token: string;
  email: string;
  password: string;
  originCep: string;
};

const EMPTY_FORM: AccountForm = { name: "", token: "", email: "", password: "", originCep: "" };

export function EnvioEcomSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [suggestedUrl, setSuggestedUrl] = useState("");
  const [defaults, setDefaults] = useState({
    carriers: "",
    defaultWeight: "0.3",
    defaultLength: "17",
    defaultHeight: "2",
    defaultWidth: "12",
  });
  const [forms, setForms] = useState<Record<string, AccountForm>>({});
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState<AccountForm>(EMPTY_FORM);

  async function load() {
    setLoading(true);
    try {
      const [accountsRes, configRes, webhookRes] = await Promise.all([
        fetch(`${BASE}/api/admin/envioecom/accounts`, { headers: adminHeaders() }),
        fetch(`${BASE}/api/admin/envioecom/config`, { headers: adminHeaders() }),
        fetch(`${BASE}/api/admin/envioecom/webhook`, { headers: adminHeaders() }),
      ]);
      if (accountsRes.ok) {
        const data = await accountsRes.json() as { accounts?: Account[] };
        const list = data.accounts || [];
        setAccounts(list);
        setForms((current) => {
          const next: Record<string, AccountForm> = {};
          for (const account of list) {
            next[account.id] = current[account.id] || {
              name: account.name,
              token: "",
              email: "",
              password: "",
              originCep: account.originCep || "",
            };
          }
          return next;
        });
      }
      if (configRes.ok) {
        const data = await configRes.json() as { carriers?: string[]; defaults?: Defaults };
        setDefaults({
          carriers: (data.carriers || []).join(", "),
          defaultWeight: String(data.defaults?.weightKg ?? 0.3),
          defaultLength: String(data.defaults?.lengthCm ?? 17),
          defaultHeight: String(data.defaults?.heightCm ?? 2),
          defaultWidth: String(data.defaults?.widthCm ?? 12),
        });
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

  async function saveDefaults() {
    setSavingDefaults(true);
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/config`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({
          carriers: defaults.carriers,
          defaultWeight: defaults.defaultWeight,
          defaultLength: defaults.defaultLength,
          defaultHeight: defaults.defaultHeight,
          defaultWidth: defaults.defaultWidth,
        }),
      });
      if (!res.ok) throw new Error("Falha ao salvar.");
      toast.success("Caixa padrão e transportadoras salvas.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSavingDefaults(false);
    }
  }

  async function saveAccount(id: string) {
    const form = forms[id];
    if (!form) return;
    setSavingId(id);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        originCep: form.originCep,
      };
      if (form.token.trim()) payload.token = form.token.trim();
      if (form.email.trim()) payload.email = form.email.trim();
      if (form.password.trim()) payload.password = form.password.trim();
      const res = await fetch(`${BASE}/api/admin/envioecom/accounts/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Falha ao salvar a conta.");
      toast.success("Conta EnvioEcom salva.");
      setForms((current) => ({
        ...current,
        [id]: { ...form, token: "", password: "" },
      }));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar a conta.");
    } finally {
      setSavingId(null);
    }
  }

  async function createAccount() {
    setCreating(true);
    try {
      const payload: Record<string, unknown> = {
        name: newForm.name.trim() || undefined,
        originCep: newForm.originCep,
      };
      if (newForm.token.trim()) payload.token = newForm.token.trim();
      if (newForm.email.trim()) payload.email = newForm.email.trim();
      if (newForm.password.trim()) payload.password = newForm.password.trim();
      const res = await fetch(`${BASE}/api/admin/envioecom/accounts`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Falha ao criar a conta.");
      toast.success("Conta extra criada.");
      setNewForm(EMPTY_FORM);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar a conta.");
    } finally {
      setCreating(false);
    }
  }

  async function removeAccount(id: string) {
    if (!window.confirm("Apagar esta conta EnvioEcom?")) return;
    setSavingId(id);
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/accounts/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Falha ao apagar.");
      toast.success("Conta removida.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao apagar.");
    } finally {
      setSavingId(null);
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
      const data = await res.json().catch(() => ({})) as { message?: string; url?: string; registered?: number };
      if (!res.ok) throw new Error(data.message || "Falha ao registrar webhook.");
      setWebhookUrl(data.url || suggestedUrl);
      toast.success(data.registered && data.registered > 1
        ? `Webhook registrado em ${data.registered} contas.`
        : "Webhook EnvioEcom registrado.");
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
    <div className="rounded-xl border bg-emerald-50/70 border-emerald-200 p-5 space-y-5">
      <div>
        <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">EnvioEcom</p>
        <p className="text-sm text-emerald-800/80">
          Várias APIs por loja. Cada conta tem token ou e-mail+senha e o CEP de origem. A conta do servidor só muda no deploy.
        </p>
        <p className="text-xs mt-1">{accounts.length ? `${accounts.length} conta(s)` : "Nenhuma conta configurada"}</p>
      </div>

      <div className="space-y-3">
        {accounts.map((account) => {
          const form = forms[account.id] || { ...EMPTY_FORM, name: account.name, originCep: account.originCep };
          return (
            <div key={account.id} className="rounded-xl border border-emerald-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">{account.name}</p>
                  <p className="text-xs text-neutral-500">
                    {account.fromEnv ? "São Paulo · só leitura" : account.id === "tenant" ? "Conta da loja" : "Conta extra"}
                    {account.tokenMasked ? ` · token ${account.tokenMasked}` : ""}
                    {account.emailMasked ? ` · ${account.emailMasked}` : ""}
                  </p>
                </div>
                {!account.fromEnv && account.id !== "tenant" ? (
                  <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={savingId === account.id} onClick={() => void removeAccount(account.id)}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Apagar
                  </Button>
                ) : null}
              </div>
              {account.fromEnv ? (
                <p className="text-sm text-neutral-600">CEP origem: {account.originCep || "não informado no servidor"}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {account.id !== "tenant" ? (
                    <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Nome" value={form.name} onChange={(e) => setForms((f) => ({ ...f, [account.id]: { ...form, name: e.target.value } }))} />
                  ) : null}
                  <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Token permanente (em branco = manter)" value={form.token} onChange={(e) => setForms((f) => ({ ...f, [account.id]: { ...form, token: e.target.value } }))} />
                  <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="E-mail (em branco = manter)" value={form.email} onChange={(e) => setForms((f) => ({ ...f, [account.id]: { ...form, email: e.target.value } }))} />
                  <input type="password" className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Senha (só se for alterar)" value={form.password} onChange={(e) => setForms((f) => ({ ...f, [account.id]: { ...form, password: e.target.value } }))} />
                  <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="CEP origem (8 dígitos)" value={form.originCep} onChange={(e) => setForms((f) => ({ ...f, [account.id]: { ...form, originCep: e.target.value } }))} />
                  <div className="sm:col-span-2">
                    <Button size="sm" onClick={() => void saveAccount(account.id)} disabled={savingId === account.id} className="gap-1.5">
                      {savingId === account.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Salvar conta
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-dashed border-emerald-300 bg-white/70 p-4 space-y-3">
        <p className="text-sm font-semibold text-neutral-900">Nova API EnvioEcom</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Nome (ex. Conta 2)" value={newForm.name} onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))} />
          <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Token permanente" value={newForm.token} onChange={(e) => setNewForm((f) => ({ ...f, token: e.target.value }))} />
          <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="E-mail (se não houver token)" value={newForm.email} onChange={(e) => setNewForm((f) => ({ ...f, email: e.target.value }))} />
          <input type="password" className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Senha" value={newForm.password} onChange={(e) => setNewForm((f) => ({ ...f, password: e.target.value }))} />
          <input className="h-11 px-3 rounded-xl border bg-white text-sm sm:col-span-2" placeholder="CEP origem (8 dígitos)" value={newForm.originCep} onChange={(e) => setNewForm((f) => ({ ...f, originCep: e.target.value }))} />
        </div>
        <Button variant="outline" onClick={() => void createAccount()} disabled={creating} className="gap-1.5">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Adicionar conta
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input className="h-11 px-3 rounded-xl border bg-white text-sm sm:col-span-2" placeholder="Transportadoras (CSV opcional)" value={defaults.carriers} onChange={(e) => setDefaults((f) => ({ ...f, carriers: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Peso kg" value={defaults.defaultWeight} onChange={(e) => setDefaults((f) => ({ ...f, defaultWeight: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Comp. cm" value={defaults.defaultLength} onChange={(e) => setDefaults((f) => ({ ...f, defaultLength: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Alt. cm" value={defaults.defaultHeight} onChange={(e) => setDefaults((f) => ({ ...f, defaultHeight: e.target.value }))} />
        <input className="h-11 px-3 rounded-xl border bg-white text-sm" placeholder="Larg. cm" value={defaults.defaultWidth} onChange={(e) => setDefaults((f) => ({ ...f, defaultWidth: e.target.value }))} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void saveDefaults()} disabled={savingDefaults} className="gap-1.5">
          {savingDefaults ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar caixa padrão
        </Button>
        <Button variant="outline" onClick={() => void registerWebhook()} disabled={registering || !suggestedUrl || !accounts.length}>
          {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Registrar webhook em todas
        </Button>
      </div>
      <p className="text-xs text-emerald-900/80 break-all">Webhook: {webhookUrl || "não registrado"} {suggestedUrl ? `· sugerido ${suggestedUrl}` : ""}</p>
    </div>
  );
}
