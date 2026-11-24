export const SELLER_WHATSAPP_UNAVAILABLE_MESSAGE =
  "Não foi possível confirmar o WhatsApp deste vendedor. Tente novamente.";

/** First path segment that is a store route, not a seller slug. */
export const NON_SELLER_ROOT_SEGMENTS = new Set([
  "admin",
  "login",
  "checkout",
  "pix",
  "success",
  "r",
  "pagamento",
  "payment-link",
  "kyc",
  "suporte",
  "frete",
  "corrigir-entrega",
  "rifas",
  "grupo2",
  "minha-conta",
  "produto",
  "ofertas",
  "categoria",
]);

export type SellerWhatsAppCache = {
  number: string;
  slug: string;
};

export type SellerWhatsAppResolver = {
  sellerCode: string;
  readCache: () => SellerWhatsAppCache;
  writeCache: (_slug: string, _whatsapp: string) => void;
  fetchSellerWhatsApp: (_slug: string) => Promise<string | null>;
  getActiveSellerCode: () => string;
  storeDefault: () => string;
};

export function normalizeSellerSlug(value: string): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizeWhatsAppDigits(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

export function sellerSlugFromPathname(pathname: string): string {
  const segment = String(pathname || "").replace(/^\/+/, "").split("/")[0] ?? "";
  const slug = normalizeSellerSlug(segment);
  if (!slug || NON_SELLER_ROOT_SEGMENTS.has(slug)) return "";
  return slug;
}

/** Path slug wins. Storage is the fallback on routes without a slug (/pix, /success). */
export function activeSellerSlug(pathname: string, storedSellerCode: string): string {
  return sellerSlugFromPathname(pathname) || normalizeSellerSlug(storedSellerCode);
}

export function shouldResetSellerWhatsAppCache(previousSlug: string, nextSlug: string): boolean {
  const next = normalizeSellerSlug(nextSlug);
  if (!next) return false;
  return normalizeSellerSlug(previousSlug) !== next;
}

/** Number stored for this slug. Any other slug yields an empty string. */
export function boundSellerWhatsApp(cacheNumber: string, cacheSlug: string, sellerCode: string): string {
  const slug = normalizeSellerSlug(sellerCode);
  const number = normalizeWhatsAppDigits(cacheNumber);
  const cachedSlug = normalizeSellerSlug(cacheSlug);
  if (!slug || !number || cachedSlug !== slug) return "";
  return number;
}

export function buildWhatsAppUrl(number: string, text: string): string {
  return `https://wa.me/${normalizeWhatsAppDigits(number)}?text=${encodeURIComponent(text)}`;
}

/**
 * With a seller slug, return that seller's number or null.
 * The cache is used only when it belongs to the same slug; otherwise the API is fetched.
 * The store default is used only when there is no seller.
 */
export async function resolveSellerWhatsAppStrict(deps: SellerWhatsAppResolver): Promise<string | null> {
  const slug = normalizeSellerSlug(deps.sellerCode);
  if (!slug) {
    const fallback = normalizeWhatsAppDigits(deps.storeDefault());
    return fallback || null;
  }

  const initialCache = deps.readCache();
  const cached = boundSellerWhatsApp(initialCache.number, initialCache.slug, slug);
  if (cached) return cached;

  let fetched: string;
  try {
    fetched = normalizeWhatsAppDigits((await deps.fetchSellerWhatsApp(slug)) || "");
  } catch {
    fetched = "";
  }

  const active = normalizeSellerSlug(deps.getActiveSellerCode());
  if (active && active !== slug) return null;

  if (fetched) {
    deps.writeCache(slug, fetched);
    return fetched;
  }

  const refreshed = deps.readCache();
  return boundSellerWhatsApp(refreshed.number, refreshed.slug, slug) || null;
}
