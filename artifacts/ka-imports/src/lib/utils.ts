import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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

function normalizeSellerSlug(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeWhatsApp(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function getStoreDefaultWhatsApp(): string {
  try {
    const raw = localStorage.getItem("siteSettings") || "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const configured = normalizeWhatsApp(String(parsed?.support_whatsapp || ""));
    return configured || DEFAULT_WHATSAPP;
  } catch {
    return DEFAULT_WHATSAPP;
  }
}

export function setSellerContext(slug: string): void {
  const normalized = normalizeSellerSlug(slug);
  if (!normalized) return;
  try {
    sessionStorage.setItem(SELLER_CODE_KEY, normalized);
    localStorage.setItem(SELLER_CODE_KEY, normalized);
    // Prevent stale seller WhatsApp being reused after context switch.
    sessionStorage.removeItem(SELLER_WHATSAPP_KEY);
    sessionStorage.removeItem(SELLER_WHATSAPP_SLUG_KEY);
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

/**
 * Fetches the seller's WhatsApp from the API and stores it in sessionStorage.
 * Call this on any page that needs seller-aware WhatsApp (even if sessionStorage
 * already has a stale entry from a different seller).
 */
export async function fetchAndCacheSellerWhatsApp(slug: string): Promise<void> {
  const normalizedSlug = normalizeSellerSlug(slug);
  if (!normalizedSlug) return;
  try {
    const res = await fetch(`${_BASE()}/api/sellers/${encodeURIComponent(normalizedSlug)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { whatsapp?: string };
    const whatsapp = normalizeWhatsApp(data?.whatsapp ?? "");
    if (!whatsapp) return;

    const activeSeller = getActiveSellerCode();
    // Ignore late responses from an old seller route.
    if (activeSeller && activeSeller !== normalizedSlug) return;

    if (whatsapp) {
      sessionStorage.setItem(SELLER_WHATSAPP_KEY, whatsapp);
      sessionStorage.setItem(SELLER_WHATSAPP_SLUG_KEY, normalizedSlug);
    }
  } catch {
    // ignore — fall back to default
  }
}

/**
 * Returns a WhatsApp link for the given message.
 * Always computed at call time (never cached in JSX) so the correct seller
 * number is used even if session data was populated after first render.
 */
export function makeWhatsAppLink(text: string): string {
  const number = getActiveWhatsApp();
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * Returns the WhatsApp number to use for support/contact.
 * If a seller is active in session/localStorage, returns their number.
 * Falls back to the store's default number.
 */
export function getActiveWhatsApp(): string {
  try {
    const sellerCode = getActiveSellerCode();
    const apiWhatsApp = normalizeWhatsApp(sessionStorage.getItem(SELLER_WHATSAPP_KEY) || "");
    const apiSellerSlug = normalizeSellerSlug(sessionStorage.getItem(SELLER_WHATSAPP_SLUG_KEY) || "");
    const storeDefault = getStoreDefaultWhatsApp();

    // Strict binding: only use cached WhatsApp if it belongs to active seller context.
    if (sellerCode && apiWhatsApp && apiSellerSlug === sellerCode) {
      return apiWhatsApp;
    }

    // No strict seller-bound number available.
    if (sellerCode) return storeDefault;

    return storeDefault;
  } catch {
    // ignore
  }
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
