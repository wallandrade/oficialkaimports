import { normalizeCep, SE_COORDINATES } from "./motoboy-distance";

export type GeoCoordinates = { lat: number; lng: number };

type CacheEntry = { coords: GeoCoordinates | null; at: number };

const cache = new Map<string, CacheEntry>();
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const BRASIL_API_CEP_V2 = "https://brasilapi.com.br/api/cep/v2";

export function parseBrasilApiCoordinates(data: unknown): GeoCoordinates | null {
  if (!data || typeof data !== "object") return null;
  const location = (data as { location?: { coordinates?: unknown } }).location;
  const raw = location?.coordinates;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { latitude?: unknown; longitude?: unknown };
  const lat = Number(obj.latitude);
  const lng = Number(obj.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function cacheGet(cep: string): GeoCoordinates | null | undefined {
  const hit = cache.get(cep);
  if (!hit) return undefined;
  const ttl = hit.coords ? HIT_TTL_MS : MISS_TTL_MS;
  if (Date.now() - hit.at > ttl) {
    cache.delete(cep);
    return undefined;
  }
  return hit.coords;
}

export async function geocodeCepBrasilApi(cepRaw: string): Promise<GeoCoordinates | null> {
  const cep = normalizeCep(cepRaw);
  if (cep.length !== 8) return null;
  const cached = cacheGet(cep);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(`${BRASIL_API_CEP_V2}/${cep}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      cache.set(cep, { coords: null, at: Date.now() });
      return null;
    }
    const data = await res.json() as unknown;
    const coords = parseBrasilApiCoordinates(data);
    cache.set(cep, { coords, at: Date.now() });
    return coords;
  } catch {
    cache.set(cep, { coords: null, at: Date.now() });
    return null;
  }
}

export async function geocodeOriginCep(cepRaw: string): Promise<GeoCoordinates> {
  const coords = await geocodeCepBrasilApi(cepRaw);
  if (coords) return coords;
  return SE_COORDINATES;
}
