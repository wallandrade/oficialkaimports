import type { PharmaCatalogFilters } from "./pharma-catalog-query";

export type PharmaShowcaseProduct = {
  id: string;
  name: string;
  category?: string;
  brand?: string | null;
  isSoldOut?: boolean;
  isLaunch?: boolean;
  sortOrder?: number;
  createdAt?: string;
  soldQty?: number;
};

export type PharmaShowcaseId = "tirzepatida" | "retatrutida" | "vendidos" | "lancamentos" | "peptideo";

export type PharmaShowcaseSection<T extends PharmaShowcaseProduct = PharmaShowcaseProduct> = {
  id: PharmaShowcaseId;
  title: string;
  actionLabel: string;
  ariaLabel: string;
  categoria: string;
  vitrine: "" | "vendidos" | "lancamentos";
  products: T[];
};

const SHOWCASE_LIMITS: Record<PharmaShowcaseId, number> = {
  tirzepatida: 12,
  retatrutida: 4,
  vendidos: 8,
  lancamentos: 4,
  peptideo: 12,
};

export function normalizeCategoryKey(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isTirzepatidaCategory(category: unknown): boolean {
  return normalizeCategoryKey(category) === "tirzepatida";
}

export function isRetatrutideCategory(category: unknown): boolean {
  const key = normalizeCategoryKey(category);
  return key === "retatrutida" || key === "retatrutide";
}

export function isPeptideCategoryKey(category: unknown): boolean {
  return normalizeCategoryKey(category) === "peptideo";
}

export function pharmaCategoryMatches(productCategory: unknown, filterCategory: unknown): boolean {
  const filter = String(filterCategory || "").trim();
  if (!filter) return true;
  if (isRetatrutideCategory(filter)) return isRetatrutideCategory(productCategory);
  if (isTirzepatidaCategory(filter)) return isTirzepatidaCategory(productCategory);
  if (isPeptideCategoryKey(filter)) return isPeptideCategoryKey(productCategory);
  return String(productCategory || "") === filter;
}

export function pharmaCategorySelected(menuCategory: string, filterCategory: string): boolean {
  if (!filterCategory.trim()) return false;
  return pharmaCategoryMatches(menuCategory, filterCategory);
}

export function isPharmaShowcaseHome(filters: PharmaCatalogFilters, page: number): boolean {
  return (
    page === 1 &&
    !filters.q.trim() &&
    !filters.categoria.trim() &&
    !filters.marca.trim() &&
    !filters.promo &&
    !filters.vitrine &&
    filters.ordem === "relevancia"
  );
}

function soldOutLast(a: PharmaShowcaseProduct, b: PharmaShowcaseProduct): number {
  const aOut = a.isSoldOut === true;
  const bOut = b.isSoldOut === true;
  if (aOut === bOut) return 0;
  return aOut ? 1 : -1;
}

function manualRank(sortOrder: unknown): number {
  const value = Number(sortOrder) || 0;
  return value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

function peptideBrandRank(product: PharmaShowcaseProduct): { rank: 0 | 1 | 2; label: string } {
  const raw = String(product.brand || "").trim();
  if (normalizeCategoryKey(raw) === "biogenesis") return { rank: 0, label: "" };
  if (!raw) return { rank: 2, label: "" };
  return { rank: 1, label: raw };
}

function compareName(a: PharmaShowcaseProduct, b: PharmaShowcaseProduct): number {
  return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { sensitivity: "base" });
}

export function comparePharmaCategory(a: PharmaShowcaseProduct, b: PharmaShowcaseProduct, peptide: boolean): number {
  const soldOut = soldOutLast(a, b);
  if (soldOut !== 0) return soldOut;

  const sortDiff = manualRank(a.sortOrder) - manualRank(b.sortOrder);
  if (sortDiff !== 0) return sortDiff;

  if (peptide) {
    const aBrand = peptideBrandRank(a);
    const bBrand = peptideBrandRank(b);
    if (aBrand.rank !== bBrand.rank) return aBrand.rank - bBrand.rank;
    if (aBrand.rank === 1) {
      const labelDiff = aBrand.label.localeCompare(bBrand.label, "pt-BR", { sensitivity: "base" });
      if (labelDiff !== 0) return labelDiff;
    }
  }

  const soldDiff = (Number(b.soldQty) || 0) - (Number(a.soldQty) || 0);
  if (soldDiff !== 0) return soldDiff;
  return compareName(a, b);
}

export function comparePharmaSoldQty(a: PharmaShowcaseProduct, b: PharmaShowcaseProduct): number {
  const soldOut = soldOutLast(a, b);
  if (soldOut !== 0) return soldOut;
  const soldDiff = (Number(b.soldQty) || 0) - (Number(a.soldQty) || 0);
  if (soldDiff !== 0) return soldDiff;
  return compareName(a, b);
}

export function comparePharmaLaunches(a: PharmaShowcaseProduct, b: PharmaShowcaseProduct): number {
  const soldOut = soldOutLast(a, b);
  if (soldOut !== 0) return soldOut;
  const aCreated = String(a.createdAt || "").trim();
  const bCreated = String(b.createdAt || "").trim();
  if (!aCreated && bCreated) return 1;
  if (aCreated && !bCreated) return -1;
  if (aCreated !== bCreated) return bCreated.localeCompare(aCreated);
  return compareName(a, b);
}

export function majorityCategoryLabel(products: Array<{ category?: string }>, fallback: string): string {
  const counts = new Map<string, { count: number; first: number }>();
  products.forEach((product, index) => {
    const name = String(product.category || "").trim();
    if (!name) return;
    const current = counts.get(name);
    if (current) current.count += 1;
    else counts.set(name, { count: 1, first: index });
  });

  let best = "";
  let bestCount = 0;
  let bestFirst = Number.POSITIVE_INFINITY;
  for (const [name, info] of counts) {
    if (info.count > bestCount || (info.count === bestCount && info.first < bestFirst)) {
      best = name;
      bestCount = info.count;
      bestFirst = info.first;
    }
  }
  return best || fallback;
}

function inStock<T extends PharmaShowcaseProduct>(products: T[]): T[] {
  return products.filter((product) => product.isSoldOut !== true);
}

function categorySection<T extends PharmaShowcaseProduct>(
  id: "tirzepatida" | "retatrutida" | "peptideo",
  products: T[],
  peptide: boolean,
  fallback: string,
): PharmaShowcaseSection<T> | null {
  const visible = inStock(products)
    .sort((a, b) => comparePharmaCategory(a, b, peptide))
    .slice(0, SHOWCASE_LIMITS[id]);
  if (visible.length === 0) return null;
  const title = majorityCategoryLabel(products, fallback);
  return {
    id,
    title,
    actionLabel: "Ver todos",
    ariaLabel: `Ver todos de ${title}`,
    categoria: title,
    vitrine: "",
    products: visible,
  };
}

export function buildPharmaShowcases<T extends PharmaShowcaseProduct>(products: T[]): PharmaShowcaseSection<T>[] {
  const sections: PharmaShowcaseSection<T>[] = [];
  const tirzepatida = categorySection(
    "tirzepatida",
    products.filter((product) => isTirzepatidaCategory(product.category)),
    false,
    "Tirzepatida",
  );
  if (tirzepatida) sections.push(tirzepatida);

  const retatrutida = categorySection(
    "retatrutida",
    products.filter((product) => isRetatrutideCategory(product.category)),
    false,
    "Retatrutida",
  );
  if (retatrutida) sections.push(retatrutida);

  const vendidos = inStock(products)
    .sort(comparePharmaSoldQty)
    .slice(0, SHOWCASE_LIMITS.vendidos);
  if (vendidos.length > 0) {
    sections.push({
      id: "vendidos",
      title: "Mais vendidos",
      actionLabel: "Ver todos",
      ariaLabel: "Ver todos de Mais vendidos",
      categoria: "",
      vitrine: "vendidos",
      products: vendidos,
    });
  }

  const lancamentos = inStock(products.filter((product) => product.isLaunch === true))
    .sort(comparePharmaLaunches)
    .slice(0, SHOWCASE_LIMITS.lancamentos);
  if (lancamentos.length > 0) {
    sections.push({
      id: "lancamentos",
      title: "Novidades",
      actionLabel: "Ver novidades",
      ariaLabel: "Ver novidades",
      categoria: "",
      vitrine: "lancamentos",
      products: lancamentos,
    });
  }

  const peptideo = categorySection(
    "peptideo",
    products.filter((product) => isPeptideCategoryKey(product.category)),
    true,
    "Peptídeo",
  );
  if (peptideo) sections.push(peptideo);

  return sections;
}
