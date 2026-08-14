import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Loader2, RefreshCw, Save } from "lucide-react";
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
    return items.filter((item) => {
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
  }, [items, q, group]);

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
            Pedidos desta loja com envio vinculado. Atualizar lista lê o banco; Sync consulta a EnvioEcom.
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
            className={`rounded-xl border px-3 py-3 text-left ${group === kpi.key ? "border-emerald-400 bg-emerald-50" : "border-border bg-white hover:bg-muted/40"}`}
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
                <th className="px-3 py-2 font-semibold">Status</th>
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
                return (
                  <tr key={item.id} className="border-t border-border/70">
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
                    <td className="px-3 py-2 align-top">{item.envioecomStatus || "Sem status"}</td>
                    <td className="px-3 py-2 align-top font-mono text-xs">{item.envioecomBarcode || item.trackingCode || "—"}</td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">{updated}</td>
                    <td className="px-3 py-2 align-top">
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
