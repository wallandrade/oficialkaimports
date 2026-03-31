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

export type SavedSellerItem = { slug: string; whatsapp: string };

const _BASE = () => (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");

/**
 * Fetches the seller's WhatsApp from the API and stores it in sessionStorage.
 * Call this on any page that needs seller-aware WhatsApp (even if sessionStorage
 * already has a stale entry from a different seller).
 */
export async function fetchAndCacheSellerWhatsApp(slug: string): Promise<void> {
  if (!slug) return;
  try {
    const res = await fetch(`${_BASE()}/api/sellers/${encodeURIComponent(slug)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { whatsapp?: string };
    if (data?.whatsapp) {
      sessionStorage.setItem("sellerWhatsapp", data.whatsapp.trim());
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
    // 1. Prefer the number fetched from the API (set by SellerPage preload)
    const apiWhatsApp = sessionStorage.getItem("sellerWhatsapp");
    if (apiWhatsApp?.trim()) return apiWhatsApp.trim();

    // 2. Fallback: look up in the admin's localStorage seller list (only present on admin browser)
    const sellerCode =
      sessionStorage.getItem("sellerCode") ||
      localStorage.getItem("sellerCode");
    if (!sellerCode) return DEFAULT_WHATSAPP;

    const raw = localStorage.getItem("savedSellersList");
    if (raw) {
      const list: SavedSellerItem[] = JSON.parse(raw);
      const found = list.find((s) => s.slug === sellerCode);
      if (found?.whatsapp) return found.whatsapp.replace(/\D/g, "");
    }
  } catch {
    // ignore
  }
  return DEFAULT_WHATSAPP;
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
