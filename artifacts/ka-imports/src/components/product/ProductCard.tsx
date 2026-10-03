import { ArrowRight, ShoppingCart } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Product } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { isProductUnavailable, useCart } from "@/store/use-cart";
import { parseVariantGroups } from "@/lib/product-variants";

interface ProductCardProps {
  product: Product;
  sellerSlug?: string;
  priority?: boolean;
  topSellerRank?: 1 | 2 | 3 | null;
  layout?: "default" | "pharma";
}

type BulkDiscountTier = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
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

      if (!Number.isFinite(minQty) || minQty < 1) return null;
      if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) return null;
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

      return { minQty, maxQty, unitPrice };
    })
    .filter((tier): tier is BulkDiscountTier => Boolean(tier));

  return tiers.sort((a, b) => a.minQty - b.minQty);
}

function getTierForQuantity(quantity: number, tiers: BulkDiscountTier[]): BulkDiscountTier | null {
  return tiers.find((tier) => quantity >= tier.minQty && (tier.maxQty == null || quantity <= tier.maxQty)) ?? null;
}

function hasVariantGroups(product: Product): boolean {
  return parseVariantGroups((product as Product & { variantGroups?: unknown }).variantGroups).length > 0;
}

export function ProductCard({ product, sellerSlug, priority = false, topSellerRank = null, layout = "default" }: ProductCardProps) {
  const hasPromo = product.promoPrice != null && product.promoPrice < product.price;
  const isSoldOut = isProductUnavailable(product);
  const isLaunch = (product as Product & { isLaunch?: boolean }).isLaunch === true;
  const bulkDiscountEnabled = (product as Product & { bulkDiscountEnabled?: boolean }).bulkDiscountEnabled === true;
  const bulkDiscountTiers = parseBulkDiscountTiers((product as Product & { bulkDiscountTiers?: unknown }).bulkDiscountTiers);
  const oneBoxTier = getTierForQuantity(1, bulkDiscountTiers);
  const hasBulkDiscount = bulkDiscountEnabled && bulkDiscountTiers.length > 0;
  const displayUnitPrice = hasBulkDiscount && oneBoxTier
    ? oneBoxTier.unitPrice
    : (hasPromo ? product.promoPrice! : product.price);
  const showOriginalPrice = displayUnitPrice < product.price;
  const href = sellerSlug ? `/${sellerSlug}/produto/${product.id}` : `/produto/${product.id}`;
  const { addItem, setIsOpen, showAddedNotice } = useCart();
  const [, setLocation] = useLocation();
  const requiresVariantSelection = hasVariantGroups(product);

  function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    if (isSoldOut) return;
    if (requiresVariantSelection) {
      setLocation(href);
      return;
    }
    addItem(product);
    if (layout === "pharma") {
      showAddedNotice({
        name: product.name,
        image: product.image ?? null,
        quantity: 1,
      });
      return;
    }
    setIsOpen(true);
  }

  if (layout === "pharma") {
    const offPct = showOriginalPrice && product.price > 0
      ? Math.max(1, Math.round((1 - displayUnitPrice / product.price) * 100))
      : 0;
    const brand = String((product as Product & { brand?: string | null }).brand || "").trim();

    return (
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="relative bg-white px-3 pt-3">
          {offPct > 0 && (
            <span className="absolute left-2 top-2 z-10 rounded-full bg-[var(--pharma-off,#ef4444)] px-2 py-0.5 text-[10px] font-bold text-white">
              Até {offPct}% OFF
            </span>
          )}
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={isSoldOut}
            aria-label={isSoldOut ? "Produto esgotado" : "Adicionar ao carrinho"}
            className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--pharma-green,#22c55e)] text-white disabled:opacity-40"
          >
            <ShoppingCart className="h-4 w-4" />
          </button>
          <Link href={href} className="block">
            <img
              src={product.image || "https://placehold.co/400x400/f4f4f5/111111?text=Produto"}
              alt={product.name}
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={priority ? "high" : "auto"}
              className="mx-auto h-36 w-full object-contain"
            />
          </Link>
        </div>
        <div className="flex flex-1 flex-col px-3 pb-3 pt-2">
          {brand ? <p className="mb-0.5 text-xs text-neutral-400">{brand}</p> : null}
          <Link href={href} className="mb-2 line-clamp-2 text-sm font-bold leading-tight text-neutral-900">
            {product.name}
          </Link>
          <div className="mt-auto flex items-end justify-between gap-2">
            <div className="min-w-0">
              {showOriginalPrice ? (
                <p className="text-[10px] leading-tight text-neutral-400">
                  A PARTIR DE <span className="line-through">{formatCurrency(product.price)}</span>
                </p>
              ) : null}
              <div className="flex items-center gap-1">
                <span className="text-[15px] font-bold text-[var(--pharma-green-strong,#16a34a)]">{formatCurrency(displayUnitPrice)}</span>
                <span className="rounded border border-[var(--pharma-green,#22c55e)] px-1 text-[9px] font-bold uppercase text-[var(--pharma-green-strong,#16a34a)]">PIX</span>
              </div>
            </div>
            <Link
              href={href}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--pharma-green,#22c55e)] px-2.5 py-1.5 text-xs font-semibold text-white"
            >
              Ver
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ka-product-card group flex flex-col w-full h-full bg-card rounded-2xl border border-border/50 shadow-sm hover:shadow-xl hover:border-primary/20 transition-all duration-300 overflow-hidden">
      <div className="ka-product-card-media relative aspect-square overflow-hidden bg-muted/30 flex-shrink-0">
        <img
          src={product.image || "https://placehold.co/400x400/1a2b4a/ffffff?text=KA+Imports"}
          alt={product.name}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          className="ka-product-card-image w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-3 left-3 flex flex-col gap-1 items-start z-10">
          {hasPromo ? (
            <div className="ka-product-card-badge ka-product-card-badge-promo bg-destructive text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">
              OFERTA
            </div>
          ) : null}
          {topSellerRank ? (
            <div className="ka-product-card-badge ka-product-card-badge-top bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">
              TOP {topSellerRank}
            </div>
          ) : null}
        </div>
        {isSoldOut ? (
          <div className="ka-product-card-badge ka-product-card-badge-status absolute top-3 right-3 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">
            ESGOTADO
          </div>
        ) : isLaunch ? (
          <div className="ka-product-card-badge ka-product-card-badge-status absolute top-3 right-3 bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">
            LANCAMENTO
          </div>
        ) : null}
      </div>

      <div className="ka-product-card-content p-4 flex flex-col flex-1">
        <div className="ka-product-card-category mb-1 text-xs font-semibold text-secondary tracking-wider uppercase">
          {product.category}
        </div>
        {hasBulkDiscount && (
          <div className="ka-product-card-bulk mb-2 inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold px-2.5 py-1">
            Desconto progressivo
          </div>
        )}
        <h3 className="ka-product-card-title font-bold text-foreground text-base mb-1 line-clamp-2 leading-tight">
          {product.name}
        </h3>
        <p className="ka-product-card-description text-xs text-muted-foreground mb-3 line-clamp-2">
          {product.description}
        </p>

        <div className="ka-product-card-footer mt-auto">
          <div className="ka-product-card-price-wrap flex flex-col mb-3">
            {showOriginalPrice ? (
              <>
                <span className="ka-product-card-price-old text-xs text-muted-foreground line-through decoration-destructive/50">
                  {formatCurrency(product.price)}
                </span>
                <span className="ka-product-card-price font-bold text-xl text-primary">
                  {formatCurrency(displayUnitPrice)}
                </span>
              </>
            ) : (
              <span className="ka-product-card-price font-bold text-xl text-primary">
                {formatCurrency(displayUnitPrice)}
              </span>
            )}
          </div>

          <div className="ka-product-card-actions flex flex-col gap-2">
            <Button
              asChild
              className="ka-product-card-action-primary w-full rounded-xl text-sm"
            >
              <Link href={href}>
                Ver produto
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
            <Button
              variant="outline"
              className="ka-product-card-action-secondary w-full rounded-xl text-sm"
              onClick={handleAddToCart}
              disabled={isSoldOut}
            >
              <ShoppingCart className="w-4 h-4 mr-1.5" />
              {isSoldOut ? "Produto esgotado" : requiresVariantSelection ? "Escolher variantes" : "Adicionar ao carrinho"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
