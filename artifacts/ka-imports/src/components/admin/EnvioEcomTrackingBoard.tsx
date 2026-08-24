import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronUp, Clock, ExternalLink, FileText, Loader2, Package, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateBR } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

type TrackingGroup = "all" | "delivered" | "in_transit" | "awaiting" | "cancelled" | "other";
type StatusSort = "none" | "asc" | "desc";

type TrackingEvent = {
  status?: string | null;
  description?: string | null;
  location?: string | null;
  at?: string | null;
  updated_at?: string | null;
  source?: string | null;
};

type TrackingItem = {
  id: string;
  orderNumber?: number | null;
  clientName?: string | null;
  clientPhone?: string | null;
  envioecomShipmentId?: number | null;
  envioecomBarcode?: string | null;
  trackingCode?: string | null;
  envioecomStatus?: string | null;
  envioecomDeliveryMode?: string | null;
  envioecomStatusUpdatedAt?: string | null;
  envioecomLabelUrl?: string | null;
  trackingLabelUrl?: string | null;
  trackingGroup?: TrackingGroup;
  events?: TrackingEvent[];
  lastEvents?: TrackingEvent[];
  envioecomStatusHistory?: TrackingEvent[];
};

type Summary = {
  total: number;
  in_transit: number;
  awaiting: number;
  delivered: number;
  cancelled: number;
  other: number;
};

const EMPTY_SUMMARY: Summary = { total: 0, in_transit: 0, awaiting: 0, delivered: 0, cancelled: 0, other: 0 };

function displayOrderNumber(item: TrackingItem): string {
  const numeric = Number(item.orderNumber);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  return item.id;
}

