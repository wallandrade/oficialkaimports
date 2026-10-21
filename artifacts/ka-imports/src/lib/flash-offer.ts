const VISITOR_KEY = "flashVisitorId";
const OFFER_KEY = "flashOffers";
const LEGACY_OFFER_KEY = "flashOffer";

export type StoredFlashOffer = {
  reservationId: string;
  campaignId: string;
  productId: string;
  name: string;
  image: string | null;
  unitPrice: number;
  regularPrice: number;
  expiresAt: string;
  needsVariants: boolean;
};

export type FlashDrawOffer = {
  campaignId: string;
  productId: string;
  name: string;
  image: string | null;
  regularPrice: number;
  flashPrice: number;
  needsVariants: boolean;
};

function baseUrl(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

export function getFlashVisitorId(): string {
  const current = localStorage.getItem(VISITOR_KEY) || "";
  if (/^[A-Za-z0-9_-]{16,80}$/.test(current)) return current;
  const created = crypto.randomUUID();
  localStorage.setItem(VISITOR_KEY, created);
  return created;
}

function isStoredFlashOffer(value: unknown): value is StoredFlashOffer {
  const offer = value as StoredFlashOffer | null;
  return Boolean(offer?.reservationId && offer.productId && offer.expiresAt);
}

export function readStoredFlashOffers(): StoredFlashOffer[] {
  try {
    const raw = sessionStorage.getItem(OFFER_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    const list = Array.isArray(parsed) ? parsed.filter(isStoredFlashOffer) : [];
    if (list.length > 0) return list;
    const legacyRaw = sessionStorage.getItem(LEGACY_OFFER_KEY);
    if (!legacyRaw) return [];
    const legacy = JSON.parse(legacyRaw) as unknown;
    return isStoredFlashOffer(legacy) ? [legacy] : [];
  } catch {
    return [];
  }
}

function writeStoredFlashOffers(offers: StoredFlashOffer[]): void {
  if (offers.length === 0) {
    sessionStorage.removeItem(OFFER_KEY);
    sessionStorage.removeItem(LEGACY_OFFER_KEY);
    return;
  }
  sessionStorage.setItem(OFFER_KEY, JSON.stringify(offers));
  sessionStorage.removeItem(LEGACY_OFFER_KEY);
}

export function readStoredFlashOffer(): StoredFlashOffer | null {
  return readStoredFlashOffers()[0] ?? null;
}

export function readActiveFlashOffers(): StoredFlashOffer[] {
  const now = Date.now();
  return readStoredFlashOffers().filter((offer) => new Date(offer.expiresAt).getTime() > now);
}

export function readActiveFlashOffer(): StoredFlashOffer | null {
  return readActiveFlashOffers()[0] ?? null;
}

export function saveFlashOffer(offer: StoredFlashOffer): void {
  const next = readStoredFlashOffers().filter((item) => item.reservationId !== offer.reservationId && item.productId !== offer.productId);
  writeStoredFlashOffers([...next, offer]);
}

export function removeStoredFlashOffer(reservationId: string): void {
  writeStoredFlashOffers(readStoredFlashOffers().filter((offer) => offer.reservationId !== reservationId));
}

export function clearStoredFlashOffer(): void {
  writeStoredFlashOffers([]);
}

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("customerToken") || localStorage.getItem("customerToken") || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchFlashWaitSeconds(): Promise<number | null> {
  const response = await fetch(`${baseUrl()}/api/flash-offers/wait`);
  if (!response.ok) return 8;
  const data = await response.json() as { seconds?: number | null };
  if (data.seconds == null) return null;
  const seconds = Number(data.seconds);
  if (!Number.isFinite(seconds)) return 8;
  return Math.min(300, Math.max(0, Math.round(seconds)));
}

export async function drawFlashOffer(): Promise<FlashDrawOffer[]> {
  const response = await fetch(`${baseUrl()}/api/flash-offers/draw`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ visitorId: getFlashVisitorId() }),
  });
  if (!response.ok) return [];
  const data = await response.json() as { offers?: FlashDrawOffer[] | null; offer?: FlashDrawOffer | null };
  if (Array.isArray(data.offers) && data.offers.length > 0) {
    return data.offers.filter((offer) => offer?.campaignId && offer?.productId);
  }
  return data.offer?.campaignId && data.offer.productId ? [data.offer] : [];
}

export async function claimFlashOffer(offer: FlashDrawOffer): Promise<StoredFlashOffer> {
  const response = await fetch(`${baseUrl()}/api/flash-offers/claim`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      visitorId: getFlashVisitorId(),
      campaignId: offer.campaignId,
      productId: offer.productId,
    }),
  });
  const data = await response.json() as {
    message?: string;
    reservationId?: string;
    expiresAt?: string;
    productId?: string;
    name?: string;
    image?: string | null;
    flashPrice?: number;
    regularPrice?: number;
    needsVariants?: boolean;
  };
  if (!response.ok || !data.reservationId || !data.expiresAt) {
    throw new Error(data.message || "Essa oferta não está mais disponível.");
  }
  const stored: StoredFlashOffer = {
    reservationId: data.reservationId,
    campaignId: offer.campaignId,
    productId: data.productId || offer.productId,
    name: data.name || offer.name,
    image: data.image ?? offer.image,
    unitPrice: Number(data.flashPrice),
    regularPrice: Number(data.regularPrice ?? offer.regularPrice),
    expiresAt: data.expiresAt,
    needsVariants: data.needsVariants === true,
  };
  saveFlashOffer(stored);
  return stored;
}

export async function releaseFlashOffer(reservationId: string): Promise<void> {
  if (!reservationId) return;
  await fetch(`${baseUrl()}/api/flash-offers/release`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ visitorId: getFlashVisitorId(), reservationId }),
  }).catch(() => undefined);
}

export function flashCheckoutFields(items: Array<{ isFlash?: boolean; flashReservationId?: string; flashExpiresAt?: string }>): {
  flashReservationId?: string;
  flashReservationIds?: string[];
  flashVisitorId?: string;
} {
  const ids = [...new Set(items
    .filter((entry) => entry.isFlash && entry.flashReservationId && entry.flashExpiresAt && new Date(entry.flashExpiresAt).getTime() > Date.now())
    .map((entry) => String(entry.flashReservationId)))];
  if (ids.length === 0) return {};
  return {
    flashReservationId: ids[0],
    flashReservationIds: ids,
    flashVisitorId: getFlashVisitorId(),
  };
}
