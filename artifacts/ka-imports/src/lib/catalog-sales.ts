export type CatalogSalesProduct = {
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

function normalizeKey(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isPeptideCategory(category: unknown): boolean {
  return normalizeKey(category) === "peptideo";
}

function soldOutLast(a: CatalogSalesProduct, b: CatalogSalesProduct): number {
  const aOut = a.isSoldOut === true;
  const bOut = b.isSoldOut === true;
  if (aOut === bOut) return 0;
  return aOut ? 1 : -1;
}

function compareSalesThenTiebreak(a: CatalogSalesProduct, b: CatalogSalesProduct): number {
  const soldDiff = (Number(b.soldQty) || 0) - (Number(a.soldQty) || 0);
  if (soldDiff !== 0) return soldDiff;

  const aSort = (Number(a.sortOrder) || 0) > 0 ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
  const bSort = (Number(b.sortOrder) || 0) > 0 ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
  if (aSort !== bSort) return aSort - bSort;

  const aLaunch = a.isLaunch === true;
  const bLaunch = b.isLaunch === true;
  if (aLaunch !== bLaunch) return aLaunch ? -1 : 1;

  const created = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  if (created !== 0) return created;

  return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { sensitivity: "base" });
}

function peptideBrandRank(product: CatalogSalesProduct): { rank: 0 | 1 | 2; label: string } {
  const raw = String(product.brand || "").trim();
  if (normalizeKey(raw) === "biogenesis") return { rank: 0, label: "" };
  if (!raw) return { rank: 2, label: "" };
  return { rank: 1, label: raw };
}

export function sortCatalogProducts<T extends CatalogSalesProduct>(products: T[], category: string): T[] {
  return [...products].sort((a, b) => {
    const soldOut = soldOutLast(a, b);
    if (soldOut !== 0) return soldOut;

    if (isPeptideCategory(category)) {
      const aBrand = peptideBrandRank(a);
      const bBrand = peptideBrandRank(b);
      if (aBrand.rank !== bBrand.rank) return aBrand.rank - bBrand.rank;
      if (aBrand.rank === 1) {
        const labelDiff = aBrand.label.localeCompare(bBrand.label, "pt-BR", { sensitivity: "base" });
        if (labelDiff !== 0) return labelDiff;
      }
    }

    return compareSalesThenTiebreak(a, b);
  });
}

export function topSellerRanks(products: CatalogSalesProduct[]): Map<string, 1 | 2 | 3> {
  const ranked = [...products]
    .filter((product) => (Number(product.soldQty) || 0) > 0)
    .sort(compareSalesThenTiebreak);
  const ranks = new Map<string, 1 | 2 | 3>();
  ranked.slice(0, 3).forEach((product, index) => {
    ranks.set(product.id, (index + 1) as 1 | 2 | 3);
  });
  return ranks;
}

export function topSellerRanksByCategory(products: CatalogSalesProduct[]): Map<string, 1 | 2 | 3> {
  const groups = new Map<string, CatalogSalesProduct[]>();
  for (const product of products) {
    const category = String(product.category || "Sem categoria");
    const current = groups.get(category) ?? [];
    current.push(product);
    groups.set(category, current);
  }
  const ranks = new Map<string, 1 | 2 | 3>();
  for (const list of groups.values()) {
    for (const [id, rank] of topSellerRanks(list)) ranks.set(id, rank);
  }
  return ranks;
}
