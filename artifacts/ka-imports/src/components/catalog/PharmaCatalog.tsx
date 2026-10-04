import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import type { Product } from "@workspace/api-client-react";
import { ProductCard } from "@/components/product/ProductCard";
import { pharmaCatalogHref, readPharmaFilters, type PharmaCatalogFilters, type PharmaCatalogSort } from "@/lib/pharma-catalog-query";
import { sortCatalogProducts } from "@/lib/catalog-sales";
import {
  buildPharmaShowcases,
  comparePharmaCategory,
  comparePharmaLaunches,
  comparePharmaSoldQty,
  isPeptideCategoryKey,
  isPharmaShowcaseHome,
  pharmaCategoryMatches,
  pharmaCategorySelected,
} from "@/lib/pharma-home-showcases";
import { Check, ChevronDown, Loader2, Search, SlidersHorizontal, X } from "lucide-react";

const PAGE_SIZE = 24;

const SORT_OPTIONS: Array<{ id: PharmaCatalogSort; label: string }> = [
  { id: "relevancia", label: "Relevância" },
  { id: "menor", label: "Menor Preço" },
  { id: "maior", label: "Maior Preço" },
  { id: "nome", label: "Nome (A-Z)" },
];

type OfferProduct = Product & {
  brand?: string | null;
  bulkDiscountEnabled?: boolean;
  bulkDiscountTiers?: unknown;
  isLaunch?: boolean;
  isSoldOut?: boolean;
  soldQty?: number;
  sortOrder?: number;
  createdAt?: string;
};

function productBrand(product: OfferProduct): string {
  return String(product.brand || "").trim();
}

function productHasOffer(product: OfferProduct): boolean {
  if (product.promoPrice != null && product.promoPrice < product.price) return true;
  if (product.bulkDiscountEnabled !== true) return false;
  return Array.isArray(product.bulkDiscountTiers) && product.bulkDiscountTiers.length > 0;
}

function matchesFilters(product: OfferProduct, filters: PharmaCatalogFilters): boolean {
  const q = filters.q.trim().toLowerCase();
  if (q) {
    const name = product.name.toLowerCase();
    const description = String(product.description || "").toLowerCase();
    if (!name.includes(q) && !description.includes(q)) return false;
  }
  if (filters.categoria && !pharmaCategoryMatches(product.category, filters.categoria)) return false;
  if (filters.vitrine === "lancamentos" && product.isLaunch !== true) return false;
  if (filters.marca && productBrand(product).toLowerCase() !== filters.marca.toLowerCase()) return false;
  if (filters.promo && !productHasOffer(product)) return false;
  return true;
}

function sellingPrice(product: OfferProduct): number {
  if (product.bulkDiscountEnabled === true && Array.isArray(product.bulkDiscountTiers)) {
    const tiers = product.bulkDiscountTiers as Array<{ minQty?: number; maxQty?: number | null; unitPrice?: number }>;
    const oneBox = tiers.find((tier) => {
      const minQty = Number(tier.minQty);
      const maxQty = tier.maxQty == null ? null : Number(tier.maxQty);
      return minQty <= 1 && (maxQty == null || maxQty >= 1);
    });
    const unitPrice = Number(oneBox?.unitPrice);
    if (Number.isFinite(unitPrice) && unitPrice > 0) return unitPrice;
  }
  if (product.promoPrice != null && product.promoPrice < product.price) return product.promoPrice;
  return product.price;
}

function sortPharmaRelevance(products: OfferProduct[], filters: PharmaCatalogFilters): OfferProduct[] {
  if (filters.vitrine === "lancamentos") return [...products].sort(comparePharmaLaunches);
  if (filters.vitrine === "vendidos") return [...products].sort(comparePharmaSoldQty);
  if (filters.categoria.trim()) {
    const peptide = isPeptideCategoryKey(filters.categoria);
    return [...products].sort((a, b) => comparePharmaCategory(a, b, peptide));
  }
  return sortCatalogProducts(products, filters.categoria);
}

function sortPharmaProducts(products: OfferProduct[], filters: PharmaCatalogFilters): OfferProduct[] {
  const relevant = sortPharmaRelevance(products, filters);
  if (filters.ordem === "menor") return [...relevant].sort((a, b) => sellingPrice(a) - sellingPrice(b));
  if (filters.ordem === "maior") return [...relevant].sort((a, b) => sellingPrice(b) - sellingPrice(a));
  if (filters.ordem === "nome") {
    return [...relevant].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  }
  return relevant;
}

