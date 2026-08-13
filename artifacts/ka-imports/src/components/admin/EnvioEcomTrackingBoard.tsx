import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { EnvioEcomOrderFields } from "./EnvioEcomOrderActions";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

export function EnvioEcomTrackingBoard() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("");
  const [orders, setOrders] = useState<EnvioEcomOrderFields[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/tracking-board`, { headers: adminHeaders() });
      if (!res.ok) throw new Error("Falha ao carregar rastreios.");
      const data = await res.json() as { orders?: EnvioEcomOrderFields[] };
      setOrders(data.orders || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar rastreios.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) => {
      const hay = [
        order.id,
        order.envioecomBarcode,
        order.trackingCode,
        order.envioecomStatus,
        order.envioecomDeliveryMode,
        String(order.envioecomShipmentId || ""),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [filter, orders]);

  async function syncAll() {
    setSyncing(true);
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/tracking-board/sync`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ orderIds: filtered.slice(0, 20).map((order) => order.id) }),
      });
      if (!res.ok) throw new Error("Falha no sync em lote.");
      toast.success("Sync em lote concluído.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no sync.");
    } finally {
      setSyncing(false);
    }
  }

  async function syncOne(orderId: string) {
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
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Rastreios EnvioEcom</h2>
          <p className="text-sm text-muted-foreground">Envios desta loja. Sync em lote atualiza até 20 pedidos.</p>
        </div>
        <Button onClick={() => void syncAll()} disabled={syncing || loading} className="gap-1.5">
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sync lote
        </Button>
      </div>
      <input
        className="w-full h-11 px-3 rounded-xl border-2 border-border bg-white text-sm"
        placeholder="Filtrar por status, barcode, ID..."
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando rastreios...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum envio EnvioEcom nesta loja.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((order) => (
            <div key={order.id} className="rounded-xl border border-border bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">#{order.id}</p>
                <p className="text-xs text-muted-foreground">
                  {order.envioecomStatus || "Sem status"}
                  {order.envioecomDeliveryMode ? ` · ${order.envioecomDeliveryMode}` : ""}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  {order.envioecomBarcode || order.trackingCode || "sem barcode"}
                  {order.envioecomShipmentId ? ` · ID ${order.envioecomShipmentId}` : ""}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void syncOne(order.id)}>Sync</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
