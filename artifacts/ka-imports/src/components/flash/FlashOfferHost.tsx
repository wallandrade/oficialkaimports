import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useCart } from "@/store/use-cart";
import { formatCurrency } from "@/lib/utils";
import {
  claimFlashOffer,
  drawFlashOffer,
  fetchFlashWaitSeconds,
  readActiveFlashOffers,
  readStoredFlashOffers,
  releaseFlashOffer,
  removeStoredFlashOffer,
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
  const [offers, setOffers] = useState<FlashDrawOffer[]>([]);
  const [index, setIndex] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [holdOffers, setHoldOffers] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState("");
  const reservationIdsInCart = useRef<Set<string> | null>(null);

  const activeOffers = readActiveFlashOffers();
  const cartFlashes = items.filter((item) => item.isFlash && item.flashExpiresAt && new Date(item.flashExpiresAt).getTime() > Date.now());
  const countdownUntil = [...cartFlashes.map((item) => item.flashExpiresAt || ""), ...activeOffers.map((offer) => offer.expiresAt)]
    .filter(Boolean)
    .sort()[0] || "";

  useEffect(() => {
    if (holdOffers && !location.includes("/produto/")) setHoldOffers(false);
  }, [location, holdOffers]);

  useEffect(() => {
    if (!countdownUntil) return;
    const releaseExpired = () => {
      const now = Date.now();
      for (const offer of readStoredFlashOffers()) {
        if (new Date(offer.expiresAt).getTime() > now) continue;
        removeStoredFlashOffer(offer.reservationId);
        void releaseFlashOffer(offer.reservationId);
      }
      clearExpiredFlash();
      setClock(formatRemaining(countdownUntil));
    };
    releaseExpired();
    const timer = window.setInterval(releaseExpired, 1000);
    return () => window.clearInterval(timer);
  }, [countdownUntil, clearExpiredFlash]);

  useEffect(() => {
    const current = new Set(items.map((item) => item.flashReservationId).filter((id): id is string => Boolean(id)));
    const previous = reservationIdsInCart.current;
    reservationIdsInCart.current = current;
    if (!previous) return;
    for (const id of previous) {
      if (current.has(id)) continue;
      removeStoredFlashOffer(id);
      void releaseFlashOffer(id);
    }
  }, [items]);

  useEffect(() => {
    if (!pageCanDraw(location)) return;
    let timer = 0;
    let cancelled = false;
    void fetchFlashWaitSeconds().then((seconds) => {
      if (cancelled || seconds == null || !pageCanDraw(window.location.pathname)) return;
      timer = window.setTimeout(() => {
        if (cancelled || !pageCanDraw(window.location.pathname)) return;
        void drawFlashOffer().then((drawn) => {
          if (cancelled || drawn.length === 0) return;
          setIndex(0);
          setOffers(drawn);
        }).catch(() => undefined);
      }, seconds * 1000);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [location]);

  const visibleOffer = (): FlashDrawOffer | null => {
    if (offers.length === 0) return null;
    const el = scrollerRef.current;
    if (!el) return offers[index] ?? offers[0] ?? null;
    const width = el.clientWidth || 1;
    const current = Math.min(offers.length - 1, Math.max(0, Math.round(el.scrollLeft / width)));
    return offers[current] ?? null;
  };

  const scrollToIndex = (next: number) => {
    const el = scrollerRef.current;
    if (!el || offers.length === 0) return;
    const clamped = Math.min(offers.length - 1, Math.max(0, next));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    setIndex(clamped);
  };

  const syncIndex = () => {
    const el = scrollerRef.current;
    if (!el || offers.length === 0) return;
    const width = el.clientWidth || 1;
    const next = Math.min(offers.length - 1, Math.max(0, Math.round(el.scrollLeft / width)));
    setIndex((current) => (current === next ? current : next));
  };

  const accept = async () => {
    const offer = visibleOffer();
    if (!offer || claiming) return;
    setClaiming(true);
    try {
      const claimed: StoredFlashOffer = await claimFlashOffer(offer);
      const nextOffers = offers.filter((item) => !(item.campaignId === offer.campaignId && item.productId === offer.productId));
      const nextIndex = Math.min(index, Math.max(0, nextOffers.length - 1));
      setOffers(nextOffers);
      setIndex(nextIndex);
      requestAnimationFrame(() => {
        const el = scrollerRef.current;
        if (!el) return;
        el.scrollTo({ left: nextIndex * el.clientWidth });
      });
      if (claimed.needsVariants) {
        setHoldOffers(true);
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
      toast.success(offers.length > 1 ? "Oferta no carrinho. As outras continuam aqui." : "Oferta no carrinho. Você tem 1 hora para finalizar.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Essa oferta não está mais disponível.");
      if (offer) {
        setOffers((current) => current.filter((item) => !(item.campaignId === offer.campaignId && item.productId === offer.productId)));
      }
    } finally {
      setClaiming(false);
    }
  };

  const isAdmin = location.startsWith("/admin");
  const several = offers.length > 1;

  return (
    <>
      {!isAdmin && !holdOffers && offers.length > 0 && (
        <div className="fixed inset-0 z-[80] flex h-dvh max-h-dvh overflow-y-auto overscroll-contain bg-black/55 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="m-auto w-full max-w-[22.5rem] rounded-[1.75rem] bg-white px-4 pb-3 pt-4 shadow-2xl">
            <p className="text-center text-[10px] font-bold uppercase tracking-[0.08em] text-orange-500">
              Promoção relâmpago{several ? ` · ${index + 1} de ${offers.length}` : ""}
            </p>
            <h2 className="mt-0.5 text-center text-[1.45rem] font-extrabold leading-tight tracking-tight text-neutral-950">Essa oferta é sua</h2>
            <p className="mx-auto mt-1 max-w-[16.5rem] text-center text-[13px] leading-[1.35] text-neutral-500">
              Aparece uma vez. Se aceitar, tem 1 hora para pagar no PIX ou no WhatsApp.
            </p>
            <div className="mt-3">
              <div
                ref={scrollerRef}
                onScroll={syncIndex}
                className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {offers.map((item) => (
                  <div key={`${item.campaignId}-${item.productId}`} className="w-full shrink-0 snap-center">
                    <div className="rounded-2xl border border-neutral-200 bg-white px-2 pb-2.5 pt-2">
                      <div className="relative">
                        {item.image
                          ? <img src={item.image} alt="" className="mx-auto block h-auto w-full object-contain" />
                          : <div className="h-36 w-full rounded-xl bg-neutral-100" />}
                        {several && (
                          <>
                            <button
                              type="button"
                              aria-label="Oferta anterior"
                              disabled={claiming || index === 0}
                              onClick={() => scrollToIndex(index - 1)}
                              className="absolute left-0 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-orange-500 shadow-md disabled:opacity-40"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="Próxima oferta"
                              disabled={claiming || index >= offers.length - 1}
                              onClick={() => scrollToIndex(index + 1)}
                              className="absolute right-0 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-orange-500 shadow-md disabled:opacity-40"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                      <p className="mt-1.5 text-center text-[13px] font-medium leading-snug text-neutral-800">{item.name}</p>
                      <p className="mt-0.5 text-center text-[13px] leading-none text-neutral-400 line-through">{formatCurrency(item.regularPrice)}</p>
                      <p className="mt-0.5 text-center text-[1.7rem] font-extrabold leading-none text-orange-500">{formatCurrency(item.flashPrice)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {several && (
              <div className="mt-2.5 flex items-center justify-center gap-1">
                {offers.map((item, dot) => (
                  <button
                    key={`${item.campaignId}-${item.productId}-dot`}
                    type="button"
                    aria-label={`Oferta ${dot + 1} de ${offers.length}`}
                    onClick={() => scrollToIndex(dot)}
                    className={`h-1.5 rounded-full ${dot === index ? "w-3.5 bg-orange-500" : "w-1.5 bg-neutral-300"}`}
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={claiming}
              onClick={() => void accept()}
              className="mt-3 h-11 w-full rounded-full bg-orange-500 text-[15px] font-bold text-white disabled:opacity-60"
            >
              {claiming ? "Reservando..." : "Quero essa oferta"}
            </button>
            <button
              type="button"
              disabled={claiming}
              onClick={() => setOffers([])}
              className="mt-0.5 h-9 w-full text-[13px] font-medium text-neutral-400"
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
