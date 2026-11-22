import { useEffect, useLayoutEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useCart } from "@/store/use-cart";
import { formatCurrency } from "@/lib/utils";
import {
  cartAddedNoticeDismissMs,
  cartAddedNoticeTopPx,
  readSafeAreaTopPx,
  shouldShowCartAddedNotice,
} from "./pharma-added-notice";

function useAddedNoticeTop(active: boolean): number {
  const [top, setTop] = useState(0);

  useLayoutEffect(() => {
    if (!active) return;

    let safeTop = readSafeAreaTopPx();
    const measure = () => {
      const header = document.querySelector<HTMLElement>(".ka-pharma-header, .ka-main-header");
      const headerBottom = header ? header.getBoundingClientRect().bottom : 64;
      const next = cartAddedNoticeTopPx(headerBottom, safeTop);
      setTop((current) => (current === next ? current : next));
    };

    measure();
    const header = document.querySelector<HTMLElement>(".ka-pharma-header, .ka-main-header");
    const observer = typeof ResizeObserver === "undefined" || !header
      ? null
      : new ResizeObserver(measure);
    if (header && observer) observer.observe(header);
    const onResize = () => {
      safeTop = readSafeAreaTopPx();
      measure();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", measure);
    };
  }, [active]);

  return top;
}

export function PharmaAddedNotice() {
  const notice = useCart((state) => state.addedNotice);
  const isOpen = useCart((state) => state.isOpen);
  const items = useCart((state) => state.items);
  const setIsOpen = useCart((state) => state.setIsOpen);
  const clearAddedNotice = useCart((state) => state.clearAddedNotice);
  const getSubtotal = useCart((state) => state.getSubtotal);
  const visible = shouldShowCartAddedNotice(notice != null, isOpen);
  const top = useAddedNoticeTop(visible);

  useEffect(() => {
    if (!isOpen || notice == null) return;
    clearAddedNotice();
  }, [isOpen, notice, clearAddedNotice]);

  useEffect(() => {
    if (!visible || notice == null) return;
    const timeoutId = window.setTimeout(
      () => clearAddedNotice(),
      cartAddedNoticeDismissMs(window.innerWidth),
    );
    return () => window.clearTimeout(timeoutId);
  }, [visible, notice, clearAddedNotice]);

  if (!visible || notice == null) return null;

  const count = items.reduce((total, item) => total + item.quantity, 0);
  const countLabel = count === 1 ? "1 item" : `${count} itens`;
  const topCss = top > 0
    ? `${top}px`
    : "max(7.75rem, calc(env(safe-area-inset-top, 0px) + 0.75rem))";

  return (
    <div
      className="ka-added-notice pointer-events-none fixed z-[45] flex justify-center"
      style={{
        top: topCss,
        left: "max(0.75rem, env(safe-area-inset-left, 0px))",
        right: "max(0.75rem, env(safe-area-inset-right, 0px))",
      }}
    >
      <div
        role="status"
        aria-live="polite"
        className="ka-added-notice-in pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl md:gap-3 md:p-3"
      >
        {notice.image ? (
          <img src={notice.image} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-neutral-50 object-contain md:h-12 md:w-12" />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-lg bg-neutral-100 md:h-12 md:w-12" />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--pharma-green-strong,#16a34a)]">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Adicionado · {notice.quantity}X
          </p>
          <p className="truncate text-sm font-bold text-neutral-900">{notice.name}</p>
          <p className="hidden text-xs text-neutral-500 md:block">{countLabel} · {formatCurrency(getSubtotal())}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            clearAddedNotice();
            setIsOpen(true);
          }}
          className="shrink-0 whitespace-nowrap rounded-full bg-[var(--pharma-green,#22c55e)] px-2.5 py-1.5 text-[11px] font-semibold text-white md:px-3 md:py-2 md:text-xs"
        >
          Ver carrinho
        </button>
        <button type="button" onClick={clearAddedNotice} aria-label="Fechar aviso" className="shrink-0 text-neutral-400">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
