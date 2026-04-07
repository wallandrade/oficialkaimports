import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, cn } from "@/lib/utils";
import { Loader2, Search, Ticket, CheckCircle2, Clock, AlertCircle, Copy } from "lucide-react";
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
  expiresAt: string;
  pixCode: string | null;
  pixBase64: string | null;
  transactionId: string | null;
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
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ReservationRow[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) {
      toast.error("Digite ao menos 8 dígitos do telefone.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/raffles/reservations/lookup?phone=${encodeURIComponent(digits)}`);
      const data = await res.json() as ReservationRow[];
      setResults(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function copyCode(code: string, id: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      toast.success("Código PIX copiado!");
      setTimeout(() => setCopiedId(null), 3000);
    });
  }

  return (
    <AppLayout>
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Search className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Consultar Reserva</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Informe seu número de telefone para ver suas reservas e pagamentos.
        </p>

        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="lookup-phone" className="sr-only">Telefone</Label>
            <Input
              id="lookup-phone"
              type="tel"
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buscar"}
          </Button>
        </form>

        {results !== null && results.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            <Ticket className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>Nenhuma reserva encontrada para este telefone.</p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="space-y-4">
            {results.map((row) => (
              <div key={row.id} className="border border-border rounded-2xl p-4 bg-card space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{row.raffleTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <StatusBadge status={row.status} isExpired={row.isExpired} />
                </div>

                <div className="bg-muted rounded-lg p-2 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Números</span>
                    <span className="font-semibold text-foreground">{row.numbers.join(", ")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold text-foreground">{formatCurrency(Number(row.totalAmount))}</span>
                  </div>
                  {row.status === "reserved" && !row.isExpired && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expira em</span>
                      <span className="text-amber-600 font-semibold">
                        {new Date(row.expiresAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Show PIX code if reserved and not expired */}
                {row.status === "reserved" && !row.isExpired && row.pixCode && (
                  <div className="space-y-2">
                    {row.pixBase64 && (
                      <div className="flex justify-center">
                        <img
                          src={`data:image/png;base64,${row.pixBase64}`}
                          alt="QR Code"
                          className="w-36 h-36 rounded-lg border border-border"
                        />
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn("w-full gap-2", copiedId === row.id && "border-green-500 text-green-600")}
                      onClick={() => copyCode(row.pixCode!, row.id)}
                    >
                      {copiedId === row.id ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copiedId === row.id ? "Copiado!" : "Copiar código PIX"}
                    </Button>
                    <p className="text-xs text-muted-foreground break-all font-mono">{row.pixCode}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="text-center">
          <Button variant="ghost" className="text-sm text-muted-foreground" onClick={() => setLocation("/rifas")}>
            Ver rifas disponíveis
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
