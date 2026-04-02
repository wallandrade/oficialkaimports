import { useState, useMemo, useEffect } from "react";
import { useSearch } from "wouter";
import { useGetProducts } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProductCard } from "@/components/product/ProductCard";
import { Loader2, X } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLiveTracking } from "@/hooks/useLiveTracking";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const searchString = useSearch();
  const searchQuery = new URLSearchParams(searchString).get("q") || "";
  const banners = useSiteBanners();

  useLiveTracking("catalog");

  const filteredProducts = useMemo(() => {
    if (!data?.products) return [];
    const filtered = data.products.filter((product) => {
      const matchesSearch =
        !searchQuery ||
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        activeCategory === "all" || product.category === activeCategory;
      return matchesSearch && matchesCategory;
    });

    return filtered.sort((a, b) => {
      const aHasPromo = a.promoPrice != null && a.promoPrice < a.price;
      const bHasPromo = b.promoPrice != null && b.promoPrice < b.price;
      if (aHasPromo && !bHasPromo) return -1;
      if (!aHasPromo && bHasPromo) return 1;
      return 0;
    });
  }, [data, searchQuery, activeCategory]);

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

      <section className="py-10 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full flex-1">
        {/* Categories */}
        {(data?.categories?.length ?? 0) > 0 && (
          <div className="flex gap-2 mb-8 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
            <Button
              variant={activeCategory === "all" ? "default" : "outline"}
              className="rounded-full shrink-0"
              onClick={() => setActiveCategory("all")}
            >
              Todos
            </Button>
            {data?.categories?.map((cat) => (
              <Button
                key={cat}
                variant={activeCategory === cat ? "default" : "outline"}
                className="rounded-full shrink-0"
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </Button>
            ))}
            {searchQuery && (
              <Button variant="ghost" className="rounded-full shrink-0 text-muted-foreground gap-1" onClick={() => window.history.pushState({}, "", "/")}>
                <X className="w-4 h-4" />{searchQuery}
              </Button>
            )}
          </div>
        )}

        {/* Product Grid */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
            <p className="text-muted-foreground font-medium">Carregando produtos...</p>
          </div>
        ) : isError ? (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive p-6 rounded-2xl text-center">
            <p className="font-bold text-lg mb-2">Ops! Algo deu errado.</p>
            <p>Não foi possível carregar os produtos. Tente recarregar a página.</p>
          </div>
        ) : filteredProducts.length === 0 && (data?.products?.length ?? 0) === 0 ? (
          <div className="text-center py-20">
            <h3 className="text-2xl font-bold text-foreground mb-2">Em breve novidades!</h3>
            <p className="text-muted-foreground">Nossos produtos serão cadastrados em breve. Volte em instantes.</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-20">
            <h3 className="text-2xl font-bold text-foreground mb-2">Nenhum produto encontrado</h3>
            <p className="text-muted-foreground">Tente alterar os filtros ou o termo de busca.</p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 items-stretch"
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
                <ProductCard product={product} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>
    </AppLayout>
  );
}
