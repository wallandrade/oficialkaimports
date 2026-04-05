import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ShoppingBag, Search, Menu, X, MessageCircle, Home, UserCircle2 } from "lucide-react";
import { getCustomerToken } from "@/lib/customer-auth";
import { useCart } from "@/store/use-cart";
import { Button } from "@/components/ui/button";
import { formatCurrency, getActiveWhatsApp } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ProductSuggestion {
  id: string;
  name: string;
  category: string;
  price: number;
  promoPrice: number | null;
  promoEndsAt: string | null;
  image: string | null;
}

function useSiteLogo() {
  const [logo, setLogo] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem("siteSettings") || "{}").logo ?? null; } catch { return null; }
  });
  useEffect(() => {
    fetch(`${BASE}/api/settings`)
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        localStorage.setItem("siteSettings", JSON.stringify(data));
        if (data.logo) setLogo(data.logo);
        else setLogo(null);
      })
      .catch(() => {});
  }, []);
  return logo;
}

function useProducts() {
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  useEffect(() => {
    fetch(`${BASE}/api/products`)
      .then((r) => r.json())
      .then((data: { products?: ProductSuggestion[] }) => {
        setProducts(data.products ?? []);
      })
      .catch(() => {});
  }, []);
  return products;
}

function SearchBar({
  searchValue,
  setSearchValue,
  onSearch,
  onSelectSuggestion,
  suggestions,
  showSuggestions,
  setShowSuggestions,
  inputRef,
  wrapperRef,
  className = "",
}: {
  searchValue: string;
  setSearchValue: (v: string) => void;
  onSearch: () => void;
  onSelectSuggestion: (name: string) => void;
  suggestions: ProductSuggestion[];
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  wrapperRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const [, setLocation] = useLocation();

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") onSearch();
    if (e.key === "Escape") { setShowSuggestions(false); setSearchValue(""); }
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative group">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors cursor-pointer z-10"
          onClick={onSearch}
        />
        <input
          ref={inputRef}
          type="text"
          value={searchValue}
          onChange={(e) => { setSearchValue(e.target.value); setShowSuggestions(true); }}
          onFocus={() => { if (searchValue.trim()) setShowSuggestions(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Buscar produtos..."
          className="w-full h-11 pl-10 pr-8 rounded-full bg-muted border-transparent focus:bg-white focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none border-2"
        />
        {searchValue && (
          <button
            onClick={() => { setSearchValue(""); setShowSuggestions(false); setLocation("/"); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-2xl shadow-xl overflow-hidden z-50">
          {suggestions.map((p) => {
            const promoActive = p.promoPrice && (!p.promoEndsAt || new Date() < new Date(p.promoEndsAt));
            const price = promoActive ? p.promoPrice! : p.price;
            return (
              <button
                key={p.id}
                onMouseDown={() => onSelectSuggestion(p.name)}
                onTouchEnd={(e) => { e.preventDefault(); onSelectSuggestion(p.name); }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/5 text-left transition-colors border-b border-border/40 last:border-0"
              >
                {p.image ? (
                  <img src={p.image} alt={p.name} className="w-9 h-9 rounded-lg object-cover shrink-0 border border-border" />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-muted shrink-0 border border-border" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.category}</p>
                </div>
                <span className="text-sm font-bold text-primary shrink-0">{formatCurrency(price)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Header({ minimal = false }: { minimal?: boolean }) {
  const { items, setIsOpen } = useCart();
  const [location, setLocation] = useLocation();
  const [searchValue, setSearchValue]         = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen]               = useState(false);

  const desktopInputRef  = useRef<HTMLInputElement>(null);
  const mobileInputRef   = useRef<HTMLInputElement>(null);
  const desktopWrapperRef = useRef<HTMLDivElement>(null);
  const mobileWrapperRef  = useRef<HTMLDivElement>(null);

  const itemCount = items.reduce((acc, item) => acc + item.quantity, 0);
  const isLoggedIn = Boolean(getCustomerToken());
  const logo = useSiteLogo();
  const allProducts = useProducts();
  const currentPath = typeof window !== "undefined"
    ? window.location.pathname
    : location.split("?")[0];
  const normalizedBase = BASE || "/";
  const isHomePage =
    currentPath === "/" ||
    currentPath === normalizedBase ||
    currentPath === `${normalizedBase}/`;

  const suggestions = searchValue.trim().length >= 1
    ? allProducts.filter((p) =>
        p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
        p.category.toLowerCase().includes(searchValue.toLowerCase())
      ).slice(0, 6)
    : [];

  function handleSearch() {
    const q = searchValue.trim();
    setShowSuggestions(false);
    setMobileSearchOpen(false);
    setMenuOpen(false);
    if (q) {
      setLocation(`/?q=${encodeURIComponent(q)}`);
    } else {
      setLocation("/");
    }
  }

  function selectSuggestion(name: string) {
    setSearchValue(name);
    setShowSuggestions(false);
    setMobileSearchOpen(false);
    setMenuOpen(false);
    setLocation(`/?q=${encodeURIComponent(name)}`);
  }

  // Open mobile search and auto-focus input
  function openMobileSearch() {
    setMobileSearchOpen(true);
    setTimeout(() => mobileInputRef.current?.focus(), 80);
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      const outsideDesktop = desktopWrapperRef.current && !desktopWrapperRef.current.contains(target);
      const outsideMobile  = mobileWrapperRef.current  && !mobileWrapperRef.current.contains(target);
      if (outsideDesktop && outsideMobile) setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
    setMobileSearchOpen(false);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 w-full glass border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 md:h-20">

            {/* Left: hamburger + logo */}
            <div className="flex items-center gap-3">
              {!minimal && (
                <button
                  className="md:hidden p-2 -ml-2 rounded-xl hover:bg-muted transition-colors"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="Menu"
                >
                  {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
              )}
              <Link href="/" className="flex items-center gap-2 group cursor-pointer">
                {logo ? (
                  <div className="overflow-hidden rounded-full h-9 w-9 md:h-10 md:w-10 border-2 border-primary/10 group-hover:border-primary/30 transition-colors">
                    <img src={logo} alt="KA Imports Logo" className="w-full h-full object-cover" />
                  </div>
                ) : null}
                <span className="font-display font-bold text-xl tracking-tight text-primary hidden sm:block">
                  KA IMPORTS
                </span>
              </Link>
            </div>

            {/* Center: desktop search bar */}
            {!minimal && !isHomePage && (
              <SearchBar
                searchValue={searchValue}
                setSearchValue={setSearchValue}
                onSearch={handleSearch}
                onSelectSuggestion={selectSuggestion}
                suggestions={suggestions}
                showSuggestions={showSuggestions}
                setShowSuggestions={setShowSuggestions}
                inputRef={desktopInputRef}
                wrapperRef={desktopWrapperRef}
                className="flex-1 max-w-md mx-8 hidden md:block"
              />
            )}

            {/* Right: mobile search icon + cart */}
            <div className="flex items-center gap-2">
              {!minimal && (
                <Link
                  href={isLoggedIn ? "/minha-conta/pedidos" : "/login"}
                  className="hidden md:inline-flex items-center gap-2 h-10 md:h-11 px-3 md:px-4 rounded-full border border-primary/20 hover:border-primary text-primary font-semibold text-sm transition-colors"
                >
                  <UserCircle2 className="w-5 h-5" />
                  {isLoggedIn ? "Minha Conta" : "Entrar"}
                </Link>
              )}
              {!minimal && !isHomePage && (
                <button
                  className="md:hidden p-2 rounded-xl hover:bg-muted transition-colors"
                  onClick={openMobileSearch}
                  aria-label="Buscar"
                >
                  <Search className="w-5 h-5" />
                </button>
              )}
              {!minimal && (
                <Button
                  variant="outline"
                  className="relative rounded-full h-10 md:h-11 px-3 md:px-4 border-primary/20 hover:border-primary"
                  onClick={() => setIsOpen(true)}
                >
                  <ShoppingBag className="w-5 h-5 md:mr-2 text-primary" />
                  <span className="font-semibold text-primary hidden md:inline">Carrinho</span>
                  {itemCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                      {itemCount}
                    </span>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Mobile search row — slides open below the header bar */}
          {!minimal && !isHomePage && mobileSearchOpen && (
            <div className="md:hidden pb-3">
              <SearchBar
                searchValue={searchValue}
                setSearchValue={setSearchValue}
                onSearch={handleSearch}
                onSelectSuggestion={selectSuggestion}
                suggestions={suggestions}
                showSuggestions={showSuggestions}
                setShowSuggestions={setShowSuggestions}
                inputRef={mobileInputRef}
                wrapperRef={mobileWrapperRef}
                className="w-full"
              />
            </div>
          )}
        </div>
      </header>

      {/* Mobile drawer — hamburger menu */}
      {menuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMenuOpen(false)}
          />
          {/* Drawer */}
          <div className="fixed top-0 left-0 z-50 h-full w-72 bg-white shadow-2xl flex flex-col md:hidden animate-in slide-in-from-left duration-300">
            <div className="flex items-center justify-between px-5 h-16 border-b border-border/50">
              <span className="font-display font-bold text-lg text-primary">Menu</span>
              <button
                className="p-2 rounded-xl hover:bg-muted transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
              <Link
                href="/"
                className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-primary/5 text-foreground font-medium transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <Home className="w-5 h-5 text-primary" />
                Produtos
              </Link>

              <Link
                href={isLoggedIn ? "/minha-conta/pedidos" : "/login"}
                className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-primary/5 text-foreground font-medium transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <UserCircle2 className="w-5 h-5 text-primary" />
                {isLoggedIn ? "Minha Conta" : "Entrar / Criar conta"}
              </Link>

              <button
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-green-50 text-green-700 font-medium transition-colors"
                onClick={() => {
                  setMenuOpen(false);
                  window.open(
                    `https://wa.me/${getActiveWhatsApp()}?text=${encodeURIComponent("Olá, gostaria de suporte.")}`,
                    "_blank",
                    "noopener,noreferrer"
                  );
                }}
              >
                <MessageCircle className="w-5 h-5" />
                Suporte via WhatsApp
              </button>

              <button
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-primary/5 text-foreground font-medium transition-colors"
                onClick={() => { setMenuOpen(false); setIsOpen(true); }}
              >
                <ShoppingBag className="w-5 h-5 text-primary" />
                Carrinho
                {itemCount > 0 && (
                  <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-white">
                    {itemCount}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </>
      )}
    </>
  );
}
