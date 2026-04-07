import { useMemo } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useGetProducts } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useCart } from "@/store/use-cart";
import { formatCurrency } from "@/lib/utils";
import { ArrowLeft, Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

export default function ProductDetail() {
  const [, paramsSeller] = useRoute("/:seller/produto/:id");
  const [, paramsGlobal] = useRoute("/produto/:id");
  const [, setLocation] = useLocation();
  const { addItem } = useCart();

  const productId = paramsSeller?.id ?? paramsGlobal?.id ?? "";
  const sellerSlug = paramsSeller?.seller?.toLowerCase();

  if (sellerSlug) {
    sessionStorage.setItem("sellerCode", sellerSlug);
    localStorage.setItem("sellerCode", sellerSlug);
  }

  const { data, isLoading, isError } = useGetProducts();

  const product = useMemo(
    () => data?.products?.find((p) => p.id === productId) ?? null,
    [data?.products, productId],
  );

  const hasPromo = !!(product && product.promoPrice != null && product.promoPrice < product.price);
  const backHref = sellerSlug ? `/${sellerSlug}` : "/";

  return (
    <AppLayout>
      <section className="py-6 sm:py-10 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full">
        <Button asChild variant="ghost" className="mb-6 px-0 hover:bg-transparent">
          <Link href={backHref}>
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

              <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                {product.description || "Sem descrição para este produto."}
              </p>

              <div className="rounded-2xl border border-border bg-card p-4">
                {hasPromo ? (
                  <div className="flex items-end gap-3">
                    <span className="text-lg text-muted-foreground line-through">{formatCurrency(product.price)}</span>
                    <span className="text-3xl font-bold text-primary">{formatCurrency(product.promoPrice!)}</span>
                  </div>
                ) : (
                  <span className="text-3xl font-bold text-primary">{formatCurrency(product.price)}</span>
                )}
              </div>

              <Button
                size="lg"
                className="w-full text-base"
                onClick={() => {
                  addItem(product);
                  toast.success("Produto adicionado ao carrinho!");
                }}
              >
                <ShoppingCart className="w-5 h-5 mr-2" />
                Adicionar ao carrinho
              </Button>
            </div>
          </div>
        )}
      </section>
    </AppLayout>
  );
}
