import type { GeoCoordinates } from "./motoboy-geocode";
import { haversineKm } from "./motoboy-distance";

type CacheEntry = { km: number | null; at: number };

const cache = new Map<string, CacheEntry>();
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "oficialkaimports-motoboy/1.0";
const OSRM_ROUTE_BASE = "https://router.project-osrm.org/route/v1/driving";
const GOOGLE_DISTANCE_MATRIX = "https://maps.googleapis.com/maps/api/distancematrix/json";

export function roundCoord(n: number, decimals = 5): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function motoboyRouteCacheKey(origin: GeoCoordinates, dest: GeoCoordinates): string {
  return [
    roundCoord(origin.lat),
    roundCoord(origin.lng),
    roundCoord(dest.lat),
    roundCoord(dest.lng),
  ].join(",");
}

export function parseOsrmDistanceKm(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as { code?: unknown; routes?: unknown };
  if (obj.code !== "Ok" || !Array.isArray(obj.routes) || obj.routes.length === 0) return null;
  const first = obj.routes[0];
  if (!first || typeof first !== "object") return null;
  const meters = Number((first as { distance?: unknown }).distance);
  if (!Number.isFinite(meters) || meters < 0) return null;
  return meters / 1000;
}

export function parseGoogleDistanceMatrixKm(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const rows = (data as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== "object") return null;
  const elements = (firstRow as { elements?: unknown }).elements;
  if (!Array.isArray(elements) || elements.length === 0) return null;
  const el = elements[0];
  if (!el || typeof el !== "object") return null;
  const obj = el as { status?: unknown; distance?: { value?: unknown } };
  if (obj.status !== "OK") return null;
  const meters = Number(obj.distance?.value);
  if (!Number.isFinite(meters) || meters < 0) return null;
  return meters / 1000;
}

function googleMapsApiKey(): string {
  return String(process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
}

function cacheGet(key: string): number | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  const ttl = hit.km != null ? HIT_TTL_MS : MISS_TTL_MS;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return undefined;
  }
  return hit.km;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (!res.ok) return null;
    return await res.json() as unknown;
  } catch {
    return null;
  }
}

async function fetchGoogleDistanceKm(origin: GeoCoordinates, dest: GeoCoordinates): Promise<number | null> {
  const key = googleMapsApiKey();
  if (!key) return null;
  const params = new URLSearchParams({
    origins: `${origin.lat},${origin.lng}`,
    destinations: `${dest.lat},${dest.lng}`,
    mode: "driving",
    key,
  });
  const data = await fetchJson(`${GOOGLE_DISTANCE_MATRIX}?${params.toString()}`);
  return parseGoogleDistanceMatrixKm(data);
}

async function fetchOsrmDistanceKm(origin: GeoCoordinates, dest: GeoCoordinates): Promise<number | null> {
  const path = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
  const data = await fetchJson(`${OSRM_ROUTE_BASE}/${path}?overview=false&alternatives=false`);
  return parseOsrmDistanceKm(data);
}

export function clearMotoboyRouteCacheForTests(): void {
  cache.clear();
}

/** Km de rua (Google se houver chave, senão OSRM). Haversine só se a rota falhar. */
export async function resolveMotoboyDistanceKm(
  origin: GeoCoordinates,
  dest: GeoCoordinates,
): Promise<number> {
  const fallback = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
  const key = motoboyRouteCacheKey(origin, dest);
  const cached = cacheGet(key);
  if (cached !== undefined) return cached ?? fallback;

  const googleKm = await fetchGoogleDistanceKm(origin, dest);
  if (googleKm != null) {
    cache.set(key, { km: googleKm, at: Date.now() });
    return googleKm;
  }

  const osrmKm = await fetchOsrmDistanceKm(origin, dest);
  if (osrmKm != null) {
    cache.set(key, { km: osrmKm, at: Date.now() });
    return osrmKm;
  }

  cache.set(key, { km: null, at: Date.now() });
  return fallback;
}
