import { useMemo } from "react";
import { Link } from "wouter";
import { useRoute } from "wouter";
import { useGetProducts } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProductCard } from "@/components/product/ProductCard";
import { Loader2, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { isPharmaCompactPreset, useStoreThemePreset } from "@/lib/store-theme";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type BulkDiscountTier = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
};

function parseBulkDiscountTiers(raw: unknown): BulkDiscountTier[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

function hasOffer(product: any): boolean {
  // Ofertas com preço baixo
  if (product.promoPrice && product.promoPrice < product.price) return true;
  // Ofertas com desconto progressivo
  if (product.bulkDiscountEnabled) {
    const tiers = parseBulkDiscountTiers(product.bulkDiscountTiers);
    if (tiers.length > 0) return true;
  }
  return false;
}

export default function OffersPage() {
  const { data, isLoading } = useGetProducts();
  const isPharma = isPharmaCompactPreset(useStoreThemePreset());

  const products = useMemo(() => {
    if (Array.isArray(data)) return data;
    if (Array.isArray((data as { products?: unknown[] } | undefined)?.products)) {
      return (data as { products: unknown[] }).products as any[];
    }
    return [] as any[];
  }, [data]);

  const offersProducts = useMemo(() => {
    return products.filter(hasOffer).sort((a, b) => {
      // Ordenar por maior desconto primeiro
      const discountA = a.promoPrice ? ((a.price - a.promoPrice) / a.price) * 100 : 0;
      const discountB = b.promoPrice ? ((b.price - b.promoPrice) / b.price) * 100 : 0;
      return discountB - discountA;
    });
  }, [products]);

  const [sellerMatch, sellerParams] = useRoute("/:seller/ofertas");
  const [defaultMatch] = useRoute("/ofertas");

  const sellerSlug = sellerMatch ? sellerParams?.seller?.toLowerCase() : undefined;
  const catalogHref = sellerSlug ? `/${encodeURIComponent(sellerSlug)}` : "/";

  return (
    <AppLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6">
          <Link
            href={catalogHref}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao catálogo
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2">
            Ofertas
          </h1>
          <p className="text-muted-foreground">
            {offersProducts.length} produto{offersProducts.length !== 1 ? "s" : ""} com oferta ativa
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex justify-center items-center min-h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {/* Empty State */}
        {!isLoading && offersProducts.length === 0 && (
          <div className="text-center py-16">
            <p className="text-lg text-muted-foreground mb-4">
              Nenhuma oferta disponível no momento.
            </p>
            <Link
              href={catalogHref}
              className="inline-block px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              Ver todos os produtos
            </Link>
          </div>
        )}

        {/* Products Grid */}
        {!isLoading && offersProducts.length > 0 && (
          <motion.div
            className={isPharma
              ? "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 items-stretch"
              : "grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-6 items-stretch"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {offersProducts.map((product, index) => (
              <motion.div
                key={product.id}
                className="flex"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <ProductCard
                  product={product}
                  sellerSlug={sellerSlug}
                  priority={index < 4}
                  layout={isPharma ? "pharma" : "default"}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </AppLayout>
  );
}
