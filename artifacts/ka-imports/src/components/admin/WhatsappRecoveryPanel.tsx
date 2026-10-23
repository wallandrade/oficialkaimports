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
  recent: Array<{ phone: string; name: string; spent: number; answer?: string; sentAt: string | null; lastOrderAt: string | null }>;
};

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
      <div className="grid grid-cols-2 gap-3 text-sm">
        <p>Na fila: <strong>{data?.waiting ?? "…"}</strong></p>
        <p>Enviados hoje: <strong>{data?.sentToday ?? "…"}</strong></p>
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
      <div>
        <p className="mb-2 text-sm font-medium">Pesquisa</p>
        <p className="mb-2 text-sm text-muted-foreground">
          {data?.survey ? `${data.survey.answered} respostas · ${data.survey.unanswered} sem resposta` : "…"}
        </p>
        <ul className="space-y-1 text-sm">
          {(data?.survey?.options || []).map((option) => (
            <li key={option.id} className="flex items-center justify-between gap-3">
              <span>{option.title}</span>
              <span className="text-muted-foreground">{option.count} · {option.percent.toLocaleString("pt-BR")}%</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Últimos envios</p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {(data?.recent || []).map((row) => (
            <li key={`${row.phone}-${row.sentAt}`}>{row.name || "Cliente"} · {row.phone} · {formatCurrency(Number(row.spent) || 0)}{row.answer ? ` · ${row.answer}` : ""} · {row.sentAt ? new Date(row.sentAt).toLocaleString("pt-BR") : ""}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