function normalizeStatus(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function statusBadgeClass(status?: string | null, group?: TrackingGroup): string {
  const normalized = normalizeStatus(status);
  if (group === "cancelled" || normalized.includes("cancelad")) {
    return "bg-rose-100 text-rose-800 border-rose-200";
  }
  if (group === "delivered" || normalized.includes("entregue")) {
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }
  if (normalized.includes("emitid") || normalized.includes("pronto para envio") || normalized.includes("dc-e") || normalized.includes("dce")) {
    return "bg-green-100 text-green-800 border-green-200";
  }
  if (
    group === "in_transit"
    || ["coletado", "em transito", "postado", "saiu para entrega"].some((marker) => normalized.includes(marker))
  ) {
    return "bg-sky-100 text-sky-800 border-sky-200";
  }
  if (normalized.includes("aguardando pagamento")) {
    return "bg-amber-100 text-amber-800 border-amber-200";
  }
  if (group === "awaiting" || normalized.includes("aguardando") || normalized.includes("envio criado")) {
    return "bg-lime-100 text-lime-800 border-lime-200";
  }
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function itemUpdatedMs(item: TrackingItem): number {
  const parsed = Date.parse(String(item.envioecomStatusUpdatedAt || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareByStatus(a: TrackingItem, b: TrackingItem, dir: "asc" | "desc"): number {
  const left = String(a.envioecomStatus || "").trim();
  const right = String(b.envioecomStatus || "").trim();
  if (!left && right) return 1;
  if (left && !right) return -1;
  const byStatus = left.localeCompare(right, "pt-BR", { sensitivity: "base" });
  const statusDelta = dir === "asc" ? byStatus : -byStatus;
  if (statusDelta !== 0) return statusDelta;
  return itemUpdatedMs(b) - itemUpdatedMs(a);
}

const KPI_TONE: Record<TrackingGroup, string> = {
  all: "border-border bg-white hover:bg-muted/40",
  in_transit: "border-sky-200 bg-sky-50 hover:bg-sky-100",
  awaiting: "border-green-200 bg-green-50 hover:bg-green-100",
  delivered: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100",
  cancelled: "border-rose-200 bg-rose-50 hover:bg-rose-100",
  other: "border-slate-200 bg-slate-50 hover:bg-slate-100",
};

const KPI_TONE_ACTIVE: Record<TrackingGroup, string> = {
  all: "border-slate-400 bg-slate-50",
  in_transit: "border-sky-400 bg-sky-100",
  awaiting: "border-green-400 bg-green-100",
  delivered: "border-emerald-400 bg-emerald-100",
  cancelled: "border-rose-400 bg-rose-100",
  other: "border-slate-400 bg-slate-100",
};

function eventAt(event: TrackingEvent): string {
  return String(event.at || event.updated_at || "").trim();
}

function eventStatusKey(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function usefulEventLocation(event: TrackingEvent): string | null {
  const location = String(event.location || "").trim();
  if (!location) return null;
  if (eventStatusKey(location) === eventStatusKey(event.status)) return null;
  return location;
}

function usefulEventDescription(event: TrackingEvent): string | null {
  const description = String(event.description || "").trim();
  if (!description) return null;
  const normalized = eventStatusKey(description);
  if (normalized.includes("status atualizado ao consultar") || normalized.includes("consultando rastreio")) return null;
  if (normalized === eventStatusKey(event.status) || normalized === eventStatusKey(event.location)) return null;
  return description;
}

function resolveTimelineEvents(item: TrackingItem): TrackingEvent[] {
  if (item.events?.length) return item.events;
  if (item.lastEvents?.length) return item.lastEvents;
  const history = item.envioecomStatusHistory || [];
  return [...history].reverse();
}

function TrackingTimeline({ events }: { events: TrackingEvent[] }) {
  if (!events.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Sem histórico gravado. Use Sync para buscar na EnvioEcom.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Status do envio</p>
        <p className="text-[11px] text-muted-foreground">mais recente em cima</p>
      </div>
      <ol className="space-y-0">
        {events.map((event, index) => {
          const status = String(event.status || "").trim() || "Status";
          const normalized = eventStatusKey(status);
          const delivered = normalized.includes("entregue");
          const dce = normalized.includes("dc-e") || normalized.includes("dce emitida");
          const highlight = delivered || dce;
          const newest = index === 0;
          const location = usefulEventLocation(event);
          const description = usefulEventDescription(event);
          const at = eventAt(event);
          const meta = [location, description].filter(Boolean).join(" · ");
          return (
            <li key={`${at}-${status}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    highlight
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : newest
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-sky-400 bg-white text-sky-600"
                  }`}
                >
                  {highlight ? <Check className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
                </span>
                {index < events.length - 1 ? <span className="w-px flex-1 min-h-4 bg-slate-200" /> : null}
              </div>
              <div className={`pb-4 ${index === events.length - 1 ? "pb-0" : ""}`}>
                <p className="text-sm font-semibold text-foreground">{status}</p>
                {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
                {at ? (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDateBR(at)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function EnvioEcomTrackingBoard({
  onOpenOrder,
}: {
  onOpenOrder?: (item: TrackingItem) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<TrackingGroup>("all");
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [configured, setConfigured] = useState(true);
  const [itemName, setItemName] = useState("Mercadoria");
  const [canEditItemName, setCanEditItemName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusSort, setStatusSort] = useState<StatusSort>("none");

  async function loadItemName() {
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/shipment-item-name`, { headers: adminHeaders() });
      if (!res.ok) {
        setCanEditItemName(false);
        return;
      }
      const data = await res.json() as { name?: string; defaultName?: string };
      setItemName(data.name || data.defaultName || "Mercadoria");
      setCanEditItemName(true);
    } catch {
      setCanEditItemName(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim(), group: "all", limit: "200" });
      const res = await fetch(`${BASE}/api/admin/envioecom/tracking-board?${params}`, { headers: adminHeaders() });
      if (!res.ok) throw new Error("Falha ao carregar rastreios.");
      const data = await res.json() as { items?: TrackingItem[]; summary?: Summary; configured?: boolean };
      setItems(data.items || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setConfigured(data.configured !== false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar rastreios.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadItemName();
  }, []);

  async function saveItemName() {
    setSavingName(true);
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/shipment-item-name`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({ name: itemName }),
      });
      const data = await res.json().catch(() => ({})) as { name?: string; message?: string };
      if (!res.ok) throw new Error(data.message || "Falha ao salvar o nome do produto.");
      setItemName(data.name || "Mercadoria");
      toast.success("Nome do produto no create salvo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSavingName(false);
    }
  }

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (group !== "all" && item.trackingGroup !== group) return false;
      if (!query) return true;
      const hay = [
        item.id,
        item.orderNumber,
        item.clientName,
        item.clientPhone,
        item.envioecomBarcode,
        item.trackingCode,
        item.envioecomStatus,
        item.envioecomDeliveryMode,
        item.envioecomShipmentId,
      ].join(" ").toLowerCase();
      return hay.includes(query);
    });
    if (statusSort === "none") return filtered;
    return [...filtered].sort((a, b) => compareByStatus(a, b, statusSort));
  }, [items, q, group, statusSort]);

  async function syncOpen() {
    setSyncing(true);
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/tracking-board/sync`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string; synced?: number };
      if (!res.ok) throw new Error(data.message || "Falha no sync em lote.");
      toast.success(`Sync concluído (${data.synced ?? 0} pedido(s)).`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no sync.");
    } finally {
      setSyncing(false);
    }
  }

  async function syncOne(orderId: string) {
    setSyncingId(orderId);
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${orderId}/sync`, {
        method: "POST",
        headers: adminHeaders(),
        body: "{}",
      });
      if (!res.ok) throw new Error("Falha ao sincronizar pedido.");
      toast.success("Pedido atualizado.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao sincronizar.");
    } finally {
      setSyncingId(null);
    }
  }

  const kpis: Array<{ key: TrackingGroup; label: string; value: number }> = [
    { key: "all", label: "Total", value: summary.total },
    { key: "in_transit", label: "Em trânsito", value: summary.in_transit },
    { key: "awaiting", label: "Aguardando", value: summary.awaiting },
    { key: "delivered", label: "Entregues", value: summary.delivered },
    { key: "cancelled", label: "Cancelados", value: summary.cancelled },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Rastreios EnvioEcom</h2>
          <p className="text-sm text-muted-foreground">
            Pedidos desta loja com envio vinculado. Clique na linha para ver o histórico (já vem do banco). Atualizar lista lê o BD; Sync consulta a EnvioEcom.
            {!configured ? " · EnvioEcom ainda não configurado." : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading || syncing} className="gap-1.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Atualizar lista
          </Button>
          <Button onClick={() => void syncOpen()} disabled={syncing || loading} className="gap-1.5">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sync abertos (até 20)
          </Button>
        </div>
      </div>

      {canEditItemName ? (
        <div className="rounded-xl border border-border bg-white p-4 space-y-2">
          <label className="text-sm font-semibold" htmlFor="envioecom-shipment-item-name">
            Nome do produto no create
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="envioecom-shipment-item-name"
              className="flex-1 h-11 px-3 rounded-xl border-2 border-border bg-white text-sm"
              maxLength={120}
              placeholder="Mercadoria"
              value={itemName}
              onChange={(event) => setItemName(event.target.value)}
            />
            <Button onClick={() => void saveItemName()} disabled={savingName} className="gap-1.5 shrink-0">
              {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Vale para todos os itens; envios já criados não mudam.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {kpis.map((kpi) => (
          <button
            key={kpi.key}
            type="button"
            onClick={() => setGroup(kpi.key)}
            className={`rounded-xl border px-3 py-3 text-left ${group === kpi.key ? KPI_TONE_ACTIVE[kpi.key] : KPI_TONE[kpi.key]}`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
            <p className="text-xl font-bold text-foreground">{kpi.value}</p>
          </button>
        ))}
      </div>

      <input
        className="w-full h-11 px-3 rounded-xl border-2 border-border bg-white text-sm"
        placeholder="Buscar pedido, cliente, telefone, código, status, transportadora..."
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando rastreios...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum envio EnvioEcom nesta loja.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Pedido</th>
                <th className="px-3 py-2 font-semibold">Cliente</th>
                <th className="px-3 py-2 font-semibold">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
                    title="Ordenar por status"
                    onClick={() => setStatusSort((prev) => (prev === "none" ? "asc" : prev === "asc" ? "desc" : "none"))}
                  >
                    Status
                    {statusSort === "asc" ? (
                      <ArrowUp className="h-3.5 w-3.5" />
                    ) : statusSort === "desc" ? (
                      <ArrowDown className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
                    )}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold">Código</th>
                <th className="px-3 py-2 font-semibold">Atualizado</th>
                <th className="px-3 py-2 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const labelUrl = item.envioecomLabelUrl || item.trackingLabelUrl;
                const updated = item.envioecomStatusUpdatedAt
                  ? formatDateBR(item.envioecomStatusUpdatedAt)
                  : "—";
                const open = expandedId === item.id;
                const timeline = resolveTimelineEvents(item);
                return (
                  <Fragment key={item.id}>
                    <tr
                      className="border-t border-border/70 cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                    >
                      <td className="px-3 py-2 align-top">
                        <p className="font-semibold">#{displayOrderNumber(item)}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.envioecomDeliveryMode || "—"}
                          {item.envioecomShipmentId ? ` · ID ${item.envioecomShipmentId}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <p>{item.clientName || "—"}</p>
                        <p className="text-xs text-muted-foreground">{item.clientPhone || ""}</p>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadgeClass(item.envioecomStatus, item.trackingGroup)}`}>
                          {item.envioecomStatus || "Sem status"}
                        </span>
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700">
                          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {open ? "Ocultar rastreio" : "Ver histórico do rastreio"}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-top font-mono text-xs">{item.envioecomBarcode || item.trackingCode || "—"}</td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">{updated}</td>
                      <td
                        className="px-3 py-2 align-top"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button size="sm" variant="outline" disabled={syncingId === item.id} onClick={() => void syncOne(item.id)}>
                            {syncingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Sync"}
                          </Button>
                          {labelUrl ? (
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => window.open(labelUrl, "_blank", "noopener,noreferrer")}>
                              <FileText className="w-3.5 h-3.5" /> PDF
                            </Button>
                          ) : null}
                          {onOpenOrder ? (
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => onOpenOrder(item)}>
                              <ExternalLink className="w-3.5 h-3.5" /> Pedido
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="border-t border-border/40 bg-slate-50/80">
                        <td colSpan={6} className="px-4 py-3">
                          <TrackingTimeline events={timeline} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
