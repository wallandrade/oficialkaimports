import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useGetProducts } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { isProductUnavailable, useCart } from "@/store/use-cart";
import { fetchAndCacheSellerWhatsApp, formatCurrency, setSellerContext } from "@/lib/utils";
import {
  allModeImageUrls,
  orderSelectedVariants,
  parseVariantGroups,
  resolveVariantLineImage,
  variantSelectionMessage,
  type SelectedVariant,
  type VariantGroup,
} from "@/lib/product-variants";
import { ArrowLeft, Loader2, Minus, Plus, ShoppingCart, Zap } from "lucide-react";
import { toast } from "sonner";
import { isPharmaCompactPreset, useStoreThemePreset } from "@/lib/store-theme";

type BulkDiscountTier = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
  label?: string | null;
};

const PRODUCT_IMAGE_FALLBACK = "https://placehold.co/800x800/1a2b4a/ffffff?text=KA+Imports";

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

function VariantHero({ images, singleSrc, alt }: { images: string[]; singleSrc: string; alt: string }) {
  if (images.length <= 1) {
    return <img src={images[0] || singleSrc} alt={alt} className="w-full h-full object-cover aspect-square" />;
  }
  const rows = Math.ceil(images.length / 2);
  return (
    <div
      className="grid w-full aspect-square"
      style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
    >
      {images.map((src, index) => {
        const span = images.length % 2 === 1 && index === images.length - 1;
        return (
          <img
            key={`${src}-${index}`}
            src={src}
            alt=""
            className={`h-full w-full min-h-0 object-cover ${span ? "col-span-2" : ""}`}
          />
        );
      })}
    </div>
  );
}

function tierForQuantity(quantity: number, tiers: BulkDiscountTier[]): BulkDiscountTier | null {
  return tiers.find((tier) => quantity >= tier.minQty && (tier.maxQty == null || quantity <= tier.maxQty)) ?? null;
}

type ProgressiveOption = {
  quantity: number;
  quantityLabel: string;
  unitPrice: number;
  totalPrice: number;
};

