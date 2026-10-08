import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateBR } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PERIODS = [
  { value: "open", label: "Abertas (90 dias)" },
  { value: "today", label: "Hoje" },
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "60", label: "Últimos 60 dias" },
] as const;

type TowerKind =
  | "extravio"
  | "avaria"
  | "retencao"
  | "endereco"
  | "destinatario_ausente"
  | "devolucao"
  | "aguardando_retirada";

type TowerItem = {
  orderId: string;
  packageId?: string | null;
  orderNumber?: number | null;
  clientName?: string | null;
  clientPhone?: string | null;
  trackingCode?: string | null;
  carrier?: string | null;
  kind?: TowerKind;
  kindLabel?: string | null;
  action?: string | null;
  status?: string | null;
  statusUpdatedAt?: string | null;
};

type TowerPayload = {
  occurrences?: number;
  byCarrier?: Array<{ carrier: string; count: number; percent: number }>;
  byKind?: Array<{ kind: TowerKind; label: string; count: number; percent: number }>;
  items?: TowerItem[];
  listTruncated?: boolean;
  message?: string;
};

type ListMode = { carrier: string; kind: string };

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { Authorization: `Bearer ${token}` }
    : {};
}

function filterKey(period: string, carrier: string, kind: string): string {
  return `${period}|${carrier}|${kind}`;
}

function orderLabel(item: TowerItem): string {
  const numeric = Number(item.orderNumber);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  return String(item.orderId || "").slice(0, 8);
}

