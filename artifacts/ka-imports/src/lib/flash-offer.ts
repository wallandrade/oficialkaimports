const VISITOR_KEY = "flashVisitorId";
const OFFER_KEY = "flashOffer";

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

export function readStoredFlashOffer(): StoredFlashOffer | null {
  try {
    const raw = sessionStorage.getItem(OFFER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredFlashOffer;
    if (!parsed?.reservationId || !parsed.productId || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readActiveFlashOffer(): StoredFlashOffer | null {
  const offer = readStoredFlashOffer();
  if (!offer) return null;
  if (new Date(offer.expiresAt).getTime() <= Date.now()) return null;
  return offer;
}

export function saveFlashOffer(offer: StoredFlashOffer): void {
  sessionStorage.setItem(OFFER_KEY, JSON.stringify(offer));
}

export function clearStoredFlashOffer(): void {
  sessionStorage.removeItem(OFFER_KEY);
}

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("customerToken") || localStorage.getItem("customerToken") || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function drawFlashOffer(): Promise<FlashDrawOffer | null> {
  const response = await fetch(`${baseUrl()}/api/flash-offers/draw`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ visitorId: getFlashVisitorId() }),
  });
  if (!response.ok) return null;
  const data = await response.json() as { offer?: FlashDrawOffer | null };
  return data.offer || null;
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
  flashVisitorId?: string;
} {
  const item = items.find((entry) => entry.isFlash && entry.flashReservationId && entry.flashExpiresAt && new Date(entry.flashExpiresAt).getTime() > Date.now());
  if (!item?.flashReservationId) return {};
  return {
    flashReservationId: item.flashReservationId,
    flashVisitorId: getFlashVisitorId(),
  };
}
