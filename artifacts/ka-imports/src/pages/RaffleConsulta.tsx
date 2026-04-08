import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, cn } from "@/lib/utils";
import { Loader2, Search, Ticket, CheckCircle2, Clock, AlertCircle, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ReservationRow = {
  id: string;
  raffleId: string;
  raffleTitle: string;
  numbers: number[];
  clientName: string;
  clientPhone: string;
  totalAmount: string;
  status: "reserved" | "paid" | "expired";
  isExpired: boolean;
  isPixExpired: boolean;
  expiresAt: string;
  pixCode: string | null;
  pixBase64: string | null;
  pixExpiresAt: string | null;
  transactionId: string | null;
  clientDocument: string | null;
  createdAt: string;
};

function StatusBadge({ status, isExpired }: { status: string; isExpired: boolean }) {
  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
        <CheckCircle2 className="w-3 h-3" /> Pago
      </span>
    );
  }
  if (status === "expired" || isExpired) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
        <AlertCircle className="w-3 h-3" /> Expirado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold">
      <Clock className="w-3 h-3" /> Reservado
    </span>
  );
}

export default function RaffleConsulta() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ReservationRow[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [refreshingPix, setRefreshingPix] = useState<string | null>(null);
  const [pendingCpf, setPendingCpf] = useState<Record<string, string>>({});

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const val = query.replace(/\D/g, "");
    if (val.length < 8) {
      toast.error("Digite ao menos 8 dígitos.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/raffles/reservations/lookup?query=${encodeURIComponent(val)}`);
      const data = await res.json() as ReservationRow[];
      setResults(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length === 0) {
        toast.info("Nenhuma reserva encontrada.");
      }
    } catch {
      toast.error("Erro ao buscar reservas.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshPix(reservationId: string, cpf?: string) {
    setRefreshingPix(reservationId);
    try {
      const body = cpf ? JSON.stringify({ document: cpf }) : undefined;
      const res = await fetch(`${BASE}/api/raffles/reservations/${reservationId}/refresh-pix`, {
        method: "POST",
        headers: cpf ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Erro ao gerar novo PIX.");
      }
      const data = await res.json() as { pixCode?: string; pixBase64?: string; pixExpiresAt?: string };
      setResults((prev) =>
        prev
          ? prev.map((r) =>
              r.id === reservationId
                ? { ...r, pixCode: data.pixCode ?? r.pixCode, pixBase64: data.pixBase64 ?? r.pixBase64, pixExpiresAt: data.pixExpiresAt ?? r.pixExpiresAt, isPixExpired: false, clientDocument: cpf ?? r.clientDocument }
                : r
            )
          : prev
      );
      setPendingCpf((prev) => { const next = { ...prev }; delete next[reservationId]; return next; });
      toast.success("Novo PIX gerado! Copie o código abaixo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao renovar PIX.");
    } finally {
      setRefreshingPix(null);
    }
  }

  async function handleCopy(code: string, id: string) {
    await navigator.clipboard.writeText(code);
    setCopiedId(id);
    toast.success("Código PIX copiado!");
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 3000);
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Consultar minhas cotas</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Digite seu telefone ou CPF para ver suas reservas.
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="query" className="sr-only">Telefone ou CPF</Label>
            <Input
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ex: 11999998888 ou 12345678900"
              inputMode="numeric"
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </Button>
        </form>

        {results !== null && results.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            <Ticket className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>Nenhuma reserva encontrada.</p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="space-y-4">
            {results.map((r) => {
              const reservationExpired = r.status === "expired" || r.isExpired;
              const canRefresh = r.status === "reserved" && !reservationExpired;
              const pixExpired = r.isPixExpired || !r.pixCode;
              return (
                <div key={r.id} className="border rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{r.raffleTitle}</p>
                      <p className="text-xs text-muted-foreground">{r.clientName}</p>
                    </div>
                    <StatusBadge status={r.status} isExpired={r.isExpired} />
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {r.numbers.map((n) => (
                      <span
                        key={n}
                        className="inline-block px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-mono font-semibold"
                      >
                        {String(n).padStart(4, "0")}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {r.numbers.length} cota{r.numbers.length !== 1 ? "s" : ""} · {formatCurrency(Number(r.totalAmount))}
                    </span>
                  </div>

                  {r.status === "paid" && (
                    <div className="flex items-center gap-1 text-green-700 text-sm font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      Pagamento confirmado!
                    </div>
                  )}

                  {canRefresh && (
                    <div className="space-y-2">
                      {pixExpired ? (
                        r.clientDocument ? (
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => handleRefreshPix(r.id)}
                            disabled={refreshingPix === r.id}
                          >
                            {refreshingPix === r.id ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <RefreshCw className="w-4 h-4 mr-2" />
                            )}
                            Gerar novo PIX para pagar
                          </Button>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">Digite seu CPF para gerar o PIX:</p>
                            <Input
                              placeholder="Somente números (11 dígitos)"
                              inputMode="numeric"
                              maxLength={14}
                              value={pendingCpf[r.id] ?? ""}
                              onChange={(e) => setPendingCpf((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            />
                            <Button
                              size="sm"
                              className="w-full"
                              disabled={refreshingPix === r.id || (pendingCpf[r.id] ?? "").replace(/\D/g, "").length !== 11}
                              onClick={() => handleRefreshPix(r.id, (pendingCpf[r.id] ?? "").replace(/\D/g, ""))}
                            >
                              {refreshingPix === r.id ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              ) : (
                                <RefreshCw className="w-4 h-4 mr-2" />
                              )}
                              Confirmar e gerar PIX
                            </Button>
                          </div>
                        )
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => handleCopy(r.pixCode!, r.id)}
                        >
                          <Copy className="w-4 h-4 mr-2" />
                          {copiedId === r.id ? "Copiado!" : "Copiar código PIX"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="text-center pt-4">
          <Button variant="ghost" className="text-sm text-muted-foreground" onClick={() => setLocation("/rifas")}>
            Ver rifas disponíveis
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}