function uniqueBrands(products: OfferProduct[]): string[] {
  const map = new Map<string, string>();
  products.forEach((product) => {
    const brand = productBrand(product);
    if (!brand) return;
    const key = brand.toLocaleLowerCase("pt-BR");
    if (!map.has(key)) map.set(key, brand);
  });
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
}

export function PharmaCatalog({
  products,
  categories,
  isLoading,
  isError,
  sellerSlug,
  homeHref,
}: {
  products: Product[];
  categories: string[];
  isLoading: boolean;
  isError: boolean;
  sellerSlug?: string;
  homeHref: string;
}) {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const applied = readPharmaFilters(searchString);
  const catalog = products as OfferProduct[];
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftCategory, setDraftCategory] = useState(applied.categoria);
  const [draftBrand, setDraftBrand] = useState(applied.marca);
  const [draftPromo, setDraftPromo] = useState(applied.promo);
  const [brandQuery, setBrandQuery] = useState("");
  const [showAllBrands, setShowAllBrands] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPage(1);
  }, [applied.q, applied.categoria, applied.marca, applied.promo, applied.ordem, applied.vitrine]);

  useEffect(() => {
    if (!sortOpen) return;
    function handlePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (sortRef.current && !sortRef.current.contains(target)) setSortOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
    };
  }, [sortOpen]);

  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sheetOpen]);

  const filtered = useMemo(
    () => sortPharmaProducts(catalog.filter((product) => matchesFilters(product, applied)), applied),
    [catalog, applied],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const rangeFrom = filtered.length === 0 ? 0 : start + 1;
  const rangeTo = start + pageItems.length;

  const draftFilters: PharmaCatalogFilters = {
    q: applied.q,
    categoria: draftCategory,
    marca: draftBrand,
    promo: draftPromo,
    ordem: applied.ordem,
    vitrine: applied.vitrine,
  };
  const showHome = isPharmaShowcaseHome(applied, page);
  const showcases = useMemo(() => (showHome ? buildPharmaShowcases(catalog) : []), [showHome, catalog]);
  const sortLabel = SORT_OPTIONS.find((option) => option.id === applied.ordem)?.label || "Relevância";
  const draftProducts = catalog.filter((product) => matchesFilters(product, {
    ...draftFilters,
    vitrine: draftCategory.trim() ? "" : applied.vitrine,
  }));
  const promoScope = catalog.filter((product) => {
    if (draftCategory && !pharmaCategoryMatches(product.category, draftCategory)) return false;
    return productHasOffer(product);
  });
  const brandSource = catalog.filter((product) => !draftCategory || pharmaCategoryMatches(product.category, draftCategory));
  const brandOptions = uniqueBrands(brandSource).filter((brand) => {
    const query = brandQuery.trim().toLowerCase();
    return !query || brand.toLowerCase().includes(query);
  });
  const visibleBrands = showAllBrands ? brandOptions : brandOptions.slice(0, 12);
  const activeFilterCount = [applied.categoria, applied.marca, applied.promo ? "1" : "", applied.vitrine].filter(Boolean).length;

  function go(next: PharmaCatalogFilters) {
    setLocation(pharmaCatalogHref(homeHref, next));
  }

  function openSheet() {
    setDraftCategory(applied.categoria);
    setDraftBrand(applied.marca);
    setDraftPromo(applied.promo);
    setBrandQuery("");
    setShowAllBrands(false);
    setSheetOpen(true);
  }

  function applySheet() {
    go({
      ...draftFilters,
      vitrine: draftCategory.trim() ? "" : applied.vitrine,
    });
    setSheetOpen(false);
  }

  return (
    <section className="w-full flex-1 bg-[#f6f7f9] px-3 py-4 sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        {!showHome && (
          <h2 className="mb-3 text-2xl font-bold tracking-tight text-neutral-900">Produtos</h2>
        )}

        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={openSheet}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3.5 text-sm font-semibold text-neutral-800"
          >
            <SlidersHorizontal className="h-4 w-4 text-[var(--pharma-green-ink,#166534)]" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--pharma-green,#22c55e)] px-1 text-[11px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          <div ref={sortRef} className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSortOpen((open) => !open)}
              className="inline-flex h-10 w-full items-center justify-between rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-800"
              aria-expanded={sortOpen}
            >
              <span>{sortLabel}</span>
              <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${sortOpen ? "rotate-180" : ""}`} />
            </button>
            {sortOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl bg-neutral-700 py-1 text-white shadow-xl">
                {SORT_OPTIONS.map((option) => {
                  const selected = applied.ordem === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        go({ ...applied, ordem: option.id });
                        setSortOpen(false);
                        setPage(1);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-white/10"
                    >
                      <Check className={`h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {(applied.categoria || applied.marca || applied.promo || applied.vitrine) && (
          <div className="mb-3 flex flex-wrap gap-2">
            {applied.categoria && (
              <button type="button" onClick={() => go({ ...applied, categoria: "" })} className="inline-flex items-center gap-1 rounded-full bg-[var(--pharma-green-soft,#e8f8ee)] px-3 py-1 text-sm font-medium text-[var(--pharma-green-ink,#166534)]">
                {applied.categoria}
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {applied.marca && (
              <button type="button" onClick={() => go({ ...applied, marca: "" })} className="inline-flex items-center gap-1 rounded-full bg-[var(--pharma-green-soft,#e8f8ee)] px-3 py-1 text-sm font-medium text-[var(--pharma-green-ink,#166534)]">
                {applied.marca}
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {applied.promo && (
              <button type="button" onClick={() => go({ ...applied, promo: false })} className="inline-flex items-center gap-1 rounded-full bg-[var(--pharma-green-soft,#e8f8ee)] px-3 py-1 text-sm font-medium text-[var(--pharma-green-ink,#166534)]">
                Promoções
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {applied.vitrine && (
              <button type="button" onClick={() => go({ ...applied, vitrine: "" })} className="inline-flex items-center gap-1 rounded-full bg-[var(--pharma-green-soft,#e8f8ee)] px-3 py-1 text-sm font-medium text-[var(--pharma-green-ink,#166534)]">
                {applied.vitrine === "lancamentos" ? "Novidades" : "Mais vendidos"}
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {!showHome && (
          <div className="mb-3 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-500">
            {filtered.length === 0 ? "0 de 0" : `${rangeFrom}–${rangeTo} de ${filtered.length}`}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="mb-3 h-10 w-10 animate-spin text-[var(--pharma-green,#22c55e)]" />
            <p className="text-sm text-neutral-500">Carregando catálogo...</p>
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-8 text-center text-red-700">
            Não foi possível carregar os produtos.
          </div>
        ) : showHome ? (
          showcases.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-12 text-center">
              <p className="font-semibold text-neutral-900">Nenhum produto encontrado</p>
            </div>
          ) : (
            <div className="space-y-8">
              {showcases.map((section) => {
                const centeredAction = section.id === "tirzepatida" || section.id === "retatrutida" || section.id === "lancamentos";
                const openSection = () => go({
                  q: "",
                  categoria: section.categoria,
                  marca: "",
                  promo: false,
                  ordem: "relevancia",
                  vitrine: section.vitrine,
                });
                return (
                <section key={section.id}>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <h2 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">{section.title}</h2>
                    {!centeredAction && (
                      <button
                        type="button"
                        className="shrink-0 text-sm font-semibold text-[var(--pharma-green,#22c55e)]"
                        aria-label={section.ariaLabel}
                        onClick={openSection}
                      >
                        {section.actionLabel} →
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                    {section.products.map((product, index) => (
                      <ProductCard
                        key={`${section.id}-${product.id}`}
                        product={product}
                        sellerSlug={sellerSlug}
                        priority={section.id === "tirzepatida" && index < 4}
                        layout="pharma"
                      />
                    ))}
                  </div>
                  {centeredAction && (
                    <div className="mt-6 flex justify-center">
                      <button
                        type="button"
                        className="inline-flex h-11 items-center rounded-full bg-[var(--pharma-green,#22c55e)] px-6 text-sm font-semibold text-white"
                        aria-label={section.ariaLabel}
                        onClick={openSection}
                      >
                        {section.actionLabel} →
                      </button>
                    </div>
                  )}
                </section>
                );
              })}
            </div>
          )
        ) : pageItems.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-12 text-center">
            <p className="font-semibold text-neutral-900">Nenhum produto encontrado</p>
            <button
              type="button"
              className="mt-4 text-sm font-semibold text-[var(--pharma-green-ink,#166534)]"
              onClick={() => go({ q: "", categoria: "", marca: "", promo: false, ordem: "relevancia", vitrine: "" })}
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {pageItems.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                sellerSlug={sellerSlug}
                priority={index < 4}
                layout="pharma"
              />
            ))}
          </div>
        )}

        {!showHome && pageCount > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="h-10 rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={safePage >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              className="h-10 rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        )}
      </div>

      {sheetOpen && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <h3 className="inline-flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-4 w-4 text-[var(--pharma-green-ink,#166534)]" />
              Filtros
            </h3>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="text-sm font-semibold text-[var(--pharma-green-ink,#166534)]"
                onClick={() => {
                  setDraftCategory("");
                  setDraftBrand("");
                  setDraftPromo(false);
                  setBrandQuery("");
                }}
              >
                Limpar
              </button>
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="Fechar filtros">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <button
              type="button"
              onClick={() => setDraftPromo((value) => !value)}
              className="mb-5 flex w-full items-center justify-between rounded-full border border-neutral-200 px-4 py-3 text-left"
            >
              <span className="text-sm font-medium">Apenas Promoções</span>
              <span className="flex items-center gap-3">
                <span className="text-sm text-neutral-400">{promoScope.length}</span>
                <span className={`relative h-6 w-11 rounded-full ${draftPromo ? "bg-[var(--pharma-green,#22c55e)]" : "bg-neutral-200"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${draftPromo ? "left-5" : "left-0.5"}`} />
                </span>
              </span>
            </button>

            <p className="mb-2 text-sm font-semibold text-neutral-800">Categorias</p>
            <div className="mb-5 space-y-1">
              <button
                type="button"
                onClick={() => {
                  setDraftCategory("");
                  setDraftBrand("");
                }}
                className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ${draftCategory ? "text-neutral-700" : "bg-[var(--pharma-green,#22c55e)] font-semibold text-white"}`}
              >
                Todas
              </button>
              {categories.map((category) => {
                const selected = pharmaCategorySelected(category, draftCategory);
                return (
                  <button
                    key={`sheet-${category}`}
                    type="button"
                    onClick={() => {
                      setDraftCategory(selected ? "" : category);
                      setDraftBrand("");
                    }}
                    className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ${selected ? "bg-[var(--pharma-green,#22c55e)] font-semibold text-white" : "text-neutral-700"}`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>

            <p className="mb-2 text-sm font-semibold text-neutral-800">
              {draftCategory ? `Marcas em ${draftCategory}` : "Marcas"}
            </p>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={brandQuery}
                onChange={(event) => setBrandQuery(event.target.value)}
                placeholder="Filtrar marcas..."
                className="h-11 w-full rounded-full border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDraftBrand("")}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${draftBrand ? "bg-neutral-100 text-neutral-700" : "bg-[var(--pharma-green,#22c55e)] text-white"}`}
              >
                Todas
              </button>
              {visibleBrands.map((brand) => {
                const selected = draftBrand.toLowerCase() === brand.toLowerCase();
                return (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => setDraftBrand(selected ? "" : brand)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${selected ? "bg-[var(--pharma-green,#22c55e)] text-white" : "bg-neutral-100 text-neutral-700"}`}
                  >
                    {brand}
                  </button>
                );
              })}
            </div>
            {brandOptions.length > 12 && (
              <button
                type="button"
                className="mt-3 text-sm font-semibold text-[var(--pharma-green-ink,#166534)]"
                onClick={() => setShowAllBrands((value) => !value)}
              >
                {showAllBrands ? "Ver menos marcas" : "Ver mais marcas"}
              </button>
            )}
          </div>

          <div className="border-t border-neutral-100 p-4">
            <button
              type="button"
              onClick={applySheet}
              className="h-12 w-full rounded-xl bg-[var(--pharma-green,#22c55e)] text-base font-semibold text-white"
            >
              Ver {draftProducts.length} produtos
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
