import type { PharmaCatalogFilters } from "./pharma-catalog-query";
import { pharmaCatalogHref, readPharmaFilters } from "./pharma-catalog-query";
import {
  isKitCategoryKey,
  isListedKitProduct,
  isPharmaShowcaseHome,
  KIT_CATEGORY_LABEL,
  KIT_FILTER_KEY,
  normalizeCategoryKey,
} from "./pharma-home-showcases";
import { compareCatalogSales, type CatalogSalesProduct } from "./catalog-sales";

/** Produto do catálogo público. Campos extras vêm no JSON mesmo fora do tipo gerado. */
export type HomeHeroProduct = CatalogSalesProduct & {
  image?: string | null;
  price?: number | null;
  promoPrice?: number | null;
  isActive?: boolean;
  bulkDiscountEnabled?: boolean;
  bulkDiscountTiers?: unknown;
};

export type HomeHeroCard = {
  category: string;
  image: string;
  imageAlt: string;
  fromPrice: number | null;
};

export type HomeHeroFeature = HomeHeroCard & {
  productId: string;
  subtitle: "mais vendido" | "em destaque";
};

export type HomeHeroModel = {
  hero: HomeHeroFeature;
  wide: HomeHeroCard | null;
  small: HomeHeroCard[];
};

const MAX_SMALL_CARDS = 4;

function usableImage(image: unknown): string {
  const src = String(image || "").trim();
  if (/^https?:\/\//i.test(src)) return src;
  if (/^data:image\//i.test(src)) return src;
  return "";
}

function inStock(product: HomeHeroProduct): boolean {
  if (product.isActive === false) return false;
  return product.isSoldOut !== true;
}

/** Preço de 1 unidade, igual ao carrinho: faixa da quantidade 1, senão promoção, senão lista. */
export function homeHeroSalePrice(product: HomeHeroProduct): number | null {
  if (product.bulkDiscountEnabled === true) {
    const tier = oneUnitTierPrice(product.bulkDiscountTiers);
    if (tier != null) return tier;
  }
  const price = Number(product.price);
  const promo = product.promoPrice == null ? null : Number(product.promoPrice);
  if (promo != null && Number.isFinite(promo) && Number.isFinite(price) && promo > 0 && promo < price) {
    return promo;
  }
  if (Number.isFinite(price) && price > 0) return price;
  return null;
}

function oneUnitTierPrice(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  for (const tier of raw) {
    if (!tier || typeof tier !== "object") continue;
    const item = tier as Record<string, unknown>;
    const minQty = Number(item.minQty);
    const maxQty = item.maxQty == null ? null : Number(item.maxQty);
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(minQty) || minQty > 1) continue;
    if (maxQty != null && (!Number.isFinite(maxQty) || maxQty < 1)) continue;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    return unitPrice;
  }
  return null;
}

function categoryName(product: HomeHeroProduct): string {
  return String(product.category || "").trim();
}

/**
 * O card grande prefere estas linhas. A comparação tira acento, junta espaços
 * e ignora maiúsculas. Tirzepatide e Retatrutide também entram.
 */
function isPreferredHeroCategory(category: unknown): boolean {
  const key = normalizeCategoryKey(category);
  return key === "tirzepatida" || key === "tirzepatide" || key === "retatrutida" || key === "retatrutide";
}

function orderCategories(names: string[], preferred: string[]): string[] {
  const rank = new Map(preferred.map((name, index) => [name, index]));
  return [...names].sort((a, b) => {
    const aRank = rank.has(a) ? rank.get(a)! : preferred.length;
    const bRank = rank.has(b) ? rank.get(b)! : preferred.length;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  });
}

function cardFor(category: string, products: HomeHeroProduct[], cover?: HomeHeroProduct): HomeHeroCard | null {
  const available = products.filter((product) => inStock(product) && categoryName(product) === category);
  const withImage = available.filter((product) => usableImage(product.image)).sort(compareCatalogSales);
  const chosen = cover && usableImage(cover.image) ? cover : withImage[0];
  if (!chosen) return null;
  const prices = available
    .map((product) => homeHeroSalePrice(product))
    .filter((price): price is number => price != null);
  return {
    category,
    image: usableImage(chosen.image),
    imageAlt: String(chosen.name || category),
    fromPrice: prices.length > 0 ? Math.min(...prices) : null,
  };
}

const MAX_CATEGORY_CARDS = 1 + MAX_SMALL_CARDS;

/** Um card para toda grafia de Kit. O clique usa `?categoria=kit`. */
function kitHeroCard(products: HomeHeroProduct[], cover?: HomeHeroProduct): HomeHeroCard | null {
  const available = products.filter((product) => isListedKitProduct(product));
  const withImage = available.filter((product) => usableImage(product.image)).sort(compareCatalogSales);
  const chosen = cover && isListedKitProduct(cover) && usableImage(cover.image) ? cover : withImage[0];
  if (!chosen) return null;
  const prices = available
    .map((product) => homeHeroSalePrice(product))
    .filter((price): price is number => price != null);
  return {
    category: KIT_CATEGORY_LABEL,
    image: usableImage(chosen.image),
    imageAlt: String(chosen.name || KIT_CATEGORY_LABEL),
    fromPrice: prices.length > 0 ? Math.min(...prices) : null,
  };
}

function withKitCard(cards: HomeHeroCard[], kit: HomeHeroCard | null): HomeHeroCard[] {
  if (!kit || cards.some((card) => isKitCategoryKey(card.category))) return cards;
  const room = cards.length >= MAX_CATEGORY_CARDS ? cards.slice(0, MAX_CATEGORY_CARDS - 1) : cards;
  return [...room, kit];
}

/** Mantém os cards pequenos em número par. O equilíbrio tira outra categoria, não o Kit. */
function balanceCategoryCards(cards: HomeHeroCard[]): HomeHeroCard[] {
  const next = [...cards];
  while (next.length > 2 && (next.length - 1) % 2 === 1) {
    let removeAt = next.length - 1;
    if (isKitCategoryKey(next[removeAt]?.category)) {
      removeAt = -1;
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (!isKitCategoryKey(next[index]?.category)) {
          removeAt = index;
          break;
        }
      }
      if (removeAt === -1) break;
    }
    next.splice(removeAt, 1);
  }
  return next;
}

