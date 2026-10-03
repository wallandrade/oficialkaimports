import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronDown, Menu, ShoppingBag, UserCircle2 } from "lucide-react";

export function PharmaStoreChrome({
  siteName,
  logo,
  sellerHomeHref,
  offersHref,
  search,
  isLoggedIn,
  itemCount,
  onOpenCart,
  onOpenMenu,
  categories,
  activeCategory,
  onSelectCategory,
}: {
  siteName: string;
  logo: string | null;
  sellerHomeHref: string;
  offersHref: string;
  search: ReactNode;
  isLoggedIn: boolean;
  itemCount: number;
  onOpenCart: () => void;
  onOpenMenu: () => void;
  categories: string[];
  activeCategory: string;
  onSelectCategory: (category: string) => void;
}) {
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const categoriesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!categoriesOpen) return;
    function handlePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (categoriesRef.current && !categoriesRef.current.contains(target)) {
        setCategoriesOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
    };
  }, [categoriesOpen]);

  return (
    <div className="ka-pharma-header sticky top-0 z-40 w-full border-b border-black/5 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-1.5">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-800">{siteName}</p>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2">
        <button
          type="button"
          className="md:hidden shrink-0 p-1.5 rounded-full text-neutral-700"
          onClick={onOpenMenu}
          aria-label="Menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link href={sellerHomeHref} className="shrink-0 flex items-center min-w-0 max-w-[34%]">
          {logo ? (
            <img src={logo} alt={siteName} className="h-9 w-auto max-w-[8.5rem] object-contain" />
          ) : (
            <span className="truncate text-sm font-bold text-neutral-900">{siteName}</span>
          )}
        </Link>
        <div className="flex-1 min-w-0">{search}</div>
        <Link
          href={isLoggedIn ? "/minha-conta/pedidos" : "/login"}
          className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 text-neutral-700"
          aria-label={isLoggedIn ? "Minha conta" : "Entrar"}
        >
          <UserCircle2 className="w-5 h-5" />
        </Link>
        <button
          type="button"
          onClick={onOpenCart}
          className="relative shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--pharma-cart,#111111)] text-white"
          aria-label="Carrinho"
        >
          <ShoppingBag className="w-5 h-5" />
          {itemCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--pharma-green,#22c55e)] px-1 text-[10px] font-bold text-white">
              {itemCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2.5">
        <div ref={categoriesRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setCategoriesOpen((open) => !open)}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-[var(--pharma-green,#22c55e)] px-3.5 text-sm font-semibold text-white"
            aria-expanded={categoriesOpen}
          >
            Categorias
            <ChevronDown className={`w-4 h-4 transition-transform ${categoriesOpen ? "rotate-180" : ""}`} />
          </button>
          {categoriesOpen && (
            <div className="absolute left-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto rounded-2xl border border-black/5 bg-white p-2 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  onSelectCategory("");
                  setCategoriesOpen(false);
                }}
                className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${activeCategory ? "text-neutral-700 hover:bg-neutral-50" : "bg-[var(--pharma-green,#22c55e)] text-white"}`}
              >
                Todos os produtos
              </button>
              {categories.map((category) => {
                const selected = activeCategory === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => {
                      onSelectCategory(selected ? "" : category);
                      setCategoriesOpen(false);
                    }}
                    className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ${selected ? "bg-[var(--pharma-green,#22c55e)] font-semibold text-white" : "text-neutral-700 hover:bg-neutral-50"}`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Link
          href={offersHref}
          className="shrink-0 inline-flex h-9 items-center rounded-full bg-[var(--pharma-green-soft,#e8f8ee)] px-3 text-sm font-semibold text-[var(--pharma-green-ink,#166534)]"
        >
          🔥 Promoções 🔥
        </Link>

        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {categories.map((category) => {
            const selected = activeCategory === category;
            return (
              <button
                key={`chip-${category}`}
                type="button"
                onClick={() => onSelectCategory(selected ? "" : category)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${selected ? "border-[var(--pharma-green,#22c55e)] text-[var(--pharma-green-ink,#166534)]" : "border-neutral-200 bg-white text-neutral-700"}`}
              >
                {category}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
