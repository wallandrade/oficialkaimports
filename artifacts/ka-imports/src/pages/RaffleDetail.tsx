import { useEffect, useMemo, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, cn } from "@/lib/utils";
import { Loader2, Ticket, Info, Share2 } from "lucide-react";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type NumberStatus = "available" | "reserved" | "paid";

type Raffle = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  totalNumbers: number;
  pricePerNumber: string;
  reservationHours: number;
  status: string;
};

type RaffleDetailResponse = {
  raffle: Raffle;
  numberStatus: Record<number, NumberStatus>;
};

function RaffleNumberGrid({
  total,
  numberStatus,
  selected,
  onToggle,
}: {
  total: number;
  numberStatus: Record<number, NumberStatus>;
  selected: Set<number>;
  onToggle: (n: number) => void;
}) {
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(52px, 1fr))` }}
    >
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
        const status = numberStatus[n] ?? "available";
        const isSelected = selected.has(n);
        const isBlocked = status === "reserved" || status === "paid";

        return (
          <button
            key={n}
            disabled={isBlocked}
            onClick={() => onToggle(n)}
            className={cn(
              "h-10 w-full rounded-lg text-sm font-semibold border transition-all",
              isBlocked && status === "paid" && "bg-gray-400 border-gray-400 text-white cursor-not-allowed opacity-70",
              isBlocked && status === "reserved" && "bg-yellow-400 border-yellow-400 text-white cursor-not-allowed",
              !isBlocked && isSelected && "bg-green-500 border-green-500 text-white",
              !isBlocked && !isSelected && "bg-card border-border text-foreground hover:border-primary hover:bg-primary/10",
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

export default function RaffleDetail() {
  const [, params] = useRoute("/rifas/:id");
  const raffleId = params?.id ?? "";
  const [, setLocation] = useLocation();

  const [data, setData] = useState<RaffleDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Checkout form state
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!raffleId) return;
    setLoading(true);
    fetch(`${BASE}/api/raffles/${raffleId}`)
      .then((r) => r.json())
      .then((d) => setData(d as RaffleDetailResponse))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [raffleId]);

  function toggleNumber(n: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  const pricePerNumber = data ? Number(data.raffle.pricePerNumber) : 0;
  const total = useMemo(() => selected.size * pricePerNumber, [selected.size, pricePerNumber]);

  async function handleReserve() {
    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.error("Preencha nome, e-mail e telefone.");
      return;
    }
    if (selected.size === 0) {
      toast.error("Selecione ao menos um número.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/raffles/${raffleId}/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numbers: Array.from(selected).sort((a, b) => a - b),
          client: { name: name.trim(), email: email.trim(), phone: phone.trim() },
        }),
      });

      const json = await res.json() as {
        reservationId?: string;
        transactionId?: string;
        pixCode?: string;
        pixBase64?: string;
        totalAmount?: number;
        expiresAt?: string;
        pixExpiresAt?: string;
        error?: string;
        message?: string;
      };

      if (!res.ok) {
        toast.error(json.message || "Erro ao reservar números.");
        return;
      }

      // Save PIX data to sessionStorage for the PIX payment page
      sessionStorage.setItem(
        `raffle_pix_${json.reservationId}`,
        JSON.stringify({
          reservationId: json.reservationId,
          transactionId: json.transactionId,
          pixCode: json.pixCode,
          pixBase64: json.pixBase64,
          totalAmount: json.totalAmount,
          expiresAt: json.expiresAt,
          pixExpiresAt: json.pixExpiresAt,
          raffleTitle: data?.raffle.title,
          numbers: Array.from(selected).sort((a, b) => a - b),
          clientName: name.trim(),
          clientPhone: phone.trim(),
        }),
      );

      setLocation(`/rifas/pix/${json.reservationId}`);
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="text-center py-24 text-muted-foreground">
          <Ticket className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>Rifa não encontrada.</p>
        </div>
      </AppLayout>
    );
  }

  const { raffle, numberStatus } = data;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        {raffle.imageUrl && (
          <img
            src={raffle.imageUrl}
            alt={raffle.title}
            className="w-full max-h-72 object-cover rounded-2xl"
          />
        )}
        <div>
          <h1 className="text-2xl font-bold text-foreground">{raffle.title}</h1>
          {raffle.description && (
            <p className="text-muted-foreground mt-1 text-sm">{raffle.description}</p>
          )}
          <div className="flex gap-3 mt-2 text-sm text-muted-foreground">
            <span>{raffle.totalNumbers} números</span>
            <span>·</span>
            <span>{formatCurrency(Number(raffle.pricePerNumber))} por número</span>
            <span>·</span>
            <span>Reserva válida por {raffle.reservationHours}h</span>
          </div>
          <button
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            onClick={() => {
              const link = window.location.href;
              if (navigator.share) {
                navigator.share({ title: raffle.title, url: link }).catch(() => {});
              } else {
                navigator.clipboard.writeText(link);
                toast.success("Link copiado!");
              }
            }}
          >
            <Share2 className="w-3.5 h-3.5" /> Compartilhar rifa
          </button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded bg-card border border-border inline-block" /> Disponível
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded bg-green-500 inline-block" /> Selecionado
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded bg-yellow-400 inline-block" /> Reservado
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded bg-gray-400 inline-block" /> Pago
          </span>
        </div>

        {/* Number Grid */}
        <RaffleNumberGrid
          total={raffle.totalNumbers}
          numberStatus={numberStatus}
          selected={selected}
          onToggle={toggleNumber}
        />

        {/* Sticky bottom bar */}
        {selected.size > 0 && !showForm && (
          <div className="sticky bottom-4 z-10">
            <div className="bg-card border border-border rounded-2xl p-4 shadow-lg flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">
                  {selected.size} número{selected.size > 1 ? "s" : ""} selecionado{selected.size > 1 ? "s" : ""}
                </p>
                <p className="text-xl font-bold text-foreground">{formatCurrency(total)}</p>
              </div>
              <Button onClick={() => setShowForm(true)} size="lg" className="shrink-0">
                Reservar
              </Button>
            </div>
          </div>
        )}

        {/* Checkout form */}
        {showForm && (
          <div className="border border-border rounded-2xl p-5 bg-card space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Seus dados para a reserva</span>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="rf-name">Nome completo</Label>
                <Input
                  id="rf-name"
                  placeholder="Seu nome completo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rf-email">E-mail</Label>
                <Input
                  id="rf-email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rf-phone">Telefone (WhatsApp)</Label>
                <Input
                  id="rf-phone"
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="bg-muted rounded-xl p-3 text-sm text-muted-foreground">
              <p>
                Números selecionados:{" "}
                <span className="font-semibold text-foreground">
                  {Array.from(selected).sort((a, b) => a - b).join(", ")}
                </span>
              </p>
              <p className="mt-1">
                Total:{" "}
                <span className="font-bold text-foreground">{formatCurrency(total)}</span>
              </p>
              <p className="mt-1 text-xs">
                Reserva válida por {raffle.reservationHours}h após o pagamento PIX.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1" disabled={submitting}>
                Voltar
              </Button>
              <Button onClick={handleReserve} className="flex-1" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Gerar PIX
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
