import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDateOnlyBR } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

type AffiliateRow = {
  userId: string;
  name: string;
  email: string;
  affiliateCode: string | null;
  released: number;
  used: number;
  available: number;
};

type AffiliateOrder = {
  id: string;
  orderNumber: number | null;
  createdAt: string | null;
  status: string;
  total: number;
  commissionAmount: number;
  excludedSellerCode?: string | null;
};

type AffiliateBuyer = {
  email: string;
  name: string;
  phone: string;
  orderCount: number;
  totalSpent: number;
  commissionTotal: number;
  orders: AffiliateOrder[];
};

function statusLabel(status: string): string {
  if (status === "paid") return "Pago";
  if (status === "completed") return "Concluído";
  return status || "—";
}

function orderLabel(order: AffiliateOrder): string {
  if (order.orderNumber) return `#${order.orderNumber}`;
  return order.id;
}

export function AdminAffiliatesPanel({
  onOpenOrder,
}: {
  onOpenOrder: (orderId: string, orderCreatedAt?: string | null) => void;
}) {
  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, AffiliateBuyer[]>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/affiliates`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({})) as { affiliates?: AffiliateRow[]; message?: string };
      if (!res.ok) {
        toast.error(data.message || "Erro ao carregar afiliados.");
        return;
      }
      setAffiliates(data.affiliates || []);
    } catch {
      toast.error("Erro ao carregar afiliados.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return affiliates;
    return affiliates.filter((row) =>
      row.name.toLowerCase().includes(q)
      || row.email.toLowerCase().includes(q)
      || (row.affiliateCode || "").toLowerCase().includes(q),
    );
  }, [affiliates, search]);

  const toggle = async (userId: string) => {
    if (expandedId === userId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(userId);
    if (details[userId]) return;
    setDetailLoadingId(userId);
    try {
      const res = await fetch(`${BASE}/api/admin/affiliates/${encodeURIComponent(userId)}`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({})) as { buyers?: AffiliateBuyer[]; message?: string };
      if (!res.ok) {
        toast.error(data.message || "Erro ao carregar compras do link.");
        setExpandedId(null);
        return;
      }
      setDetails((prev) => ({ ...prev, [userId]: data.buyers || [] }));
    } catch {
      toast.error("Erro ao carregar compras do link.");
      setExpandedId(null);
    } finally {
      setDetailLoadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Afiliados</h2>
          <p className="text-sm text-muted-foreground">
            Clientes com comissão liberada. O saldo disponível é o que ainda dá para usar no checkout.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou código..."
              className="h-10 pl-9 pr-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm w-72"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="h-10 px-3 rounded-xl border-2 border-border bg-white hover:bg-muted text-sm flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-border rounded-2xl">
          <p className="font-semibold text-foreground">
            {search ? "Nenhum afiliado encontrado." : "Nenhum cliente com saldo de afiliação ainda."}
          </p>
          {search && (
            <button type="button" onClick={() => setSearch("")} className="mt-2 text-sm text-primary hover:underline">
              Limpar busca
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 border-b border-border">
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">E-mail</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Código</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Liberado</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Usado</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Disponível</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => {
                const open = expandedId === row.userId;
                const buyers = details[row.userId];
                return (
                  <Fragment key={row.userId}>
                    <tr
                      className={`border-b border-border cursor-pointer hover:bg-muted/40 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}
                      onClick={() => void toggle(row.userId)}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        <span className="inline-flex items-center gap-2">
                          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                          {row.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.email || "—"}</td>
                      <td className="px-4 py-3">
                        {row.affiliateCode ? (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-mono font-semibold">{row.affiliateCode}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{formatCurrency(row.released)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{formatCurrency(row.used)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{formatCurrency(row.available)}</td>
                    </tr>
                    {open && (
                      <tr className="border-b border-border bg-slate-50">
                        <td colSpan={6} className="px-4 py-4">
                          {detailLoadingId === row.userId && !buyers ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Carregando compras do link...
                            </div>
                          ) : !buyers || buyers.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nenhuma compra pelo link deste afiliado.</p>
                          ) : (
                            <div className="space-y-3">
                              {buyers.map((buyer) => (
                                <div key={`${buyer.email}-${buyer.orders[0]?.id || buyer.name}`} className="rounded-xl border border-border bg-white p-3">
                                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                    <div>
                                      <p className="font-semibold text-foreground">{buyer.name}</p>
                                      <p className="text-xs text-muted-foreground">{buyer.email || "Sem e-mail"}{buyer.phone ? ` · ${buyer.phone}` : ""}</p>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {buyer.orderCount} pedido{buyer.orderCount === 1 ? "" : "s"} · {formatCurrency(buyer.totalSpent)} · comissão {formatCurrency(buyer.commissionTotal)}
                                    </p>
                                  </div>
                                  <div className="mt-2 space-y-1">
                                    {buyer.orders.map((order) => (
                                      <div key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                        <button
                                          type="button"
                                          className="font-semibold text-primary hover:underline"
                                          onClick={() => onOpenOrder(order.id, order.createdAt)}
                                        >
                                          {orderLabel(order)}
                                        </button>
                                        <span>{order.createdAt ? formatDateOnlyBR(order.createdAt) : "—"}</span>
                                        <span>{statusLabel(order.status)}</span>
                                        <span>{formatCurrency(order.total)}</span>
                                        {order.excludedSellerCode ? (
                                          <span className="font-semibold text-amber-800">Venda não contabilizada · cliente do vendedor {order.excludedSellerCode} do site</span>
                                        ) : (
                                          <span>comissão {formatCurrency(order.commissionAmount)}</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
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
