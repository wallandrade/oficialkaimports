import { useEffect, useMemo } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useGetProducts } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { isProductUnavailable, useCart } from "@/store/use-cart";
import { formatCurrency } from "@/lib/utils";
import { ArrowLeft, Loader2, ShoppingCart, Package } from "lucide-react";
import { toast } from "sonner";

type BulkDiscountTier = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
  label?: string | null;
};

function parseBulkDiscountTiers(raw: unknown): BulkDiscountTier[] {
  if (!Array.isArray(raw)) return [];

  const tiers = raw
    .map((tier) => {
      const item = tier as Record<string, unknown>;
      const minQty = Number(item.minQty);
      const maxQtyRaw = item.maxQty;
      const maxQty = maxQtyRaw == null ? null : Number(maxQtyRaw);
      const unitPrice = Number(item.unitPrice);
      const label = item.label == null ? null : String(item.label);

      if (!Number.isFinite(minQty) || minQty < 1) return null;
      if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) return null;
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

      return { minQty, maxQty, unitPrice, label };
    })
    .filter((tier): tier is BulkDiscountTier => Boolean(tier));

  return tiers.sort((a, b) => a.minQty - b.minQty);
}

function tierForQuantity(quantity: number, tiers: BulkDiscountTier[]): BulkDiscountTier | null {
  return tiers.find((tier) => quantity >= tier.minQty && (tier.maxQty == null || quantity <= tier.maxQty)) ?? null;
}

function safeGetStorage(key: string): string {
  try {
    return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeSetStorage(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

export default function ProductDetail() {
  const [, paramsSeller] = useRoute("/:seller/produto/:id");
  const [, paramsGlobal] = useRoute("/produto/:id");
  const [, setLocation] = useLocation();
  const { addItem } = useCart();

  const productId = paramsSeller?.id ?? paramsGlobal?.id ?? "";
  const sellerSlug = paramsSeller?.seller?.toLowerCase();

  useEffect(() => {
    if (sellerSlug || !productId) return;
    const storedSeller = safeGetStorage("sellerCode").toLowerCase();
    if (storedSeller) {
      setLocation(`/${storedSeller}/produto/${productId}`);
    }
  }, [sellerSlug, productId, setLocation]);

  if (sellerSlug) {
    safeSetStorage("sellerCode", sellerSlug);
  }

  const { data, isLoading, isError } = useGetProducts();

  const product = useMemo(
    () => data?.products?.find((p) => p.id === productId) ?? null,
    [data?.products, productId],
  );

  const hasPromo = !!(product && product.promoPrice != null && product.promoPrice < product.price);
  const isBulkDiscountEnabled = Boolean((product as { bulkDiscountEnabled?: boolean } | null)?.bulkDiscountEnabled);
  const bulkDiscountTiers = useMemo(
    () => parseBulkDiscountTiers((product as { bulkDiscountTiers?: unknown } | null)?.bulkDiscountTiers),
    [product],
  );
  const progressiveOptions = useMemo(() => {
    if (!product || !isBulkDiscountEnabled || bulkDiscountTiers.length === 0) return [];
    const basePrice = hasPromo ? product.promoPrice! : product.price;

    return [1, 2, 3, 4].map((quantity) => {
      const tier = tierForQuantity(quantity, bulkDiscountTiers);
      const unitPrice = tier?.unitPrice ?? basePrice;
      const quantityLabel = quantity >= 4 ? "4cx+" : `${quantity}cx`;
      return {
        quantity,
        quantityLabel,
        unitPrice,
        totalPrice: unitPrice * quantity,
      };
    });
  }, [product, bulkDiscountTiers, hasPromo, isBulkDiscountEnabled]);
  const isSoldOut = product ? isProductUnavailable(product) : false;
  const backHref = sellerSlug ? `/${sellerSlug}` : "/";

  return (
    <AppLayout>
      <section className="py-6 sm:py-10 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full">
        <Button variant="ghost" className="mb-6 px-0 hover:bg-transparent">
          <Link href={backHref} className="flex items-center">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Voltar para produtos
          </Link>
        </Button>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
            <p className="font-semibold text-destructive">Erro ao carregar produto.</p>
          </div>
        ) : !product ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <p className="font-semibold text-foreground">Produto não encontrado.</p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div className="rounded-3xl border border-border/60 overflow-hidden bg-muted/20 shadow-sm">
              <img
                src={product.image || "https://placehold.co/800x800/1a2b4a/ffffff?text=KA+Imports"}
                alt={product.name}
                className="w-full h-full object-cover aspect-square"
              />
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-secondary">{product.category}</p>
                <h1 className="text-3xl font-bold text-foreground mt-2 leading-tight">{product.name}</h1>
              </div>

              <div className="rounded-2xl border border-border bg-card p-4">
                {hasPromo ? (
                  <div className="flex items-end gap-3">
                    <span className="text-lg text-muted-foreground line-through">{formatCurrency(product.price)}</span>
                    <span className="text-3xl font-bold text-primary">{formatCurrency(product.promoPrice!)}</span>
                  </div>
                ) : (
                  <span className="text-3xl font-bold text-primary">{formatCurrency(product.price)}</span>
                )}
                {isSoldOut && (
                  <p className="mt-2 text-sm font-semibold text-destructive">Produto esgotado no momento.</p>
                )}
              </div>

              {progressiveOptions.length > 0 ? (
                <div className="space-y-3">
                  {progressiveOptions.map((option) => (
                    <div key={option.quantity} className="rounded-2xl border border-border bg-card p-3 sm:p-4">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-primary text-sm font-semibold">
                          <Package className="w-4 h-4" />
                          {option.quantityLabel}
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">{formatCurrency(option.unitPrice)} cada</p>
                          <p className="font-bold text-primary">Total {formatCurrency(option.totalPrice)}</p>
                        </div>
                      </div>

                      <Button
                        size="lg"
                        className="w-full text-base"
                        disabled={isSoldOut}
                        onClick={() => {
                          if (isSoldOut) {
                            toast.error("Este produto está esgotado e não pode ser adicionado.");
                            return;
                          }
                          addItem(product, { quantity: option.quantity, unitPrice: option.unitPrice });
                          toast.success(`${option.quantityLabel} adicionado ao carrinho!`);
                        }}
                      >
                        <ShoppingCart className="w-5 h-5 mr-2" />
                        {isSoldOut ? "Produto esgotado" : `Adicionar ${option.quantityLabel}`}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <Button
                  size="lg"
                  className="w-full text-base"
                  disabled={isSoldOut}
                  onClick={() => {
                    if (isSoldOut) {
                      toast.error("Este produto está esgotado e não pode ser adicionado.");
                      return;
                    }
                    addItem(product);
                    toast.success("Produto adicionado ao carrinho!");
                  }}
                >
                  <ShoppingCart className="w-5 h-5 mr-2" />
                  {isSoldOut ? "Produto esgotado" : "Adicionar ao carrinho"}
                </Button>
              )}

              <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                {product.description || "Sem descrição para este produto."}
              </p>
            </div>
          </div>
        )}
      </section>
    </AppLayout>
  );
}
