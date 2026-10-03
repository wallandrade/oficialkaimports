import { useEffect } from "react";
import { Check, X } from "lucide-react";
import { useCart } from "@/store/use-cart";
import { formatCurrency } from "@/lib/utils";

export function PharmaAddedNotice() {
  const notice = useCart((state) => state.addedNotice);
  const items = useCart((state) => state.items);
  const setIsOpen = useCart((state) => state.setIsOpen);
  const clearAddedNotice = useCart((state) => state.clearAddedNotice);
  const getSubtotal = useCart((state) => state.getSubtotal);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => clearAddedNotice(), 4500);
    return () => window.clearTimeout(timeoutId);
  }, [notice, clearAddedNotice]);

  if (!notice) return null;

  const count = items.reduce((total, item) => total + item.quantity, 0);
  const countLabel = count === 1 ? "1 item" : `${count} itens`;

  return (
    <div className="fixed bottom-4 left-3 right-3 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-xl">
      {notice.image ? (
        <img src={notice.image} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-neutral-50 object-contain" />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded-lg bg-neutral-100" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--pharma-green-strong,#16a34a)]">
          <Check className="h-3.5 w-3.5" />
          Adicionado · {notice.quantity}X
        </p>
        <p className="truncate text-sm font-bold text-neutral-900">{notice.name}</p>
        <p className="text-xs text-neutral-500">{countLabel} · {formatCurrency(getSubtotal())}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          clearAddedNotice();
          setIsOpen(true);
        }}
        className="shrink-0 rounded-full bg-[var(--pharma-green,#22c55e)] px-3 py-2 text-xs font-semibold text-white"
      >
        Ver carrinho
      </button>
      <button type="button" onClick={clearAddedNotice} aria-label="Fechar aviso" className="shrink-0 text-neutral-400">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
