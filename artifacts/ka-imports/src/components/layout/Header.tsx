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

function usePublicSiteSettings() {
  const [settings, setSettings] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("siteSettings") || "{}"); } catch { return {}; }
  });

  useEffect(() => {
    fetch(`${BASE}/api/settings`)
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        localStorage.setItem("siteSettings", JSON.stringify(data));
        setSettings(data || {});
      })
      .catch(() => {});
  }, []);

  return settings;
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
  homeHref,
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
  homeHref: string;
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
            onClick={() => { setSearchValue(""); setShowSuggestions(false); setLocation(homeHref); }}
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
  const siteSettings = usePublicSiteSettings();
  const logo = siteSettings.logo ?? null;
  const logoScale = Math.min(240, Math.max(100, Number(siteSettings.logo_scale ?? 180) || 180));
  const allProducts = useProducts();
  const currentPath = typeof window !== "undefined"
    ? window.location.pathname
    : location.split("?")[0];
  const rootSegment = currentPath.split("/").filter(Boolean)[0] || "";
  const reservedRootSegments = new Set([
    "admin",
    "login",
    "produto",
    "checkout",
    "ofertas",
    "categoria",
    "pix",
    "success",
    "r",
    "pagamento",
    "payment-link",
    "kyc",
    "suporte",
    "rifas",
    "grupo2",
    "minha-conta",
  ]);
  const sellerSlug = rootSegment && !reservedRootSegments.has(rootSegment) ? rootSegment : "";
  const sellerHomeHref = sellerSlug ? `/${encodeURIComponent(sellerSlug)}` : "/";
  const normalizedBase = BASE || "/";
  const isHomePage =
    currentPath === sellerHomeHref ||
    currentPath === "/" ||
    currentPath === normalizedBase ||
    currentPath === `${normalizedBase}/`;

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const promoCountdownEnabled = !["0", "false", "off", "no", "disabled"].includes(String(siteSettings["promo_countdown_enabled"] ?? "0").toLowerCase());
  const promoCountdownText = String(siteSettings["promo_countdown_text"] ?? "").trim();
  const promoCountdownAtRaw = String(siteSettings["promo_countdown_datetime"] ?? "").trim();
  const promoTargetMs = promoCountdownAtRaw ? new Date(promoCountdownAtRaw).getTime() : Number.NaN;
  const countdownDiff = Number.isFinite(promoTargetMs) ? Math.max(0, promoTargetMs - nowMs) : 0;
  const countdownDays = Math.floor(countdownDiff / (1000 * 60 * 60 * 24));
  const countdownHours = Math.floor((countdownDiff / (1000 * 60 * 60)) % 24);
  const countdownMinutes = Math.floor((countdownDiff / (1000 * 60)) % 60);
  const countdownSeconds = Math.floor((countdownDiff / 1000) % 60);
  const hasValidPromoSchedule = !minimal && promoCountdownEnabled && !!promoCountdownText && Number.isFinite(promoTargetMs);
  const promoStarted = hasValidPromoSchedule && nowMs >= promoTargetMs;

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
      setLocation(`${sellerHomeHref}?q=${encodeURIComponent(q)}`);
    } else {
      setLocation(sellerHomeHref);
    }
  }

  function selectSuggestion(name: string) {
    setSearchValue(name);
    setShowSuggestions(false);
    setMobileSearchOpen(false);
    setMenuOpen(false);
    setLocation(`${sellerHomeHref}?q=${encodeURIComponent(name)}`);
  }

  async function openSupportWhatsApp() {
    let number = getActiveWhatsApp();

    if (sellerSlug) {
      try {
        const res = await fetch(`${BASE}/api/sellers/${encodeURIComponent(sellerSlug)}`);
        if (res.ok) {
          const data = (await res.json()) as { whatsapp?: string };
          const sellerWhatsApp = String(data?.whatsapp || "").replace(/\D/g, "");
          if (sellerWhatsApp) {
            number = sellerWhatsApp;
            sessionStorage.setItem("sellerWhatsapp", sellerWhatsApp);
            sessionStorage.setItem("sellerWhatsappSlug", sellerSlug);
          }
        }
      } catch {
        // ignore and use current fallback number
      }
    }

    window.open(
      `https://wa.me/${number}?text=${encodeURIComponent("Olá, gostaria de suporte.")}`,
      "_blank",
      "noopener,noreferrer"
    );
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
      {hasValidPromoSchedule && (
        <div className="w-full bg-gradient-to-r from-rose-700 via-red-600 to-orange-500 text-white border-b border-red-300/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
            <p className="text-sm font-semibold tracking-tight">{promoCountdownText}</p>
            {promoStarted ? (
              <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold">
                <span className="px-3 py-1 rounded-lg bg-white/20 text-white">Promocao no ar</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                <span className="px-2.5 py-1 rounded-lg bg-white/15 min-w-[64px] text-center">{String(countdownDays).padStart(2, "0")}d</span>
                <span className="px-2.5 py-1 rounded-lg bg-white/15 min-w-[64px] text-center">{String(countdownHours).padStart(2, "0")}h</span>
                <span className="px-2.5 py-1 rounded-lg bg-white/15 min-w-[64px] text-center">{String(countdownMinutes).padStart(2, "0")}m</span>
                <span className="px-2.5 py-1 rounded-lg bg-white/15 min-w-[64px] text-center">{String(countdownSeconds).padStart(2, "0")}s</span>
              </div>
            )}
          </div>
        </div>
      )}

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
              <Link href={sellerHomeHref} className="flex items-center gap-2 group cursor-pointer">
                <div
                  className="overflow-hidden rounded-2xl h-10 md:h-11 border border-primary/10 group-hover:border-primary/30 transition-colors bg-white/80 flex items-center justify-center shrink-0 px-2 py-1"
                  style={{ width: `${logoScale}px`, maxWidth: "48vw" }}
                >
                  {logo ? (
                    <img
                      src={logo}
                      alt="KA Imports Logo"
                      loading="eager"
                      fetchPriority="high"
                      className="h-full w-auto object-contain"
                    />
                  ) : null}
                </div>
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
                homeHref={sellerHomeHref}
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
                homeHref={sellerHomeHref}
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
                href={sellerHomeHref}
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
                onClick={async () => {
                  setMenuOpen(false);
                  await openSupportWhatsApp();
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
