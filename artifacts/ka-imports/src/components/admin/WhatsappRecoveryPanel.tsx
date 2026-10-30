import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

type Snapshot = {
  enabled: boolean;
  days: number;
  dailyLimit: number;
  startHour: number;
  endHour: number;
  message: string;
  webhookConfigured: boolean;
  waiting: number;
  sentToday: number;
  survey?: {
    answered: number;
    unanswered: number;
    options: Array<{ id: string; title: string; count: number; percent: number }>;
  };
  recovered?: { count: number; total: number; percent: number };
  recent: Array<{ phone: string; name: string; spent: number; answer?: string; recovered?: boolean; sentAt: string | null; lastOrderAt: string | null }>;
};

function formatPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

function formatSentAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

export function WhatsappRecoveryPanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState("");
  const [days, setDays] = useState("40");
  const [dailyLimit, setDailyLimit] = useState("40");
  const [startHour, setStartHour] = useState("10");
  const [endHour, setEndHour] = useState("19");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/admin/whatsapp-recovery", { headers: authHeaders() });
    if (!res.ok) {
      setError("Não foi possível carregar a recuperação.");
      return;
    }
    const json = await res.json() as Snapshot;
    setData(json);
    setMessage(json.message || "");
    setDays(String(json.days || 40));
    setDailyLimit(String(json.dailyLimit || 40));
    setStartHour(String(json.startHour ?? 10));
    setEndHour(String(json.endHour ?? 19));
    setEnabled(json.enabled);
    setError("");
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/whatsapp-recovery", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          enabled,
          days: Number(days),
          dailyLimit: Number(dailyLimit),
          startHour: Number(startHour),
          endHour: Number(endHour),
          message,
        }),
      });
      const json = await res.json() as Snapshot & { message?: string };
      if (!res.ok) {
        setError(json.message || "Não foi possível salvar.");
        return;
      }
      setData(json);
      setStartHour(String(json.startHour ?? startHour));
      setEndHour(String(json.endHour ?? endHour));
      setError("");
    } finally {
      setBusy(false);
    }
  }

  async function sendOne() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/whatsapp-recovery/send-one", {
        method: "POST",
        headers: authHeaders(),
      });
      const json = await res.json() as Snapshot & { sent?: boolean; reason?: string };
      if (!res.ok) {
        setError("Não foi possível enviar.");
        return;
      }
      setData(json);
      setError(json.sent ? "" : `Não enviou: ${json.reason || "sem cliente"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Recuperação</h2>
        <p className="text-sm text-muted-foreground">
          Pergunta, no WhatsApp, o que levou o cliente a parar de comprar. Começa pelos mais antigos. Entre {data?.startHour ?? 10}h e {data?.endHour ?? 19}h, no horário de São Paulo, até o limite do dia.
        </p>
      </div>
      {data && !data.webhookConfigured ? (
        <p className="text-sm text-amber-700">Salve a URL de Recuperação em Configuração, na seção WhatsApp (n8n), antes de ligar.</p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-white px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Na fila</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{data?.waiting ?? "…"}</p>
        </div>
        <div className="rounded-2xl border border-border bg-white px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Enviados hoje</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{data?.sentToday ?? "…"}</p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Ligada
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          Dias sem comprar
          <input value={days} onChange={(event) => setDays(event.target.value)} className="mt-1 block h-10 w-24 rounded-xl border-2 border-border px-3" />
        </label>
        <label className="text-sm">
          Limite por dia
          <input value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} className="mt-1 block h-10 w-24 rounded-xl border-2 border-border px-3" />
        </label>
        <label className="text-sm">
          Começa
          <input type="number" min={0} max={23} value={startHour} onChange={(event) => setStartHour(event.target.value)} className="mt-1 block h-10 w-24 rounded-xl border-2 border-border px-3" />
        </label>
        <label className="text-sm">
          Para
          <input type="number" min={1} max={24} value={endHour} onChange={(event) => setEndHour(event.target.value)} className="mt-1 block h-10 w-24 rounded-xl border-2 border-border px-3" />
        </label>
      </div>
      <label className="block text-sm">
        Mensagem. Use {"{nome}"} para o primeiro nome.
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={8} className="mt-1 w-full rounded-xl border-2 border-border px-3 py-2" />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={busy}>Salvar</Button>
        <Button variant="outline" onClick={() => void sendOne()} disabled={busy || !enabled}>Enviar um agora</Button>
      </div>
      <section className="rounded-2xl border border-border bg-white p-4">
        <p className="text-sm font-semibold">Pesquisa</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-orange-50 px-3 py-3">
            <p className="text-2xl font-bold tabular-nums text-orange-800">{data?.survey?.answered ?? "…"}</p>
            <p className="text-xs font-medium text-orange-700">respostas</p>
          </div>
          <div className="rounded-xl bg-neutral-100 px-3 py-3">
            <p className="text-2xl font-bold tabular-nums">{data?.survey?.unanswered ?? "…"}</p>
            <p className="text-xs font-medium text-muted-foreground">sem resposta</p>
          </div>
        </div>
        {data?.recovered ? (
          <div className="mt-4">
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">Recuperados</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{data.recovered.count} · {data.recovered.percent.toLocaleString("pt-BR")}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, Math.max(0, data.recovered.percent))}%` }} />
            </div>
          </div>
        ) : null}
        <ul className="mt-4 space-y-3">
          {(data?.survey?.options || []).map((option) => {
            const width = Math.min(100, Math.max(0, Number(option.percent) || 0));
            return (
              <li key={option.id}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{option.title}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{option.count} · {width.toLocaleString("pt-BR")}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${width}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="rounded-2xl border border-border bg-white p-4">
        <p className="text-sm font-semibold">Últimos envios</p>
        {(data?.recent || []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum envio ainda.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {(data?.recent || []).map((row) => (
              <li key={`${row.phone}-${row.sentAt}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <span className="truncate">{row.name || "Cliente"}</span>
                    {row.recovered ? <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">Recuperado</span> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">{formatPhone(row.phone)}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatCurrency(Number(row.spent) || 0)}</p>
                {row.answer ? (
                  <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">{row.answer}</span>
                ) : (
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-muted-foreground">Sem resposta</span>
                )}
                <p className="w-full text-xs text-muted-foreground sm:w-auto sm:text-right">{formatSentAt(row.sentAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
