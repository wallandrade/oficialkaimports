import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDateBR } from "@/lib/utils";

export type OrderHistoryEvent = {
  id?: string;
  orderId?: string;
  action: string;
  actorType?: string | null;
  actorUsername?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
  synthetic?: boolean;
};

const ACTION_LABELS: Record<string, string> = {
  created: "Pedido criado",
  marked_paid: "Marcou como pago",
  cancelled: "Cancelou o pedido",
  status_changed: "Alterou o status",
  edited: "Editou o pedido",
  proof_uploaded: "Enviou comprovante",
  proof_removed: "Removeu comprovante",
  enviado: "Marcou como enviado",
  pending_ship: "Marcou como pendente",
  inventory_exit: "Deu baixa no estoque",
  ee_created: "Criou envio EnvioEcom",
  ee_bound: "Vinculou envio EnvioEcom",
  ee_label: "Gerou etiqueta EnvioEcom",
  ee_cancelled: "Cancelou envio EnvioEcom",
  priority: "Alterou prioridade",
  searching: "Alterou procurando produto",
  observation: "Alterou observações",
  whatsapp_group: "Alterou grupo WhatsApp",
  tracking: "Vinculou rastreio",
  tracking_label: "Enviou etiqueta/rastreio",
  reshipment: "Lançou reenvio",
  difference_charge: "Gerou cobrança de diferença",
  motoboy: "Marcou Motoboy",
};

const POOL_LABELS: Record<string, string> = {
  loja: "Foz Guaçu",
  motoboy: "Motoboy",
  minas: "Minas",
};

function actorLabel(event: OrderHistoryEvent): string {
  const name = String(event.actorUsername || "").trim();
  const type = String(event.actorType || "").trim().toLowerCase();
  if (name) return name;
  if (type === "webhook") return "PIX";
  if (type === "system") return "sistema";
  if (type === "customer") return "cliente";
  if (type === "admin") return "admin";
  return "sistema";
}

function payloadText(event: OrderHistoryEvent): string {
  const payload = event.payload || {};
  const summary = String(payload.summary || "").trim();
  if (summary) return summary;
  const fromStatus = String(payload.fromStatus || "").trim();
  const toStatus = String(payload.toStatus || "").trim();
  const barcode = String(payload.barcode || payload.trackingCode || "").trim();
  const carrier = String(payload.carrier || payload.deliveryMode || payload.shippingCompany || "").trim();
  const pool = String(payload.pool || "").trim();
  const group = String(payload.group || "").trim();
  const amount = payload.amount != null ? Number(payload.amount) : null;
  const parts: string[] = [];
  if (fromStatus && toStatus) parts.push(`De ${fromStatus} para ${toStatus}`);
  else if (toStatus) parts.push(toStatus);
  if (barcode) parts.push(barcode);
  if (carrier) parts.push(carrier);
  if (pool && POOL_LABELS[pool]) parts.push(POOL_LABELS[pool]);
  else if (pool) parts.push(pool);
  if (group) parts.push(group);
  if (Number.isFinite(amount) && amount != null && amount > 0) {
    parts.push(`R$ ${amount.toFixed(2).replace(".", ",")}`);
  }
  if (event.action === "priority") parts.push(payload.on ? "Prioridade ligada" : "Prioridade desligada");
  if (event.action === "searching") parts.push(payload.on ? "Marcou procurando produto" : "Removeu procurando produto");
  if (event.action === "observation") {
    parts.push(payload.visibleToCustomer ? "Cliente vê na conta" : "Só interno");
  }
  return parts.filter(Boolean).join(" · ");
}

function eventTime(event: OrderHistoryEvent): number {
  const parsed = Date.parse(event.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeFetchedHistory(
  previous: OrderHistoryEvent[] | null | undefined,
  incoming: OrderHistoryEvent[] | null | undefined,
): OrderHistoryEvent[] {
  const byId = new Map<string, OrderHistoryEvent>();
  for (const event of [...(previous || []), ...(incoming || [])]) {
    if (!event || event.synthetic) continue;
    const key = String(event.id || `${event.action}-${event.createdAt}`).trim();
    if (!key) continue;
    byId.set(key, event);
  }
  return Array.from(byId.values());
}

export function mergeOrderHistoryEvents(
  events: OrderHistoryEvent[] | null | undefined,
  fallbackCreated?: { createdAt?: string | null; clientName?: string | null },
): OrderHistoryEvent[] {
  const list = Array.isArray(events) ? events.filter((event) => event && event.action) : [];
  const hasCreated = list.some((event) => event.action === "created");
  if (!hasCreated && fallbackCreated?.createdAt) {
    list.push({
      id: "synthetic-created",
      action: "created",
      actorType: "customer",
      actorUsername: String(fallbackCreated.clientName || "").trim() || null,
      payload: null,
      createdAt: fallbackCreated.createdAt,
      synthetic: true,
    });
  }
  return list.sort((a, b) => eventTime(b) - eventTime(a));
}

export function OrderHistoryTimeline({
  events,
  createdAt,
  clientName,
  orderId,
  refreshKey,
}: {
  events?: OrderHistoryEvent[] | null;
  createdAt?: string | null;
  clientName?: string | null;
  orderId?: string | null;
  refreshKey?: string | number | null;
}) {
  const [liveEvents, setLiveEvents] = useState<OrderHistoryEvent[] | null | undefined>(events);
  const skipFirstFetch = useRef(true);

  useEffect(() => {
    setLiveEvents((prev) => mergeFetchedHistory(prev, events));
  }, [events]);

  useEffect(() => {
    const id = String(orderId || "").trim();
    if (!id) return;
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false;
      return;
    }
    let cancelled = false;
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
    const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
    void fetch(`${BASE}/api/admin/orders/${encodeURIComponent(id)}/events`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as { events?: OrderHistoryEvent[] };
        if (!cancelled && Array.isArray(data.events)) {
          setLiveEvents((prev) => mergeFetchedHistory(prev, data.events));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [orderId, refreshKey]);

  const items = mergeOrderHistoryEvents(liveEvents, { createdAt, clientName });
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <p className="text-sm font-semibold text-foreground">Histórico do pedido</p>
        <p className="text-[11px] text-muted-foreground">Tudo que foi feito neste pedido — mais recente em cima</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma ação registrada ainda.</p>
      ) : (
        <ol className="space-y-0">
          {items.map((event, index) => {
            const title = ACTION_LABELS[event.action] || event.action;
            const detail = payloadText(event);
            const at = event.createdAt ? formatDateBR(event.createdAt) : "";
            return (
              <li key={event.id || `${event.action}-${event.createdAt}-${index}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white">
                    <Clock className="h-3.5 w-3.5" />
                  </span>
                  {index < items.length - 1 ? <span className="w-px flex-1 min-h-4 bg-slate-200" /> : null}
                </div>
                <div className={index === items.length - 1 ? "pb-0.5" : "pb-4"}>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {actorLabel(event)}
                    {at ? ` · ${at.replace(",", "")}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
