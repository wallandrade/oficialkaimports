import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  SELLER_WHATSAPP_UNAVAILABLE_MESSAGE,
  activeSellerSlug,
  boundSellerWhatsApp,
  buildWhatsAppUrl,
  normalizeSellerSlug,
  normalizeWhatsAppDigits,
  resolveSellerWhatsAppStrict,
  shouldResetSellerWhatsAppCache,
} from "./seller-whatsapp";

export { SELLER_WHATSAPP_UNAVAILABLE_MESSAGE, buildWhatsAppUrl };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export const DEFAULT_WHATSAPP = "5511917082244";

export type SavedSellerItem = {
  slug: string;
  whatsapp: string;
  hasCommission?: boolean;
  commissionRate?: number;
};

const _BASE = () => (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");
const SELLER_CODE_KEY = "sellerCode";
const SELLER_WHATSAPP_KEY = "sellerWhatsapp";
const SELLER_WHATSAPP_SLUG_KEY = "sellerWhatsappSlug";

const sellerWhatsAppInflight = new Map<string, Promise<void>>();

function getStoreDefaultWhatsApp(): string {
  try {
    const raw = localStorage.getItem("siteSettings") || "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const configured = normalizeWhatsAppDigits(String(parsed?.support_whatsapp || ""));
    return configured || DEFAULT_WHATSAPP;
  } catch {
    return DEFAULT_WHATSAPP;
  }
}

export function setSellerContext(slug: string): void {
  const normalized = normalizeSellerSlug(slug);
  if (!normalized) return;
  try {
    const current = getActiveSellerCode();
    sessionStorage.setItem(SELLER_CODE_KEY, normalized);
    localStorage.setItem(SELLER_CODE_KEY, normalized);
    // Only a real seller switch can drop the confirmed number.
    if (shouldResetSellerWhatsAppCache(current, normalized)) {
      sessionStorage.removeItem(SELLER_WHATSAPP_KEY);
      sessionStorage.removeItem(SELLER_WHATSAPP_SLUG_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getActiveSellerCode(): string {
  try {
    return normalizeSellerSlug(
      sessionStorage.getItem(SELLER_CODE_KEY) || localStorage.getItem(SELLER_CODE_KEY) || "",
    );
  } catch {
    return "";
  }
}

function readSellerWhatsAppCache(): { number: string; slug: string } {
  try {
    return {
      number: sessionStorage.getItem(SELLER_WHATSAPP_KEY) || "",
      slug: sessionStorage.getItem(SELLER_WHATSAPP_SLUG_KEY) || "",
    };
  } catch {
    return { number: "", slug: "" };
  }
}

function writeSellerWhatsAppCache(slug: string, number: string): void {
  try {
    sessionStorage.setItem(SELLER_WHATSAPP_KEY, number);
    sessionStorage.setItem(SELLER_WHATSAPP_SLUG_KEY, slug);
  } catch {
    // ignore storage errors
  }
}

function currentPathname(): string {
  try {
    return window.location?.pathname || "";
  } catch {
    return "";
  }
}

/** Seller in the path, otherwise the slug saved from the seller link. */
export function activeSellerSlugForWhatsApp(): string {
  return activeSellerSlug(currentPathname(), getActiveSellerCode());
}

async function fetchSellerWhatsAppNumber(slug: string): Promise<string | null> {
  const res = await fetch(`${_BASE()}/api/sellers/${encodeURIComponent(slug)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { whatsapp?: string };
  return normalizeWhatsAppDigits(data?.whatsapp ?? "") || null;
}

/**
 * Fetches the seller's WhatsApp from the API and stores it in sessionStorage.
 * Call this on any page that needs seller-aware WhatsApp (even if sessionStorage
 * already has a stale entry from a different seller).
 */
export function fetchAndCacheSellerWhatsApp(slug: string): Promise<void> {
  const normalizedSlug = normalizeSellerSlug(slug);
  if (!normalizedSlug) return Promise.resolve();
  const existing = sellerWhatsAppInflight.get(normalizedSlug);
  if (existing) return existing;

  let request: Promise<void> = Promise.resolve();
  request = (async () => {
    try {
      const whatsapp = await fetchSellerWhatsAppNumber(normalizedSlug);
      if (!whatsapp) return;
      const activeSeller = activeSellerSlugForWhatsApp();
      // Ignore late responses from an old seller route.
      if (activeSeller && activeSeller !== normalizedSlug) return;
      writeSellerWhatsAppCache(normalizedSlug, whatsapp);
    } catch {
      // Click path resolves strictly and does not use the store default.
    }
  })().finally(() => {
    if (sellerWhatsAppInflight.get(normalizedSlug) === request) {
      sellerWhatsAppInflight.delete(normalizedSlug);
    }
  });

  sellerWhatsAppInflight.set(normalizedSlug, request);
  return request;
}

/** Fills the seller cache on pages that have a slug in storage or in the path. */
export function prefetchActiveSellerWhatsApp(): Promise<void> {
  const slug = activeSellerSlugForWhatsApp();
  if (!slug) return Promise.resolve();
  return fetchAndCacheSellerWhatsApp(slug);
}

/**
 * Confirms the WhatsApp for the active seller. No seller keeps the store number.
 * A seller without a confirmed number returns null — never another seller or the default.
 */
export function resolveActiveSellerWhatsApp(explicitSellerCode?: string | null): Promise<string | null> {
  const sellerCode = explicitSellerCode == null
    ? activeSellerSlugForWhatsApp()
    : normalizeSellerSlug(explicitSellerCode);
  const activeSeller = () => (
    explicitSellerCode == null ? activeSellerSlugForWhatsApp() : sellerCode
  );
  return resolveSellerWhatsAppStrict({
    sellerCode,
    readCache: readSellerWhatsAppCache,
    writeCache: writeSellerWhatsAppCache,
    fetchSellerWhatsApp: fetchSellerWhatsAppNumber,
    getActiveSellerCode: activeSeller,
    storeDefault: getStoreDefaultWhatsApp,
  });
}

function openWhatsAppUrl(url: string): void {
  const popup = window.open(url, "_blank");
  if (popup) popup.opener = null;
  else window.location.href = url;
}

/**
 * Opens WhatsApp in the same click.
 * A confirmed seller number opens immediately. Otherwise a blank tab is opened
 * before the request, then pointed at the seller — or closed with an error.
 */
export function openSellerWhatsAppChat(text: string, onUnavailable: (_reason: string) => void): void {
  const sellerCode = activeSellerSlugForWhatsApp();
  if (!sellerCode) {
    const number = getActiveWhatsApp();
    if (!number) {
      onUnavailable(SELLER_WHATSAPP_UNAVAILABLE_MESSAGE);
      return;
    }
    openWhatsAppUrl(buildWhatsAppUrl(number, text));
    return;
  }

  const cache = readSellerWhatsAppCache();
  const cached = boundSellerWhatsApp(cache.number, cache.slug, sellerCode);
  if (cached) {
    openWhatsAppUrl(buildWhatsAppUrl(cached, text));
    return;
  }

  const pending = window.open("", "_blank");
  if (pending) pending.opener = null;
  void resolveActiveSellerWhatsApp(sellerCode).then((number) => {
    if (!number) {
      try { pending?.close(); } catch { /* ignore */ }
      onUnavailable(SELLER_WHATSAPP_UNAVAILABLE_MESSAGE);
      return;
    }
    const url = buildWhatsAppUrl(number, text);
    if (pending && !pending.closed) {
      pending.location.href = url;
      return;
    }
    window.location.href = url;
  });
}

/** Order/KYC number when the API already sent it; otherwise the same strict chat. */
export function openConfirmedOrSellerWhatsApp(
  confirmedNumber: string | null | undefined,
  text: string,
  onUnavailable: (_reason: string) => void,
): void {
  const direct = normalizeWhatsAppDigits(confirmedNumber || "");
  if (direct) {
    openWhatsAppUrl(buildWhatsAppUrl(direct, text));
    return;
  }
  openSellerWhatsAppChat(text, onUnavailable);
}

/**
 * Returns a WhatsApp link for the given message.
 * Always computed at call time (never cached in JSX) so the correct seller
 * number is used even if session data was populated after first render.
 */
export function makeWhatsAppLink(text: string): string {
  const number = getActiveWhatsApp();
  if (!number) return "";
  return buildWhatsAppUrl(number, text);
}

/**
 * Returns the WhatsApp number to use for support/contact.
 * A seller number is returned only when the cache belongs to that slug.
 * Without a seller, falls back to the store's default number.
 * With a seller and no confirmed number, returns "" so the click can ask again.
 */
export function getActiveWhatsApp(): string {
  try {
    const sellerCode = activeSellerSlugForWhatsApp();
    const cache = readSellerWhatsAppCache();
    const bound = boundSellerWhatsApp(cache.number, cache.slug, sellerCode);
    if (sellerCode) return bound;
    return getStoreDefaultWhatsApp();
  } catch {
    // ignore
  }
  if (activeSellerSlugForWhatsApp()) return "";
  return getStoreDefaultWhatsApp();
}

/** @deprecated use makeWhatsAppLink instead */
export function createWhatsAppLink(text: string): string {
  return makeWhatsAppLink(text);
}

/** @deprecated use DEFAULT_WHATSAPP */
export const WHATSAPP_NUMBER = DEFAULT_WHATSAPP;

const TZ = "America/Sao_Paulo";

/** Formats a date string as dd/mm/yyyy, HH:MM in Brazil/São Paulo timezone */
export function formatDateBR(date: string | Date): string {
  return new Date(date).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: TZ,
  });
}

/** Formats a date string as dd/mm/yyyy in Brazil/São Paulo timezone */
export function formatDateOnlyBR(date: string | Date): string {
  return new Date(date).toLocaleDateString("pt-BR", { timeZone: TZ });
}

/** Formats a time string as HH:MM:SS in Brazil/São Paulo timezone */
export function formatTimeBR(date: string | Date): string {
  return new Date(date).toLocaleTimeString("pt-BR", { timeZone: TZ });
}
