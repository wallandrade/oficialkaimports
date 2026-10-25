import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Copy, CheckCircle2, Clock, AlertCircle, Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type StoredRafflePix = {
  reservationId: string;
  transactionId: string;
  pixCode: string;
  pixBase64: string;
  totalAmount: number;
  expiresAt: string;
  pixExpiresAt: string;
  raffleTitle: string;
  numbers: number[];
  clientName: string;
  clientPhone: string;
};

type ReservationStatus = "reserved" | "paid" | "expired" | null;

export default function RafflePix() {
  const [, params] = useRoute("/rifas/pix/:id");
  const reservationId = params?.id ?? "";
  const [, setLocation] = useLocation();

  const [pix, setPix] = useState<StoredRafflePix | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [status, setStatus] = useState<ReservationStatus>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!reservationId) return;
    const raw = sessionStorage.getItem(`raffle_pix_${reservationId}`);
    if (raw) {
      try { setPix(JSON.parse(raw) as StoredRafflePix); } catch { /* ignore */ }
    }
  }, [reservationId]);

  // Countdown
  useEffect(() => {
    if (!pix) return;
    const expiry = new Date(pix.pixExpiresAt).getTime();
    function tick() {
      const diff = expiry - Date.now();
      setTimeLeft(Math.max(0, Math.floor(diff / 1000)));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pix]);

  // Reads this reservation in the store DB. The webhook is what marks it paid.
  useEffect(() => {
    if (!reservationId) return;
    let timer = 0;
    let stopped = false;

    async function checkStatus() {
      if (stopped) return;
      try {
        const res = await fetch(
          `${BASE}/api/raffles/reservations/${encodeURIComponent(reservationId)}/status`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        const next = data.status;
        if (next !== "paid" && next !== "reserved" && next !== "expired") return;
        setStatus(next);
        if (next === "paid") {
          sessionStorage.removeItem(`raffle_pix_${reservationId}`);
        }
        if (next === "paid" || next === "expired") {
          stopped = true;
          window.clearInterval(timer);
        }
      } catch { /* ignore */ }
    }

    void checkStatus();
    timer = window.setInterval(() => { void checkStatus(); }, 2_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [reservationId]);

  function copyCode() {
    if (!pix?.pixCode) return;
    navigator.clipboard.writeText(pix.pixCode).then(() => {
      setIsCopied(true);
      setAwaitingPayment(true);
      toast.success("Código PIX copiado!");
      setTimeout(() => setIsCopied(false), 3000);
    });
  }

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  if (!pix) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p>Carregando dados do PIX…</p>
        </div>
      </AppLayout>
    );
  }

  if (status === "paid") {
    return (
      <AppLayout>
        <div className="max-w-sm mx-auto px-4 py-16 text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
          <h2 className="text-2xl font-bold text-foreground">PIX pago</h2>
          <p className="text-muted-foreground">
            Pagamento confirmado. Seus números estão garantidos na rifa <strong>{pix.raffleTitle}</strong>!
          </p>
          <p className="text-sm text-muted-foreground">
            Números: <strong>{pix.numbers.join(", ")}</strong>
          </p>
          <Button onClick={() => setLocation("/rifas")} className="w-full">
            Ver mais rifas
          </Button>
        </div>
      </AppLayout>
    );
  }

  const expired = status === "expired" || (timeLeft !== null && timeLeft === 0);

  return (
    <AppLayout>
      <div className="max-w-sm mx-auto px-4 py-8 space-y-5">
        <div className="text-center">
          <Ticket className="w-8 h-8 text-primary mx-auto mb-2" />
          <h2 className="text-xl font-bold text-foreground">Pague com PIX</h2>
          <p className="text-sm text-muted-foreground">{pix.raffleTitle}</p>
        </div>

        {/* Timer */}
        <div className={`flex items-center justify-center gap-2 text-sm font-semibold ${expired ? "text-red-500" : "text-amber-600"}`}>
          {expired ? <AlertCircle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
          {expired
            ? "PIX expirado. Volte e reserve novamente."
            : `PIX expira em ${formatTime(timeLeft ?? 0)}`}
        </div>

        {/* Summary */}
        <div className="bg-muted rounded-xl p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Números</span>
            <span className="font-semibold text-foreground">{pix.numbers.join(", ")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="font-bold text-foreground">{formatCurrency(pix.totalAmount)}</span>
          </div>
        </div>

        {/* QR Code */}
        {pix.pixBase64 && !expired && (
          <div className="flex justify-center">
            <img
              src={`data:image/png;base64,${pix.pixBase64}`}
              alt="QR Code PIX"
              className="w-48 h-48 rounded-xl border border-border"
            />
          </div>
        )}

        {/* Copy button */}
        {!expired && (
          <Button onClick={copyCode} variant="outline" className="w-full gap-2">
            {isCopied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            {isCopied ? "Copiado!" : "Copiar código PIX"}
          </Button>
        )}

        {pix.pixCode && !expired && (
          <div className="bg-muted rounded-lg p-2">
            <p className="text-xs text-muted-foreground break-all font-mono">{pix.pixCode}</p>
          </div>
        )}

        {!expired && (
          <p className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            {awaitingPayment ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                Aguardando pagamento…
              </>
            ) : (
              "Copie o código PIX e pague no app do banco"
            )}
          </p>
        )}
      </div>
    </AppLayout>
  );
}
