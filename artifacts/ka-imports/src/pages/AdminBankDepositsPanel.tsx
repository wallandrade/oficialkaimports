import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Landmark, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDateBR } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Props = {
  authHeaders: () => HeadersInit;
  onUnauthorized: () => void;
  onGoToOrder?: (orderId: string) => void;
};

type DepositRow = {
  orderId: string;
  orderNumber: number | null;
  clientName: string;
  clientPhone?: string | null;
  orderTotal: number;
  orderStatus: string;
  paymentMethod: string;
  sellerCode?: string | null;
  orderCreatedAt: string | null;
  matchStatus: string | null;
  fitid: string | null;
  amount: number | null;
  payerName: string | null;
  postedAt: string | null;
  matchedAt: string | null;
};

function formatYmd(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

export default function AdminBankDepositsPanel({ authHeaders, onUnauthorized, onGoToOrder }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<"confirmed_100" | "ok" | "all">("confirmed_100");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${BASE}/api/admin/bank-deposits?status=${encodeURIComponent(statusFilter)}&limit=300`,
        { headers: authHeaders() },
      );
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = (await res.json()) as { deposits?: DepositRow[]; message?: string };
      if (!res.ok) {
        toast.error(data.message || "Erro ao carregar depósitos.");
        return;
      }
      setRows(data.deposits || []);
    } catch {
      toast.error("Erro ao carregar histórico de depósitos.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onUnauthorized, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Depósitos confirmados</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Histórico salvo no banco (não some ao atualizar). Vem do Extrato OFX após aplicar. FITID repetido
                no próximo OFX é ignorado automaticamente.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "confirmed_100" | "ok" | "all")}
              className="rounded-xl border border-border bg-white px-3 py-2 text-sm"
            >
              <option value="confirmed_100">Só 100%</option>
              <option value="ok">Só OK (revisados)</option>
              <option value="all">100% + OK</option>
            </select>
            <Button variant="outline" className="gap-2" disabled={loading} onClick={() => void load()}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Atualizar
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Nenhum depósito salvo ainda. Vá em Extrato → Analisar → Aplicar só 100%.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3">Pedido</th>
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3">Valor</th>
                  <th className="py-2 pr-3">Pagou em</th>
                  <th className="py-2 pr-3">Nome no extrato</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Aplicado em</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.orderId}-${r.fitid}`} className="border-b border-border/50">
                    <td className="py-2.5 pr-3">
                      <button
                        type="button"
                        className="text-primary font-semibold hover:underline"
                        onClick={() => onGoToOrder?.(r.orderId)}
                      >
                        #{r.orderNumber ?? r.orderId.slice(0, 8)}
                      </button>
                      <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[140px]">
                        {r.fitid || "—"}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">{r.clientName}</td>
                    <td className="py-2.5 pr-3 font-semibold">
                      {formatCurrency(r.amount ?? r.orderTotal)}
                    </td>
                    <td className="py-2.5 pr-3">{formatYmd(r.postedAt)}</td>
                    <td className="py-2.5 pr-3">{r.payerName || "—"}</td>
                    <td className="py-2.5 pr-3">
                      {r.matchStatus === "confirmed_100" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-bold">
                          <CheckCircle2 className="w-3 h-3" />
                          100%
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold border border-emerald-200">
                          OK
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-muted-foreground">
                      {r.matchedAt ? formatDateBR(r.matchedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-3">{rows.length} registro(s)</p>
          </div>
        )}
      </div>
    </div>
  );
}
