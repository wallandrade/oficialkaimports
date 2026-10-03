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
  adjustment: number;
  available: number;
};

type BalanceMode = "add" | "set" | "zero";

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
  const [balanceUserId, setBalanceUserId] = useState<string | null>(null);
  const [balanceMode, setBalanceMode] = useState<BalanceMode | null>(null);
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceReason, setBalanceReason] = useState("");
  const [balanceBusy, setBalanceBusy] = useState(false);

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

  const balanceRow = affiliates.find((row) => row.userId === balanceUserId) || null;

  const openBalance = (row: AffiliateRow, mode: BalanceMode) => {
    setBalanceUserId(row.userId);
    setBalanceMode(mode);
    setBalanceAmount(mode === "set" ? row.available.toFixed(2).replace(".", ",") : "");
    setBalanceReason("");
  };

  const closeBalance = () => {
    setBalanceUserId(null);
    setBalanceMode(null);
    setBalanceAmount("");
    setBalanceReason("");
  };

  const submitBalance = async () => {
    if (!balanceRow || !balanceMode) return;
    if (!balanceReason.trim()) {
      toast.error("Informe o motivo.");
      return;
    }
    setBalanceBusy(true);
    try {
      const res = await fetch(`${BASE}/api/admin/affiliates/${encodeURIComponent(balanceRow.userId)}/balance`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          mode: balanceMode,
          amount: balanceMode === "zero" ? undefined : balanceAmount.trim(),
          reason: balanceReason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string; available?: number };
      if (!res.ok) {
        toast.error(data.message || "Erro ao ajustar saldo.");
        return;
      }
      toast.success(`Saldo atualizado. Disponível: ${formatCurrency(Number(data.available || 0))}`);
      closeBalance();
      await load();
    } catch {
      toast.error("Erro ao ajustar saldo.");
    } finally {
      setBalanceBusy(false);
    }
  };

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
            Clientes com comissão liberada. Disponível = liberado − usado no checkout + ajuste. O checkout usa esse disponível.
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

      {balanceRow && balanceMode && (
        <form
          className="rounded-2xl border border-border bg-white p-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submitBalance();
          }}
        >
          <div>
            <p className="font-semibold text-foreground">
              {balanceMode === "add" ? "Adicionar saldo" : balanceMode === "set" ? "Editar saldo" : "Zerar saldo"}
              {" · "}
              {balanceRow.name}
            </p>
            <p className="text-sm text-muted-foreground">
              Disponível agora: {formatCurrency(balanceRow.available)}.
              {balanceMode === "add" && " O valor entra em cima desse saldo."}
              {balanceMode === "set" && " O disponível passa a ser o valor informado."}
              {balanceMode === "zero" && " O disponível vai para R$ 0,00."}
            </p>
          </div>
          {balanceMode !== "zero" && (
            <input
              value={balanceAmount}
              onChange={(event) => setBalanceAmount(event.target.value)}
              placeholder={balanceMode === "add" ? "Valor a somar" : "Saldo final"}
              inputMode="decimal"
              className="h-10 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm w-full sm:w-64"
            />
          )}
          <input
            value={balanceReason}
            onChange={(event) => setBalanceReason(event.target.value)}
            placeholder="Motivo"
            maxLength={255}
            className="h-10 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm w-full"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={balanceBusy}
              className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60"
            >
              {balanceBusy ? "Salvando..." : "Confirmar"}
            </button>
            <button
              type="button"
              onClick={closeBalance}
              className="h-10 px-4 rounded-xl border-2 border-border bg-white text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

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
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Ajuste</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Disponível</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Saldo</th>
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
                      <td className={`px-4 py-3 text-right whitespace-nowrap ${row.adjustment < 0 ? "text-rose-700" : row.adjustment > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                        {formatCurrency(row.adjustment || 0)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{formatCurrency(row.available)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            className="h-8 px-2 rounded-lg border border-border bg-white text-xs font-semibold hover:bg-muted"
                            onClick={() => openBalance(row, "add")}
                          >
                            Adicionar
                          </button>
                          <button
                            type="button"
                            className="h-8 px-2 rounded-lg border border-border bg-white text-xs font-semibold hover:bg-muted"
                            onClick={() => openBalance(row, "set")}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={row.available <= 0}
                            className="h-8 px-2 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                            onClick={() => openBalance(row, "zero")}
                          >
                            Zerar
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-border bg-slate-50">
                        <td colSpan={8} className="px-4 py-4">
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
