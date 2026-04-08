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
  promotions?: Array<{
    id: string;
    quantity: number;
    promoPrice: string;
    isActive: number;
    sortOrder: number;
  }>;
  result?: {
    winnerNumber: number;
    winnerClientName: string | null;
    winnerClientPhone: string | null;
    drawnAt: string;
    notes: string | null;
  } | null;
  ranking?: Array<{
    clientName: string;
    clientPhone: string;
    totalNumbers: number;
    totalSpent: number;
    reservationCount: number;
  }>;
};

function maskPhone(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 4) return "";
  return `${d.slice(0, 2)}*****${d.slice(-2)}`;
}

function pickRandomAvailableNumbers(numberStatus: Record<number, NumberStatus>, total: number, quantity: number): number[] {
  const available: number[] = [];
  for (let i = 1; i <= total; i++) {
    if ((numberStatus[i] ?? "available") === "available") available.push(i);
  }
  if (available.length < quantity) return [];

  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, quantity).sort((a, b) => a - b);
}

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
  const [cpf, setCpf] = useState("");

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
  const selectedPromotion = useMemo(() => {
    if (!data?.promotions || selected.size === 0) return null;
    const candidates = data.promotions
      .filter((p) => Number(p.isActive) === 1 && p.quantity === selected.size)
      .sort((a, b) => Number(a.promoPrice) - Number(b.promoPrice));
    return candidates[0] ?? null;
  }, [data?.promotions, selected.size]);

  const total = useMemo(() => {
    if (selectedPromotion) return Number(selectedPromotion.promoPrice);
    return selected.size * pricePerNumber;
  }, [selected.size, pricePerNumber, selectedPromotion]);

  async function handleReserve() {
    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.error("Preencha nome, e-mail, telefone e CPF.");
      return;
    }
    const rawCpf = cpf.replace(/\D/g, "");
    if (rawCpf.length !== 11) {
      toast.error("CPF inválido. Preencha os 11 dígitos.");
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
          client: { name: name.trim(), email: email.trim(), phone: phone.trim(), cpf: rawCpf },
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
            <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
              <p className="max-w-prose text-sm leading-7 text-foreground/90 whitespace-pre-wrap break-words text-left">
                {raffle.description}
              </p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-xs sm:text-sm">
            <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-muted-foreground">
              {raffle.totalNumbers} números
            </span>
            <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-muted-foreground">
              {formatCurrency(Number(raffle.pricePerNumber))} por número
            </span>
            <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-muted-foreground">
              Reserva válida por {raffle.reservationHours}h
            </span>
          </div>
          <button
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
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

        {(data.result || (data.ranking && data.ranking.length > 0)) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border border-border rounded-2xl p-4 bg-card">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Resultado</p>
              {data.result ? (
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-muted-foreground">Número vencedor</p>
                  <p className="text-2xl font-bold text-primary">{data.result.winnerNumber}</p>
                  <p className="text-sm text-foreground font-medium">{data.result.winnerClientName || "Aguardando identificação"}</p>
                  {data.result.winnerClientPhone && (
                    <p className="text-xs text-muted-foreground">Telefone: {maskPhone(data.result.winnerClientPhone)}</p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">Resultado ainda não publicado.</p>
              )}
            </div>

            <div className="border border-border rounded-2xl p-4 bg-card">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top 3 compradores</p>
              {!data.ranking || data.ranking.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Sem compras pagas para ranking.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {data.ranking.map((r, i) => (
                    <div key={`${r.clientName}-${i}`} className="flex items-center justify-between rounded-lg bg-muted/40 px-2 py-1.5">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{i + 1}º {r.clientName}</p>
                        <p className="text-[11px] text-muted-foreground">{maskPhone(r.clientPhone)}</p>
                      </div>
                      <p className="text-sm font-bold text-primary">{r.totalNumbers} cotas</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {data.promotions && data.promotions.filter((p) => Number(p.isActive) === 1).length > 0 && (
          <div className="border border-border rounded-2xl p-4 bg-card space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Promoções de cotas</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.promotions
                .filter((p) => Number(p.isActive) === 1)
                .sort((a, b) => a.quantity - b.quantity)
                .map((promo) => {
                  const normalTotal = promo.quantity * pricePerNumber;
                  const promoTotal = Number(promo.promoPrice);
                  const savings = Math.max(0, normalTotal - promoTotal);
                  const selectedThisPromo = selected.size === promo.quantity;
                  return (
                    <button
                      key={promo.id}
                      type="button"
                      className={cn(
                        "text-left border rounded-xl p-3 transition-colors",
                        selectedThisPromo ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                      )}
                      onClick={() => {
                        const picks = pickRandomAvailableNumbers(numberStatus, raffle.totalNumbers, promo.quantity);
                        if (picks.length !== promo.quantity) {
                          toast.error("Não há números disponíveis suficientes para esta promoção.");
                          return;
                        }
                        setSelected(new Set(picks));
                        toast.success(`Promoção aplicada: ${promo.quantity} cotas.`);
                      }}
                    >
                      <p className="text-sm font-bold text-foreground">{promo.quantity} cotas por {formatCurrency(promoTotal)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Economia de {formatCurrency(savings)}
                      </p>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

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
                {selectedPromotion && (
                  <p className="text-xs text-green-600 font-semibold">
                    Promoção aplicada: {selectedPromotion.quantity} cotas
                  </p>
                )}
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
                  <div>
                    <Label htmlFor="rf-cpf">CPF</Label>
                    <Input
                      id="rf-cpf"
                      type="text"
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      maxLength={14}
                      value={cpf}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
                        const masked = digits
                          .replace(/^(\d{3})(\d)/, "$1.$2")
                          .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
                          .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
                        setCpf(masked);
                      }}
                    />
                  </div>
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
