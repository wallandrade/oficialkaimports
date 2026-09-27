export const CHECKOUT_CARRIER_PRIORITY_KEY = "envioecom_checkout_carrier_priority";

export const CHECKOUT_CARRIER_OPTIONS = [
  "Correios Sedex",
  "Correios Pac",
  "Correios Mini Envios",
  "J&T Express envioEcom",
  "Jadlog envioEcom",
  "Ponto Loggi envioEcom",
  "BUSLOG envioEcom",
] as const;

const CANONICAL_BY_NAME = new Map(
  CHECKOUT_CARRIER_OPTIONS.map((name) => [normalizeCarrierName(name), name]),
);

export type CheckoutDeliveryEstimate = {
  carrier: string | null;
  deliveryTimeDays: number | null;
};

export const EMPTY_CHECKOUT_DELIVERY: CheckoutDeliveryEstimate = {
  carrier: null,
  deliveryTimeDays: null,
};

export type CheckoutCarrierPriorityParse =
  | { ok: true; carriers: string[] }
  | { ok: false; message: string };

const CACHE_TTL_MS = 10 * 60 * 1000;
const QUOTE_WINDOW_MS = 10 * 60 * 1000;
const QUOTE_MAX_PER_IP = 30;

type CacheEntry = { value: CheckoutDeliveryEstimate; expiresAt: number };
type QuoteBucket = { count: number; resetAt: number };

const deliveryCache = new Map<string, CacheEntry>();
const quoteBuckets = new Map<string, QuoteBucket>();

export function normalizeCarrierName(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseCheckoutCarrierPriority(raw: unknown): CheckoutCarrierPriorityParse {
  if (raw == null || raw === "") return { ok: true, carriers: [] };

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, carriers: [] };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, message: "A fila precisa ser uma lista JSON." };
    }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, message: "A fila precisa ser uma lista." };
  }

  const carriers: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const key = normalizeCarrierName(item);
    if (!key) continue;
    const canonical = CANONICAL_BY_NAME.get(key);
    if (!canonical) {
      return { ok: false, message: `Transportadora não aceita: ${String(item).trim()}` };
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    carriers.push(canonical);
  }
  return { ok: true, carriers };
}

export function serializeCheckoutCarrierPriority(carriers: string[]): string {
  return JSON.stringify(carriers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function extractCheckoutQuoteRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.quotes)) return payload.quotes.filter(isRecord);
  const data = payload.data;
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && Array.isArray(data.quotes)) return data.quotes.filter(isRecord);
  return [];
}

function readDeliveryDays(row: Record<string, unknown>): number | null {
  const raw = row.delivery_time ?? row.deliveryTime ?? row.delivery_days ?? row.deliveryDays;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const days = Math.trunc(raw);
    return days >= 1 ? days : null;
  }
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const days = Math.trunc(Number(match[1].replace(",", ".")));
  return Number.isFinite(days) && days >= 1 ? days : null;
}

function readCarrier(row: Record<string, unknown>): string {
  return String(row.carrier || row.shipping_company || row.shippingCompany || "").trim();
}

export function pickCheckoutDelivery(
  priority: string[],
  payload: unknown,
): { carrier: string; deliveryTimeDays: number } | null {
  const byName = new Map<string, { carrier: string; deliveryTimeDays: number }>();
  for (const row of extractCheckoutQuoteRows(payload)) {
    const carrier = readCarrier(row);
    const deliveryTimeDays = readDeliveryDays(row);
    if (!carrier || deliveryTimeDays == null) continue;
    const key = normalizeCarrierName(carrier);
    if (!byName.has(key)) byName.set(key, { carrier, deliveryTimeDays });
  }

  for (const wanted of priority) {
    const found = byName.get(normalizeCarrierName(wanted));
    if (found) return found;
  }
  return null;
}

export function checkoutDeliveryCacheKey(cep: string, carriers: string[]): string {
  return `${cep}|${JSON.stringify(carriers)}`;
}

export function readCheckoutDeliveryCache(key: string, now = Date.now()): CheckoutDeliveryEstimate | null {
  const entry = deliveryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    deliveryCache.delete(key);
    return null;
  }
  return entry.value;
}

export function writeCheckoutDeliveryCache(
  key: string,
  value: CheckoutDeliveryEstimate,
  now = Date.now(),
): void {
  deliveryCache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
}

export function takeCheckoutQuoteSlot(
  ip: string,
  now = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  for (const [key, bucket] of quoteBuckets) {
    if (bucket.resetAt <= now) quoteBuckets.delete(key);
  }

  const bucketKey = String(ip || "unknown").trim() || "unknown";
  const current = quoteBuckets.get(bucketKey);
  if (!current || current.resetAt <= now) {
    quoteBuckets.set(bucketKey, { count: 1, resetAt: now + QUOTE_WINDOW_MS });
    return { allowed: true };
  }
  if (current.count >= QUOTE_MAX_PER_IP) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true };
}

export function resetCheckoutDeliveryEstimateState(): void {
  deliveryCache.clear();
  quoteBuckets.clear();
}