/**
 * Hero da home a partir do catálogo já carregado (o da loja do domínio).
 * O destaque prefere Tirzepatida ou Retatrutida (também Tirzepatide/Retatrutide).
 * Entre elas vale o produto à venda, com foto, de maior `soldQty`.
 * Empate segue `compareCatalogSales`. Sem nenhuma das duas à venda com foto,
 * cai no mais vendido de qualquer categoria. O título visível é a categoria desse produto.
 * "A partir de" é o menor preço de 1 unidade dos itens à venda dessa categoria.
 * Se existir produto da categoria Kit à venda com foto, um card Kit ocupa uma
 * das 5 vagas da fileira (largo + até 4 pequenos). Grafias diferentes viram
 * um card. Se o destaque já é Kit, a fileira não ganha outro. Sem Kit à venda
 * com foto, a fileira segue só as outras categorias.
 */
export function buildHomeHero(products: HomeHeroProduct[], categoryOrder: string[] = []): HomeHeroModel | null {
  const groups = new Map<string, HomeHeroProduct[]>();
  for (const product of products) {
    const category = categoryName(product);
    if (!category) continue;
    const list = groups.get(category) ?? [];
    list.push(product);
    groups.set(category, list);
  }

  const ranked = products
    .filter((product) => inStock(product) && categoryName(product) && usableImage(product.image))
    .sort(compareCatalogSales);
  const preferred = ranked.filter((product) => isPreferredHeroCategory(categoryName(product)));
  const best = preferred[0] ?? ranked[0];
  if (!best) return null;

  const heroCategory = categoryName(best);
  const heroIsKit = isKitCategoryKey(heroCategory);
  const kitCard = kitHeroCard(products, heroIsKit ? best : undefined);
  const heroCard = heroIsKit
    ? kitCard ?? cardFor(heroCategory, groups.get(heroCategory) ?? [], best)
    : cardFor(heroCategory, groups.get(heroCategory) ?? [], best);
  if (!heroCard) return null;

  const rest = orderCategories(
    [...groups.keys()].filter((category) => category !== heroCategory && !isKitCategoryKey(category)),
    categoryOrder,
  );
  const cards: HomeHeroCard[] = [];
  for (const category of rest) {
    const card = cardFor(category, groups.get(category) ?? []);
    if (!card) continue;
    cards.push(card);
    if (cards.length >= MAX_CATEGORY_CARDS) break;
  }
  const [wide, ...small] = balanceCategoryCards(withKitCard(cards, heroIsKit ? null : kitCard));
  return {
    hero: {
      ...heroCard,
      productId: best.id,
      subtitle: (Number(best.soldQty) || 0) > 0 ? "mais vendido" : "em destaque",
    },
    wide: wide ?? null,
    small,
  };
}

export function shouldShowHomeHero(input: {
  pharma: boolean;
  search?: string;
  query?: string;
  categories?: string[];
  name?: string;
  brand?: string;
}): boolean {
  if (!input.pharma) return false;
  return isPharmaShowcaseHome(readPharmaFilters(input.search || ""), 1);
}

export function homeHeroCategoryHref(options: {
  category: string;
  homeHref: string;
  mode: "pharma" | "path";
  sellerSlug?: string;
  base?: string;
}): string {
  const rawCategory = String(options.category || "").trim();
  const category = options.mode === "pharma" && isKitCategoryKey(rawCategory) ? KIT_FILTER_KEY : rawCategory;
  if (options.mode === "pharma") {
    const filters: PharmaCatalogFilters = {
      q: "",
      categoria: category,
      marca: "",
      promo: false,
      ordem: "relevancia",
      vitrine: "",
    };
    return pharmaCatalogHref(options.homeHref || "/", filters);
  }
  const prefix = String(options.base || "").replace(/\/$/, "");
  const encoded = encodeURIComponent(category);
  const seller = String(options.sellerSlug || "").trim();
  if (seller) return `${prefix}/${encodeURIComponent(seller)}/categoria/${encoded}`;
  return `${prefix}/categoria/${encoded}`;
}
