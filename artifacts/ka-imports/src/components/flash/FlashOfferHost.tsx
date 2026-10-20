import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useCart } from "@/store/use-cart";
import { formatCurrency } from "@/lib/utils";
import {
  claimFlashOffer,
  clearStoredFlashOffer,
  drawFlashOffer,
  fetchFlashWaitSeconds,
  readActiveFlashOffer,
  releaseFlashOffer,
  type FlashDrawOffer,
  type StoredFlashOffer,
} from "@/lib/flash-offer";

function pageCanDraw(location: string): boolean {
  const path = location.split("?")[0] || "/";
  const blocked = ["/admin", "/checkout", "/pix", "/kyc", "/login", "/pagamento", "/payment-link", "/success", "/rifas", "/suporte"];
  return !blocked.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.includes("/checkout"));
}

function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function productHref(productId: string): string {
  const seller = (sessionStorage.getItem("sellerCode") || localStorage.getItem("sellerCode") || "").trim().toLowerCase();
  return seller ? `/${encodeURIComponent(seller)}/produto/${productId}` : `/produto/${productId}`;
}

export function FlashOfferHost() {
  const [location, setLocation] = useLocation();
  const addItem = useCart((state) => state.addItem);
  const items = useCart((state) => state.items);
  const clearExpiredFlash = useCart((state) => state.clearExpiredFlash);
  const [offer, setOffer] = useState<FlashDrawOffer | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [clock, setClock] = useState("");
  const attempted = useRef(false);
  const released = useRef("");

  const active = readActiveFlashOffer();
  const cartFlash = items.find((item) => item.isFlash && item.flashExpiresAt && new Date(item.flashExpiresAt).getTime() > Date.now());
  const countdownUntil = cartFlash?.flashExpiresAt || active?.expiresAt || "";

  const reservationInCart = useRef("");

  useEffect(() => {
    if (!countdownUntil) return;
    setClock(formatRemaining(countdownUntil));
    const timer = window.setInterval(() => {
      if (new Date(countdownUntil).getTime() <= Date.now()) {
        const reservationId = cartFlash?.flashReservationId || active?.reservationId || "";
        if (reservationId && released.current !== reservationId) {
          released.current = reservationId;
          void releaseFlashOffer(reservationId);
        }
        clearStoredFlashOffer();
        clearExpiredFlash();
      }
      setClock(formatRemaining(countdownUntil));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdownUntil, cartFlash?.flashReservationId, active?.reservationId, clearExpiredFlash]);

  useEffect(() => {
    const current = items.find((item) => item.flashReservationId)?.flashReservationId || "";
    const previous = reservationInCart.current;
    reservationInCart.current = current;
    if (!previous || previous === current || released.current === previous) return;
    released.current = previous;
    clearStoredFlashOffer();
    void releaseFlashOffer(previous);
  }, [items]);

  useEffect(() => {
    if (attempted.current || !pageCanDraw(location) || readActiveFlashOffer()) return;
    let timer = 0;
    let cancelled = false;
    void fetchFlashWaitSeconds().then((seconds) => {
      if (cancelled || seconds == null || attempted.current || !pageCanDraw(window.location.pathname)) return;
      timer = window.setTimeout(() => {
        if (attempted.current || !pageCanDraw(window.location.pathname)) return;
        attempted.current = true;
        void drawFlashOffer().then((drawn) => {
          if (drawn) setOffer(drawn);
        }).catch(() => undefined);
      }, seconds * 1000);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [location]);

  const accept = async () => {
    if (!offer || claiming) return;
    setClaiming(true);
    try {
      const claimed: StoredFlashOffer = await claimFlashOffer(offer);
      setOffer(null);
      if (claimed.needsVariants) {
        toast.success("Oferta reservada por 1 hora. Escolha as opções e adicione ao carrinho.");
        setLocation(productHref(claimed.productId));
        return;
      }
      addItem({
        id: claimed.productId,
        name: claimed.name,
        price: claimed.regularPrice,
        image: claimed.image,
      } as Parameters<typeof addItem>[0], { quantity: 1, unitPrice: claimed.unitPrice });
      toast.success("Oferta no carrinho. Você tem 1 hora para finalizar.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Essa oferta não está mais disponível.");
      setOffer(null);
    } finally {
      setClaiming(false);
    }
  };

  const isAdmin = location.startsWith("/admin");

  return (
    <>
      {!isAdmin && offer && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <p className="text-center text-xs font-bold uppercase tracking-wide text-orange-600">Promoção relâmpago</p>
            <h2 className="mt-1 text-center text-2xl font-black text-neutral-950">Essa oferta é sua</h2>
            <p className="mt-1 text-center text-sm text-neutral-600">Aparece uma vez. Se aceitar, tem 1 hora para pagar no PIX ou no WhatsApp.</p>
            <div className="mt-4 flex gap-3 rounded-2xl border border-orange-100 bg-orange-50 p-3">
              {offer.image && <img src={offer.image} alt="" className="h-20 w-20 rounded-xl object-cover" />}
              <div className="min-w-0">
                <p className="font-semibold leading-tight text-neutral-950">{offer.name}</p>
                <p className="mt-1 text-sm text-neutral-400 line-through">{formatCurrency(offer.regularPrice)}</p>
                <p className="text-2xl font-black text-orange-600">{formatCurrency(offer.flashPrice)}</p>
              </div>
            </div>
            <button
              type="button"
              disabled={claiming}
              onClick={() => void accept()}
              className="mt-4 h-12 w-full rounded-xl bg-orange-500 text-base font-bold text-white disabled:opacity-60"
            >
              {claiming ? "Reservando..." : "Quero essa oferta"}
            </button>
            <button
              type="button"
              disabled={claiming}
              onClick={() => setOffer(null)}
              className="mt-2 h-10 w-full text-sm font-medium text-neutral-500"
            >
              Agora não
            </button>
          </div>
        </div>
      )}
      {!isAdmin && countdownUntil && clock && (
        <div className="fixed bottom-4 left-1/2 z-[70] w-[min(100%-2rem,28rem)] -translate-x-1/2 rounded-full bg-neutral-950 px-4 py-2 text-center text-sm font-semibold text-white shadow-xl">
          Oferta relâmpago acaba em {clock}
        </div>
      )}
    </>
  );
}
