import { ArrowRight, ShoppingCart } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Product } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useCart } from "@/store/use-cart";

interface ProductCardProps {
  product: Product;
  sellerSlug?: string;
}

export function ProductCard({ product, sellerSlug }: ProductCardProps) {
  const hasPromo = product.promoPrice != null && product.promoPrice < product.price;
  const href = sellerSlug ? `/${sellerSlug}/produto/${product.id}` : `/produto/${product.id}`;
  const { addItem, setIsOpen } = useCart();

  function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    addItem(product);
    setIsOpen(true);
  }

  return (
    <div className="group flex flex-col w-full h-full bg-card rounded-2xl border border-border/50 shadow-sm hover:shadow-xl hover:border-primary/20 transition-all duration-300 overflow-hidden">
      <div className="relative aspect-square overflow-hidden bg-muted/30 flex-shrink-0">
        <img
          src={product.image || "https://placehold.co/400x400/1a2b4a/ffffff?text=KA+Imports"}
          alt={product.name}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {hasPromo && (
          <div className="absolute top-3 left-3 bg-destructive text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">
            OFERTA
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1">
        <div className="mb-1 text-xs font-semibold text-secondary tracking-wider uppercase">
          {product.category}
        </div>
        <h3 className="font-bold text-foreground text-base mb-1 line-clamp-2 leading-tight">
          {product.name}
        </h3>
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
          {product.description}
        </p>

        <div className="mt-auto">
          <div className="flex flex-col mb-3">
            {hasPromo ? (
              <>
                <span className="text-xs text-muted-foreground line-through decoration-destructive/50">
                  {formatCurrency(product.price)}
                </span>
                <span className="font-bold text-xl text-primary">
                  {formatCurrency(product.promoPrice!)}
                </span>
              </>
            ) : (
              <span className="font-bold text-xl text-primary">
                {formatCurrency(product.price)}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 rounded-xl text-sm"
              onClick={handleAddToCart}
            >
              <ShoppingCart className="w-4 h-4 mr-1.5" />
              Carrinho
            </Button>
            <Button
              asChild
              className="flex-1 rounded-xl text-sm"
            >
              <Link href={href}>
                Ver produto
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
