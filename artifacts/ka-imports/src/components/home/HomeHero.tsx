import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  buildHomeHero,
  homeHeroCategoryHref,
  type HomeHeroCard,
  type HomeHeroProduct,
} from "@/lib/home-hero";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const cardClass =
  "group relative block overflow-hidden rounded-[1.75rem] border border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)] transition-shadow hover:shadow-[0_1px_2px_rgba(16,24,40,0.06),0_12px_28px_-12px_rgba(16,24,40,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pharma-green,var(--color-primary))] focus-visible:ring-offset-2";

function FromPrice({ value, size }: { value: number | null; size: "lg" | "md" | "sm" }) {
  if (value == null) return null;
  const priceClass = size === "lg"
    ? "text-[28px] leading-none sm:text-4xl"
    : size === "md"
      ? "text-xl leading-none"
      : "text-base leading-none";
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">A partir de</p>
      <p className={`mt-1 font-bold tracking-tight text-neutral-950 ${priceClass}`}>{formatCurrency(value)}</p>
    </div>
  );
}

function ProductShot({
  src,
  alt,
  className,
  imgClassName,
  floating,
}: {
  src: string;
  alt: string;
  className: string;
  imgClassName: string;
  floating?: boolean;
}) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="relative inline-flex max-w-full">
        {floating ? (
          <span
            aria-hidden="true"
            className="ka-home-float-shadow pointer-events-none absolute -bottom-1 left-1/2 h-3.5 w-[72%] rounded-[50%] bg-neutral-900/30 blur-sm"
          />
        ) : null}
        <img
          src={src}
          alt={alt}
          loading={floating ? "eager" : "lazy"}
          decoding="async"
          className={`relative w-auto max-w-full object-contain mix-blend-multiply ${imgClassName} ${floating ? "ka-home-float" : ""}`}
        />
      </div>
    </div>
  );
}

export function HomeHeroSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl" aria-hidden="true">
      <div className="h-[253px] animate-pulse rounded-[1.75rem] bg-white sm:h-[300px]" />
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <div className="col-span-2 h-[112px] animate-pulse rounded-[1.75rem] bg-white lg:h-[164px]" />
        <div className="h-[164px] animate-pulse rounded-[1.75rem] bg-white" />
        <div className="h-[164px] animate-pulse rounded-[1.75rem] bg-white" />
      </div>
    </div>
  );
}

export function HomeHero({
  products,
  categories,
  isLoading,
  homeHref,
  mode,
  sellerSlug,
}: {
  products: HomeHeroProduct[];
  categories: string[];
  isLoading: boolean;
  homeHref: string;
  mode: "pharma" | "path";
  sellerSlug?: string;
}) {
  const model = useMemo(
    () => buildHomeHero(products, categories),
    [products, categories],
  );

  if (isLoading && products.length === 0) {
    return (
      <section className="bg-[#f6f7f9] px-4 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-6" aria-hidden="true">
        <HomeHeroSkeleton />
      </section>
    );
  }
  if (!model) return null;

  const hrefFor = (category: string) => homeHeroCategoryHref({
    category,
    homeHref,
    mode,
    sellerSlug,
    base: BASE,
  });
  const { hero, wide, small } = model;

  return (
    <section className="bg-[#f6f7f9] px-4 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-6" aria-label="Destaques da loja">
      <div className="mx-auto w-full max-w-7xl">
        <Link
          href={hrefFor(hero.category)}
          className={`${cardClass} bg-gradient-to-br from-white via-white to-[var(--pharma-green-soft,color-mix(in_srgb,var(--color-primary)_14%,white))]`}
          aria-label={`Ver ofertas de ${hero.category}`}
        >
          <div className="grid min-h-[253px] grid-cols-[minmax(0,1fr)_42%] items-center gap-2 px-4 py-4 sm:min-h-[300px] sm:grid-cols-[minmax(0,1fr)_44%] sm:px-8 sm:py-8 lg:min-h-[320px] lg:px-12">
            <div className="min-w-0">
              <span className="inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--pharma-green,var(--color-primary))_30%,transparent)] bg-[var(--pharma-green-soft,color-mix(in_srgb,var(--color-primary)_12%,white))] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--pharma-green-ink,var(--color-primary))]">
                Destaque
              </span>
              <h2 className="mt-2.5 text-[26px] font-bold leading-[1.05] tracking-tight text-neutral-950 sm:mt-3 sm:text-4xl lg:text-5xl">
                <span className="block truncate">{hero.category}</span>
                <span className="block text-neutral-500">{hero.subtitle}</span>
              </h2>
              <div className="mt-3 sm:mt-4">
                <FromPrice value={hero.fromPrice} size="lg" />
              </div>
              <span className="mt-3 inline-flex h-11 items-center gap-1.5 rounded-full bg-[var(--pharma-green,var(--color-primary))] px-4 text-sm font-semibold text-white transition-colors group-hover:bg-[var(--pharma-green-strong,var(--color-primary))] sm:mt-4">
                Ver ofertas
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <ProductShot
              src={hero.image}
              alt={hero.imageAlt}
              floating
              className="py-1"
              imgClassName="max-h-[148px] sm:max-h-[220px] lg:max-h-[280px]"
            />
          </div>
        </Link>

        {wide || small.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-6">
            {wide ? (
              <CategoryLink
                href={hrefFor(wide.category)}
                card={wide}
                wide
                alone={small.length === 0}
              />
            ) : null}
            {small.map((card) => (
              <CategoryLink key={card.category} href={hrefFor(card.category)} card={card} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CategoryLink({
  href,
  card,
  wide,
  alone,
}: {
  href: string;
  card: HomeHeroCard;
  wide?: boolean;
  alone?: boolean;
}) {
  if (wide) {
    return (
      <Link
        href={href}
        className={`${cardClass} col-span-2 min-h-[112px] ${alone ? "lg:col-span-6" : ""}`}
        aria-label={`Ver ${card.category}`}
      >
        <div className="grid h-full grid-cols-[minmax(0,1fr)_38%] items-center gap-2 p-4 lg:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--pharma-green-ink,var(--color-primary))]">Linha</p>
            <h3 className="mt-0.5 truncate text-lg font-bold tracking-tight text-neutral-950">{card.category}</h3>
            <div className="mt-2">
              <FromPrice value={card.fromPrice} size="md" />
            </div>
          </div>
          <ProductShot
            src={card.image}
            alt={card.imageAlt}
            className="h-[96px] lg:h-[108px]"
            imgClassName="max-h-[96px] lg:max-h-[108px]"
          />
        </div>
      </Link>
    );
  }

  return (
    <Link href={href} className={`${cardClass} h-[164px] lg:h-full lg:min-h-[164px]`} aria-label={`Ver ${card.category}`}>
      <div className="flex h-full flex-col px-3.5 pb-2.5 pt-3">
        <ProductShot
          src={card.image}
          alt={card.imageAlt}
          className="h-[64px] w-full"
          imgClassName="max-h-[64px]"
        />
        <h3 className="mt-1.5 truncate text-[15px] font-bold leading-tight tracking-tight text-neutral-950">{card.category}</h3>
        <div className="mt-1">
          <FromPrice value={card.fromPrice} size="sm" />
        </div>
      </div>
    </Link>
  );
}