export function EnvioEcomControlTower({
  onOpenOrder,
  onUnauthorized,
}: {
  onOpenOrder?: (item: { id: string; orderNumber?: number | null }) => void;
  onUnauthorized?: () => void;
}) {
  const [period, setPeriod] = useState("open");
  const [payload, setPayload] = useState<TowerPayload | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [listMode, setListMode] = useState<ListMode | null>(null);
  const requestRef = useRef(0);

  async function load(nextPeriod: string, carrier: string, kind: string, trackList: boolean) {
    const key = filterKey(nextPeriod, carrier, kind);
    const requestId = ++requestRef.current;
    if (trackList) setPendingKey(key);
    try {
      const params = new URLSearchParams({ period: nextPeriod });
      if (carrier) params.set("carrier", carrier);
      if (kind) params.set("kind", kind);
      const res = await fetch(`${BASE}/api/admin/envioecom/control-tower?${params}`, { headers: adminHeaders() });
      if (requestId !== requestRef.current) return;
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      const data = await res.json().catch(() => ({})) as TowerPayload;
      if (!res.ok) {
        toast.error(data.message || "Falha ao carregar ocorrências.");
        if (trackList) setListMode(null);
        return;
      }
      setPayload(data);
      setLoadedKey(key);
    } catch {
      if (requestId !== requestRef.current) return;
      toast.error("Erro ao carregar ocorrências.");
      if (trackList) setListMode(null);
    } finally {
      if (requestId === requestRef.current) {
        setPendingKey((current) => (current === key ? null : current));
      }
    }
  }

  useEffect(() => {
    void load("open", "", "", false);
  }, []);

  function changePeriod(next: string) {
    setPeriod(next);
    setListMode(null);
    void load(next, "", "", false);
  }

  function toggleList(next: ListMode) {
    const same = listMode?.carrier === next.carrier && listMode?.kind === next.kind;
    if (same) {
      setListMode(null);
      return;
    }
    setListMode(next);
    if (loadedKey === filterKey(period, next.carrier, next.kind)) return;
    void load(period, next.carrier, next.kind, true);
  }

  const ready = payload != null;
  const carriers = payload?.byCarrier || [];
  const kinds = payload?.byKind || [];
  const allOpen = listMode != null && !listMode.carrier && !listMode.kind;
  const listWaiting = listMode != null && pendingKey === filterKey(period, listMode.carrier, listMode.kind);
  const items = payload?.items || [];

  return (
    <section className="rounded-xl border border-amber-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground">Ocorrências</h3>
          <p className="text-xs text-muted-foreground">
            Problema aberto na última movimentação. Não marca Enviado, não baixa estoque e não tira da cópia.
          </p>
        </div>
        <label className="space-y-1">
          <span className="sr-only">Período</span>
          <select
            id="envioecom-control-tower-period"
            className="h-10 px-3 rounded-xl border-2 border-border bg-white text-sm"
            value={period}
            onChange={(event) => changePeriod(event.target.value)}
          >
            {PERIODS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={() => toggleList({ carrier: "", kind: "" })}
        className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100"
      >
        <p className="text-2xl font-bold text-amber-950">{ready ? payload?.occurrences ?? 0 : "…"}</p>
        <p className="text-xs font-semibold text-amber-800">{allOpen ? "Fechar" : "Ver mais"}</p>
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transportadoras</p>
          {!ready ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : carriers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma transportadora com ocorrência.</p>
          ) : carriers.map((row) => {
            const open = listMode?.carrier === row.carrier && !listMode.kind;
            return (
              <div key={row.carrier} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{row.carrier}</span>
                <span className="shrink-0 text-muted-foreground">{row.count} · {row.percent}%</span>
                <button type="button" className="shrink-0 text-xs font-semibold text-amber-800" onClick={() => toggleList({ carrier: row.carrier, kind: "" })}>
                  {open ? "Fechar" : "Ver mais"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipos</p>
          {!ready ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : kinds.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum tipo de ocorrência.</p>
          ) : kinds.map((row) => {
            const open = listMode?.kind === row.kind && !listMode.carrier;
            return (
              <div key={row.kind} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="shrink-0 text-muted-foreground">{row.count} · {row.percent}%</span>
                <button type="button" className="shrink-0 text-xs font-semibold text-amber-800" onClick={() => toggleList({ carrier: "", kind: row.kind })}>
                  {open ? "Fechar" : "Ver mais"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {listMode ? (
        listWaiting ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-amber-700" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ocorrência neste recorte.</p>
        ) : (
          <div className="space-y-2">
            {payload?.listTruncated ? (
              <p className="text-xs text-muted-foreground">
                Mostrando as 200 atualizações mais antigas. O total e os rankings usam o período inteiro.
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Pedido</th>
                    <th className="px-3 py-2 font-semibold">Transportadora</th>
                    <th className="px-3 py-2 font-semibold">Código</th>
                    <th className="px-3 py-2 font-semibold">Cliente</th>
                    <th className="px-3 py-2 font-semibold">Telefone</th>
                    <th className="px-3 py-2 font-semibold">Tipo</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Ação</th>
                    <th className="px-3 py-2 font-semibold">Data</th>
                    <th className="px-3 py-2 font-semibold text-right">Pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={`${item.orderId}:${item.packageId || "order"}`} className="border-t border-border/70">
                      <td className="px-3 py-2 align-top font-semibold">#{orderLabel(item)}</td>
                      <td className="px-3 py-2 align-top">{item.carrier || "Sem transportadora"}</td>
                      <td className="px-3 py-2 align-top font-mono text-xs">{item.trackingCode || "—"}</td>
                      <td className="px-3 py-2 align-top">{item.clientName || "—"}</td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">{item.clientPhone || "—"}</td>
                      <td className="px-3 py-2 align-top">{item.kindLabel || "—"}</td>
                      <td className="px-3 py-2 align-top">{item.status || "—"}</td>
                      <td className="px-3 py-2 align-top">{item.action || "—"}</td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-muted-foreground">
                        {item.statusUpdatedAt ? formatDateBR(item.statusUpdatedAt) : "—"}
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        {onOpenOrder ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onOpenOrder({ id: item.orderId, orderNumber: item.orderNumber })}
                          >
                            Pedido
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}