function PharmaPriceTable({
  options,
  quantity,
  image,
  retailUnitPrice,
  unitPrice,
  disabled,
  soldOut,
  onQuantityChange,
  onAdd,
}: {
  options: ProgressiveOption[];
  quantity: number;
  image: string;
  retailUnitPrice: number;
  unitPrice: number;
  disabled: boolean;
  soldOut: boolean;
  onQuantityChange: (quantity: number) => void;
  onAdd: () => void;
}) {
  const selectedQuantity = quantity >= 4 ? 4 : quantity;
  const nextDeal = options.find((option) => option.quantity > quantity && option.unitPrice < unitPrice - 0.009);
  const nextOff = nextDeal && retailUnitPrice > 0
    ? Math.max(1, Math.round((1 - nextDeal.unitPrice / retailUnitPrice) * 100))
    : 0;

  return (
    <div className="space-y-4">
      <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Tabela de preços</p>
      <div className="grid grid-cols-4 gap-2">
        {options.map((option) => {
          const selected = option.quantity === selectedQuantity;
          const off = retailUnitPrice > option.unitPrice && retailUnitPrice > 0
            ? Math.max(1, Math.round((1 - option.unitPrice / retailUnitPrice) * 100))
            : 0;
          return (
            <button
              key={option.quantity}
              type="button"
              onClick={() => onQuantityChange(option.quantity)}
              className={`flex min-w-0 flex-col items-center rounded-2xl border px-1.5 py-2 text-center ${selected ? "border-[var(--pharma-green,#22c55e)] bg-[var(--pharma-green-soft,#e8f8ee)]" : "border-neutral-200 bg-white"}`}
            >
              <div className="mb-1 flex justify-center -space-x-1.5">
                {Array.from({ length: option.quantity }).map((_, index) => (
                  <span key={`${option.quantityLabel}-${index}`} className="h-6 w-6 overflow-hidden rounded-full border border-white bg-neutral-100">
                    <img src={image} alt="" className="h-full w-full object-cover" />
                  </span>
                ))}
              </div>
              <span className="text-[11px] font-semibold text-neutral-500">{option.quantityLabel}</span>
              {off > 0 ? (
                <span className="text-[10px] text-neutral-400 line-through">{formatCurrency(retailUnitPrice)}</span>
              ) : null}
              <span className={`text-xs font-bold leading-tight ${selected ? "text-[var(--pharma-green-ink,#166534)]" : "text-neutral-900"}`}>
                {formatCurrency(option.unitPrice)}
              </span>
              {off > 0 ? (
                <span className="mt-0.5 text-[10px] font-semibold text-[var(--pharma-green-ink,#166534)]">-{off}%</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-neutral-500">Qtd</span>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200"
            onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
            aria-label="Diminuir quantidade"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-6 text-center text-sm font-bold">{quantity}</span>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200"
            onClick={() => onQuantityChange(Math.min(99, quantity + 1))}
            aria-label="Aumentar quantidade"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase text-neutral-400">Total</p>
          <p className="text-base font-bold text-neutral-900">{formatCurrency(unitPrice * quantity)}</p>
        </div>
      </div>

      {nextDeal ? (
        <p className="rounded-xl bg-[var(--pharma-green-soft,#e8f8ee)] px-3 py-2 text-xs text-[var(--pharma-green-ink,#166534)]">
          Adicione mais {nextDeal.quantity - quantity} un. para garantir preço de atacado ({formatCurrency(nextDeal.unitPrice)}) e economize {nextOff}% vs varejo.
        </p>
      ) : null}

      <Button
        size="lg"
        className="h-12 w-full rounded-xl bg-[var(--pharma-green,#22c55e)] text-base text-white hover:bg-[var(--pharma-green-strong,#16a34a)]"
        disabled={disabled}
        onClick={onAdd}
      >
        <ShoppingCart className="mr-2 h-5 w-5" />
        {soldOut ? "Produto esgotado" : "Adicionar ao carrinho"}
      </Button>
    </div>
  );
}

function PharmaSingleBuy({
  quantity,
  image,
  unitPrice,
  listPrice,
  disabled,
  soldOut,
  onQuantityChange,
  onAdd,
  onBuyNow,
}: {
  quantity: number;
  image: string;
  unitPrice: number;
  listPrice: number;
  disabled: boolean;
  soldOut: boolean;
  onQuantityChange: (quantity: number) => void;
  onAdd: () => void;
  onBuyNow: () => void;
}) {
  const iconCount = Math.min(quantity, 4);
  const total = unitPrice * quantity;
  const showList = listPrice > unitPrice;

  return (
    <div className="space-y-4">
      <div className="flex justify-center -space-x-2">
        {Array.from({ length: iconCount }).map((_, index) => (
          <span key={index} className="h-10 w-10 overflow-hidden rounded-full border-2 border-white bg-neutral-100 shadow-sm">
            <img src={image} alt="" className="h-full w-full object-cover" />
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-neutral-500">Qtd</span>
          <div className="flex items-center rounded-full bg-white px-1 shadow-sm">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center"
              onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
              aria-label="Diminuir quantidade"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-6 text-center text-sm font-bold">{quantity}</span>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center"
              onClick={() => onQuantityChange(Math.min(99, quantity + 1))}
              aria-label="Aumentar quantidade"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase text-neutral-400">Total</p>
          <p className="text-base font-bold text-neutral-900">{formatCurrency(total)}</p>
          {showList ? (
            <p className="text-xs text-neutral-400 line-through">{formatCurrency(listPrice * quantity)}</p>
          ) : null}
        </div>
      </div>

      <Button
        size="lg"
        variant="outline"
        className="h-12 w-full rounded-xl border-neutral-200 bg-white text-base text-neutral-900"
        disabled={disabled}
        onClick={onAdd}
      >
        <ShoppingCart className="mr-2 h-5 w-5" />
        {soldOut ? "Produto esgotado" : "Adicionar ao carrinho"}
      </Button>
      <Button
        size="lg"
        className="h-12 w-full rounded-xl bg-[var(--pharma-green,#22c55e)] text-base text-white hover:bg-[var(--pharma-green-strong,#16a34a)]"
        disabled={disabled}
        onClick={onBuyNow}
      >
        <Zap className="mr-2 h-5 w-5" />
        {soldOut ? "Produto esgotado" : "Comprar agora"}
      </Button>
    </div>
  );
}

function safeGetStorage(key: string): string {
  try {
    return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export default function ProductDetail() {
  const [, paramsSeller] = useRoute("/:seller/produto/:id");
  const [, paramsGlobal] = useRoute("/produto/:id");
  const [, setLocation] = useLocation();
  const { addItem, setIsOpen, showAddedNotice } = useCart();
  const isPharma = isPharmaCompactPreset(useStoreThemePreset());

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
    setSellerContext(sellerSlug);
  }

  useEffect(() => {
    if (!sellerSlug) return;
    fetchAndCacheSellerWhatsApp(sellerSlug);
  }, [sellerSlug]);

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
  const oneBoxTier = useMemo(
    () => tierForQuantity(1, bulkDiscountTiers),
    [bulkDiscountTiers],
  );
  const progressiveUnitPrice = oneBoxTier?.unitPrice ?? null;
  const shouldUseProgressiveUnitPrice = isBulkDiscountEnabled && progressiveUnitPrice != null;
  const displayUnitPrice = product
    ? (shouldUseProgressiveUnitPrice
      ? progressiveUnitPrice!
      : (hasPromo ? product.promoPrice! : product.price))
    : 0;

  const progressiveOptions = useMemo(() => {
    if (!product || !isBulkDiscountEnabled || bulkDiscountTiers.length === 0) return [];
    const basePrice = displayUnitPrice;

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
  }, [product, bulkDiscountTiers, displayUnitPrice, isBulkDiscountEnabled]);
  const variantGroups = useMemo(
    () => parseVariantGroups((product as { variantGroups?: unknown } | null)?.variantGroups),
    [product],
  );
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string[]>>({});
  const [boxQty, setBoxQty] = useState(1);

  useEffect(() => {
    setSelectedByGroup({});
    setBoxQty(1);
  }, [product?.id]);

  const selectedVariants = useMemo<SelectedVariant[]>(
    () => orderSelectedVariants(
      variantGroups,
      variantGroups.flatMap((group) => (selectedByGroup[group.name] ?? []).map((option) => ({
        groupName: group.name,
        option,
      }))),
    ),
    [variantGroups, selectedByGroup],
  );
  const variantError = variantSelectionMessage(variantGroups, selectedVariants);
  const hasRequiredVariants = variantError == null;
  const galleryImages = allModeImageUrls(variantGroups, selectedVariants);
  const singleImage = resolveVariantLineImage(variantGroups, selectedVariants, product?.image) || PRODUCT_IMAGE_FALLBACK;

  function toggleVariant(group: VariantGroup, label: string) {
    setSelectedByGroup((prev) => {
      const current = prev[group.name] ?? [];
      const exists = current.includes(label);
      if (group.maxSelect <= 1) {
        return { ...prev, [group.name]: exists ? [] : [label] };
      }
      if (exists) return { ...prev, [group.name]: current.filter((item) => item !== label) };
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.name]: [...current, label] };
    });
  }

  function rejectVariantSelection() {
    if (!variantError) return false;
    toast.error(variantError);
    return true;
  }
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
              <VariantHero images={galleryImages} singleSrc={singleImage} alt={product.name} />
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-secondary">{product.category}</p>
                <h1 className="text-3xl font-bold text-foreground mt-2 leading-tight">{product.name}</h1>
              </div>

              {!isPharma ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                {displayUnitPrice < product.price ? (
                  <div className="flex items-end gap-3">
                    <span className="text-lg text-muted-foreground line-through">{formatCurrency(product.price)}</span>
                    <span className="text-3xl font-bold text-primary">{formatCurrency(displayUnitPrice)}</span>
                  </div>
                ) : (
                  <span className="text-3xl font-bold text-primary">{formatCurrency(displayUnitPrice)}</span>
                )}
                {isSoldOut && (
                  <p className="mt-2 text-sm font-semibold text-destructive">Produto esgotado no momento.</p>
                )}
              </div>
              ) : isSoldOut ? (
                <p className="text-sm font-semibold text-destructive">Produto esgotado no momento.</p>
              ) : null}

              {variantGroups.length > 0 && (
                <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
                  <p className="text-sm font-semibold text-foreground">Escolha as variantes</p>
                  {variantGroups.map((group) => {
                    const picked = selectedByGroup[group.name] ?? [];
                    const atMax = group.maxSelect > 1 && picked.length >= group.maxSelect;
                    return (
                      <div key={group.name} className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.name}</p>
                          {group.maxSelect > 1 && (
                            <span className="text-xs font-semibold text-primary">{picked.length} de {group.maxSelect}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {group.options.map((option) => {
                            const selected = picked.includes(option.label);
                            const locked = atMax && !selected;
                            return (
                              <button
                                key={option.label}
                                type="button"
                                disabled={locked}
                                onClick={() => toggleVariant(group, option.label)}
                                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${selected ? "border-primary bg-primary/5" : "border-border bg-white"} ${locked ? "cursor-not-allowed opacity-40" : "hover:border-primary/50"}`}
                              >
                                <img
                                  src={option.image || product.image || PRODUCT_IMAGE_FALLBACK}
                                  alt=""
                                  className="h-10 w-10 rounded-lg object-cover"
                                />
                                <span className="text-sm font-medium text-foreground">{option.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {variantError && (
                <p className="text-sm font-medium text-amber-700">{variantError}</p>
              )}

              {progressiveOptions.length > 0 && isPharma ? (
                <PharmaPriceTable
                  options={progressiveOptions}
                  quantity={boxQty}
                  image={singleImage}
                  retailUnitPrice={progressiveOptions[0]?.unitPrice ?? displayUnitPrice}
                  unitPrice={tierForQuantity(boxQty, bulkDiscountTiers)?.unitPrice ?? displayUnitPrice}
                  disabled={isSoldOut || !hasRequiredVariants}
                  soldOut={isSoldOut}
                  onQuantityChange={setBoxQty}
                  onAdd={() => {
                    if (isSoldOut) {
                      toast.error("Este produto está esgotado e não pode ser adicionado.");
                      return;
                    }
                    if (rejectVariantSelection()) return;
                    const unitPrice = tierForQuantity(boxQty, bulkDiscountTiers)?.unitPrice ?? displayUnitPrice;
                    addItem(product, {
                      quantity: boxQty,
                      unitPrice,
                      selectedVariants,
                    });
                    showAddedNotice({
                      name: product.name,
                      image: product.image ?? null,
                      quantity: boxQty,
                    });
                  }}
                />
              ) : progressiveOptions.length > 0 ? (
                <div className="space-y-3">
                  {progressiveOptions.map((option) => (
                    <div key={option.quantity} className="rounded-2xl border border-border bg-card p-3 sm:p-4">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2">
                            {Array.from({ length: option.quantity }).map((_, index) => (
                              <div key={`${option.quantityLabel}-${index}`} className="w-8 h-8 rounded-full border border-white shadow-sm overflow-hidden bg-muted">
                                <img
                                  src={singleImage}
                                  alt={`${product.name} ${index + 1}`}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-primary text-sm font-semibold">
                            {option.quantityLabel}
                          </span>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">{formatCurrency(option.unitPrice)} cada</p>
                          <p className="font-bold text-primary">Total {formatCurrency(option.totalPrice)}</p>
                        </div>
                      </div>

                      <Button
                        size="lg"
                        className="w-full text-base"
                        disabled={isSoldOut || !hasRequiredVariants}
                        onClick={() => {
                          if (isSoldOut) {
                            toast.error("Este produto está esgotado e não pode ser adicionado.");
                            return;
                          }
                          if (rejectVariantSelection()) return;
                          addItem(product, {
                            quantity: option.quantity,
                            unitPrice: option.unitPrice,
                            selectedVariants,
                          });
                          toast.success(`${option.quantityLabel} adicionado ao carrinho!`);
                        }}
                      >
                        <ShoppingCart className="w-5 h-5 mr-2" />
                        {isSoldOut ? "Produto esgotado" : `Adicionar ${option.quantityLabel}`}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : isPharma ? (
                <PharmaSingleBuy
                  quantity={boxQty}
                  image={singleImage}
                  unitPrice={displayUnitPrice}
                  listPrice={product.price}
                  disabled={isSoldOut || !hasRequiredVariants}
                  soldOut={isSoldOut}
                  onQuantityChange={setBoxQty}
                  onAdd={() => {
                    if (isSoldOut) {
                      toast.error("Este produto está esgotado e não pode ser adicionado.");
                      return;
                    }
                    if (rejectVariantSelection()) return;
                    addItem(product, {
                      quantity: boxQty,
                      unitPrice: displayUnitPrice,
                      selectedVariants,
                    });
                    setIsOpen(false);
                    showAddedNotice({
                      name: product.name,
                      image: product.image ?? null,
                      quantity: boxQty,
                    });
                  }}
                  onBuyNow={() => {
                    if (isSoldOut) {
                      toast.error("Este produto está esgotado e não pode ser adicionado.");
                      return;
                    }
                    if (rejectVariantSelection()) return;
                    addItem(product, {
                      quantity: boxQty,
                      unitPrice: displayUnitPrice,
                      selectedVariants,
                    });
                    setIsOpen(false);
                    setLocation(sellerSlug ? `/${sellerSlug}/checkout` : "/checkout");
                  }}
                />
              ) : (
                <Button
                  size="lg"
                  className="w-full text-base"
                  disabled={isSoldOut || !hasRequiredVariants}
                  onClick={() => {
                    if (isSoldOut) {
                      toast.error("Este produto está esgotado e não pode ser adicionado.");
                      return;
                    }
                    if (rejectVariantSelection()) return;
                    addItem(product, { selectedVariants });
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
