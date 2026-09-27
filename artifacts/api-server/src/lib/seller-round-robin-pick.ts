export type SellerRoundRobinCandidate = {
  slug: string;
  hasCommission: boolean;
  commissionRate: number;
};

function normalizeSlug(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

/** Próximo slug em ordem alfabética depois do cursor; no fim, volta ao primeiro. */
export function pickNextRoundRobinSeller(
  sellers: SellerRoundRobinCandidate[],
  cursor: string | null | undefined,
): SellerRoundRobinCandidate | null {
  const unique = new Map<string, SellerRoundRobinCandidate>();
  for (const seller of sellers) {
    const slug = normalizeSlug(seller.slug);
    if (!slug || unique.has(slug)) continue;
    const hasCommission = Boolean(seller.hasCommission);
    unique.set(slug, {
      slug,
      hasCommission,
      commissionRate: hasCommission ? Number(seller.commissionRate) || 0 : 0,
    });
  }

  const ordered = Array.from(unique.values()).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (ordered.length === 0) return null;

  const current = normalizeSlug(cursor);
  return ordered.find((seller) => seller.slug > current) ?? ordered[0];
}
