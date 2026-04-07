import { useState, useMemo, useEffect } from "react";
import { useSearch, useRoute } from "wouter";
import { useGetProducts } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProductCard } from "@/components/product/ProductCard";
import { Loader2, X, SlidersHorizontal, Search } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLiveTracking } from "@/hooks/useLiveTracking";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FilterContentProps {
  categories: string[];
  activeCategories: string[];
  toggleCategory: (cat: string) => void;
  nameFilter: string;
  setNameFilter: (v: string) => void;
  setActiveCategories: (v: string[]) => void;
}

function FilterContent({
  categories,
  activeCategories,
  toggleCategory,
  nameFilter,
  setNameFilter,
  setActiveCategories,
}: FilterContentProps) {
  return (
    <div className="space-y-6">
      {/* Campo de busca por nome */}
      <div>
        <h3 className="font-bold text-sm text-foreground mb-3 uppercase tracking-wider">Buscar produto</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Nome do produto..."
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-input bg-white text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary"
          />
          {nameFilter && (
            <button
              type="button"
              onClick={() => setNameFilter("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="border-t border-border/50" />
      <div>
        <h3 className="font-bold text-sm text-foreground mb-3 uppercase tracking-wider">Categorias</h3>
        <div className="space-y-3">
          {categories.map((cat) => (
            <label key={cat} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={activeCategories.includes(cat)}
                onChange={() => toggleCategory(cat)}
                className="sr-only"
                aria-label={`Filtrar categoria ${cat}`}
              />
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors shadow-sm ${activeCategories.includes(cat) ? 'bg-primary border-primary text-primary-foreground' : 'border-border group-hover:border-primary/50 bg-white'}`}>
                {activeCategories.includes(cat) && <svg width="11" height="9" viewBox="0 0 11 9" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 4.5L4 7L9.5 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <span className="text-sm font-medium leading-none text-muted-foreground group-hover:text-foreground transition-colors">{cat}</span>
            </label>
          ))}
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground/60 italic">Nenhuma categoria encontrada.</p>
          )}
        </div>
      </div>
      {(activeCategories.length > 0 || nameFilter) && (
        <div className="border-t border-border/50 pt-5">
          <Button variant="ghost" className="w-full text-muted-foreground text-sm h-10 hover:bg-destructive/10 hover:text-destructive transition-colors rounded-xl" onClick={() => { setActiveCategories([]); setNameFilter(""); }}>
            Limpar Filtros
          </Button>
        </div>
      )}
    </div>
  );
}

function useSiteBanners() {
  const getCached = () => {
    try { return JSON.parse(localStorage.getItem("siteSettings") || "{}") as Record<string, string>; } catch { return {}; }
  };
  const [banners, setBanners] = useState<Record<string, string>>(getCached);
  useEffect(() => {
    fetch(`${BASE}/api/settings`)
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        localStorage.setItem("siteSettings", JSON.stringify(data));
        setBanners(data);
      })
      .catch(() => {});
  }, []);
  return banners;
}

export default function Home() {
  const { data, isLoading, isError } = useGetProducts();
  const [, sellerParams] = useRoute("/:seller");
  const sellerSlug = sellerParams?.seller?.toLowerCase();
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [nameFilter, setNameFilter] = useState("");
  const searchString = useSearch();
  const searchQuery = new URLSearchParams(searchString).get("q") || "";
  const banners = useSiteBanners();

  useLiveTracking("catalog");

  const toggleCategory = (category: string) => {
    setActiveCategories((prev) =>
      prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category],
    );
  };

  const filteredProducts = useMemo(() => {
    if (!data?.products) return [];
    let filtered = data.products.filter((product) => {
      const matchesSearch =
        !searchQuery ||
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        activeCategories.length === 0 || activeCategories.includes(product.category);
      const matchesName =
        !nameFilter.trim() ||
        product.name.toLowerCase().includes(nameFilter.trim().toLowerCase());

      return matchesSearch && matchesCategory && matchesName;
    });

    return filtered.sort((a, b) => {
      const aHasPromo = a.promoPrice != null && a.promoPrice < a.price;
      const bHasPromo = b.promoPrice != null && b.promoPrice < b.price;
      if (aHasPromo && !bHasPromo) return -1;
      if (!aHasPromo && bHasPromo) return 1;
      return 0;
    });
  }, [data, searchQuery, activeCategories, nameFilter]);

  const filterProps: FilterContentProps = {
    categories: data?.categories ?? [],
    activeCategories,
    toggleCategory,
    nameFilter,
    setNameFilter,
    setActiveCategories,
  };

  return (
    <AppLayout>
      {/* Hero Banner — only shown when configured in admin */}
      {(banners["banner_desktop"] || banners["banner_mobile"]) && (
        <section className="w-full relative overflow-hidden">
          {banners["banner_mobile"] && (
            <img
              src={banners["banner_mobile"]}
              alt="KA Imports Banner"
              className="block sm:hidden w-full h-[180px] object-cover object-center"
            />
          )}
          {banners["banner_desktop"] && (
            <img
              src={banners["banner_desktop"]}
              alt="KA Imports Premium Banner"
              className={`${banners["banner_mobile"] ? "hidden sm:block" : "block"} w-full h-[260px] md:h-[380px] object-cover object-center`}
            />
          )}
        </section>
      )}

      <section className="py-6 sm:py-10 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full flex-1">
        
        {/* Mobile: título + busca + chips de categoria */}
        <div className="flex flex-col gap-3 mb-6 lg:mb-8">
          <h2 className="text-2xl font-bold text-foreground lg:hidden">Catálogo</h2>

          {/* Busca e chips — somente mobile */}
          <div className="lg:hidden flex flex-col gap-2">
            {/* Campo de busca */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar produto..."
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                className="w-full h-11 pl-9 pr-10 rounded-2xl border border-input bg-white text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary"
              />
              {nameFilter && (
                <button
                  type="button"
                  onClick={() => setNameFilter("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Limpar busca"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Chips de categoria */}
            <div className="flex gap-2 overflow-x-auto py-1" style={{ scrollbarWidth: "none" }}>
              <button
                onClick={() => setActiveCategories([])}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                  activeCategories.length === 0
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-white text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                Todas
              </button>
              {(data?.categories ?? []).map((cat) => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                    activeCategories.includes(cat)
                      ? "bg-primary text-white border-primary shadow-sm"
                      : "bg-white text-muted-foreground border-border hover:border-primary/50"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {searchQuery && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-muted-foreground/80">Resultados para:</span>
              <Button variant="secondary" className="rounded-full h-8 px-3.5 text-sm gap-1 hover:bg-destructive hover:text-white group transition-all shadow-sm" onClick={() => window.history.pushState({}, "", "/")}>
                <X className="w-3.5 h-3.5" /> <span className="max-w-[200px] truncate">{searchQuery}</span>
              </Button>
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-[260px_1fr] xl:grid-cols-[280px_1fr] gap-8 xl:gap-12 items-start">
          
          {/* Desktop Sidebar */}
          <aside className="hidden lg:block sticky top-[100px] space-y-6 bg-white/70 backdrop-blur-md p-6 rounded-[2rem] border border-border/60 shadow-sm">
            <div className="flex items-center gap-2 pb-5 border-b border-border/50">
              <SlidersHorizontal className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-lg">Filtros</h2>
            </div>
            <FilterContent {...filterProps} />
          </aside>

          {/* Product Grid */}
          <div className="min-w-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                <p className="text-muted-foreground font-medium">Carregando catálogo...</p>
              </div>
            ) : isError ? (
              <div className="bg-destructive/5 text-destructive p-8 rounded-3xl text-center border-2 border-destructive/10">
                <p className="font-bold text-lg mb-2">Ops! Algo deu errado.</p>
                <p className="opacity-80">Não foi possível carregar os produtos. Tente recarregar a página.</p>
              </div>
            ) : filteredProducts.length === 0 && (data?.products?.length ?? 0) === 0 ? (
              <div className="text-center py-20 bg-muted/30 rounded-3xl border border-border/50">
                <h3 className="text-2xl font-bold text-foreground mb-2">Em breve novidades!</h3>
                <p className="text-muted-foreground">Nossos produtos serão cadastrados em breve. Volte em instantes.</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-20 bg-muted/30 rounded-3xl border border-border/50">
                <h3 className="text-xl font-bold text-foreground mb-3">Nenhum produto encontrado</h3>
                <p className="text-muted-foreground mb-6">Tente alterar os filtros ou o termo da busca.</p>
                <Button className="rounded-xl px-6" onClick={() => { setActiveCategories([]); setNameFilter(""); window.history.pushState({}, "", "/"); }}>Limpar todos os filtros</Button>
              </div>
            ) : (
              <motion.div
                className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-6 items-stretch"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {filteredProducts.map((product, i) => (
                  <motion.div
                    key={product.id}
                    className="flex"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  >
                    <ProductCard product={product} sellerSlug={sellerSlug} />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        </div>
      </section>

    </AppLayout>
  );
}
