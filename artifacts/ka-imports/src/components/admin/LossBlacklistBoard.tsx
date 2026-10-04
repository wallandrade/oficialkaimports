import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShippingStatusTimeline } from "@/components/ShippingStatusTimeline";
import { formatDateBR } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

type LossEvent = {
  status?: string | null;
  description?: string | null;
  location?: string | null;
  at?: string | null;
};

export type LossBlacklistItem = {
  id: string;
  orderId: string;
  packageId?: string | null;
  orderNumber?: number | null;
  clientName?: string | null;
  carrierName?: string | null;
  cityName?: string | null;
  neighborhoodName?: string | null;
  state?: string | null;
  cep?: string | null;
  incidentType?: string | null;
  source?: string | null;
  rawStatus?: string | null;
  occurredAt?: string | null;
  removedAt?: string | null;
  envioecomStatus?: string | null;
  envioecomBarcode?: string | null;
  events?: LossEvent[];
};

const TYPE_LABEL: Record<string, string> = {
  extravio: "Extravio",
  roubo: "Roubo",
  furto: "Furto",
  sinistro: "Sinistro",
  manual: "Manual",
};

function displayOrderNumber(item: LossBlacklistItem): string {
  const numeric = Number(item.orderNumber);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  return item.orderId;
}

function placeLabel(item: LossBlacklistItem): string {
  const city = [item.cityName, item.state].filter(Boolean).join("/");
  const neighborhood = String(item.neighborhoodName || "").trim();
  return [neighborhood, city].filter(Boolean).join(" · ") || "—";
}

function typeLabel(value: string | null | undefined): string {
  const key = String(value || "").trim().toLowerCase();
  return TYPE_LABEL[key] || (key ? key : "—");
}

export function LossBlacklistBoard({
  onOpenOrder,
}: {
  onOpenOrder?: (item: LossBlacklistItem) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [items, setItems] = useState<LossBlacklistItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: debouncedQ });
        if (includeRemoved) params.set("includeRemoved", "1");
        const res = await fetch(`${BASE}/api/admin/envioecom/loss-blacklist?${params}`, { headers: adminHeaders() });
        if (!res.ok) throw new Error("Falha ao carregar a lista negra.");
        const data = await res.json() as { items?: LossBlacklistItem[]; truncated?: boolean };
        if (cancelled) return;
        setItems(data.items || []);
        setTruncated(!!data.truncated);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Erro ao carregar a lista negra.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, includeRemoved]);

  async function removeFromList(item: LossBlacklistItem) {
    if (!window.confirm("Tirar da lista negra de extravio?")) return;
    setRemovingId(item.id);
    try {
      const params = new URLSearchParams();
      if (item.packageId) params.set("packageId", item.packageId);
      const query = params.toString();
      const res = await fetch(
        `${BASE}/api/admin/envioecom/orders/${item.orderId}/loss-blacklist${query ? `?${query}` : ""}`,
        { method: "DELETE", headers: adminHeaders() },
      );
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Falha ao tirar da lista.");
      toast.success("Envio retirado da lista negra.");
      setItems((prev) => (includeRemoved
        ? prev.map((row) => (row.id === item.id ? { ...row, removedAt: new Date().toISOString() } : row))
        : prev.filter((row) => row.id !== item.id)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao tirar da lista.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Buscar pedido, cliente, cidade ou transportadora"
          className="h-11 min-w-[16rem] flex-1 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
        />
        <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={includeRemoved}
            onChange={(event) => setIncludeRemoved(event.target.checked)}
            className="h-4 w-4"
          />
          Mostrar retirados
        </label>
      </div>
      {truncated ? (
        <p className="text-xs text-amber-800">Mostrando os 500 mais recentes.</p>
      ) : null}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando lista negra…
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum envio na lista negra.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Pedido</th>
                <th className="px-3 py-2 font-semibold">Cliente</th>
                <th className="px-3 py-2 font-semibold">Transportadora</th>
                <th className="px-3 py-2 font-semibold">Cidade</th>
                <th className="px-3 py-2 font-semibold">Origem</th>
                <th className="px-3 py-2 font-semibold">Tipo</th>
                <th className="px-3 py-2 font-semibold">Data</th>
                <th className="px-3 py-2 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const open = expandedId === item.id;
                const removed = !!item.removedAt;
                return (
                  <Fragment key={item.id}>
                    <tr
                      className="border-t border-border/70 cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                    >
                      <td className="px-3 py-2 align-top">
                        <button
                          type="button"
                          className="font-semibold text-primary hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenOrder?.(item);
                          }}
                        >
                          #{displayOrderNumber(item)}
                        </button>
                        {item.packageId ? (
                          <p className="text-xs text-muted-foreground">Pacote</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top">{item.clientName || "—"}</td>
                      <td className="px-3 py-2 align-top">
                        <p>{item.carrierName || "—"}</p>
                        <p className="font-mono text-xs text-muted-foreground">{item.envioecomBarcode || ""}</p>
                      </td>
                      <td className="px-3 py-2 align-top">{placeLabel(item)}</td>
                      <td className="px-3 py-2 align-top">{item.source === "manual" ? "Manual" : "Rastreio"}</td>
                      <td className="px-3 py-2 align-top">
                        <p>{typeLabel(item.incidentType)}</p>
                        {item.envioecomStatus ? (
                          <p className="text-xs text-muted-foreground">{item.envioecomStatus}</p>
                        ) : null}
                        {removed ? (
                          <p className="text-xs font-semibold text-amber-800">Retirado</p>
                        ) : null}
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700">
                          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {open ? "Ocultar rastreio" : "Ver caminho do envio"}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">
                        {item.occurredAt ? formatDateBR(item.occurredAt) : "—"}
                      </td>
                      <td className="px-3 py-2 align-top" onClick={(event) => event.stopPropagation()}>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {!removed ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-rose-800 border-rose-200 hover:bg-rose-50"
                              disabled={removingId === item.id}
                              onClick={() => void removeFromList(item)}
                            >
                              {removingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Tirar da lista negra"}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="border-t border-border/40 bg-muted/20">
                        <td colSpan={8} className="px-4 py-3">
                          {item.rawStatus ? (
                            <p className="mb-3 text-xs text-muted-foreground">Registro: {item.rawStatus}</p>
                          ) : null}
                          <ShippingStatusTimeline
                            events={item.events || []}
                            title="Caminho na EnvioEcom"
                            emptyText="Sem histórico EnvioEcom neste envio."
                          />
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
