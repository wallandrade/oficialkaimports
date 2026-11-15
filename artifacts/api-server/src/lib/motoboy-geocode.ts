import { haversineKm, normalizeCep, SE_COORDINATES } from "./motoboy-distance";

export type GeoCoordinates = { lat: number; lng: number };

export type GeocodeSource = "google" | "awesomeapi" | "nominatim" | "photon" | "brasilapi";

export type GeocodeHit = { coords: GeoCoordinates; source: GeocodeSource };

export type MotoboyGeocodeInput = {
  cep?: string | null;
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
};

type ResolvedAddress = {
  cep: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
};

type CacheEntry = { hit: GeocodeHit | null; at: number };

/** Centroide de São Paulo que a BrasilAPI devolve para CEPs da cidade (visto em 15/11/2026). */
export const SAO_PAULO_CITY_CENTROID = { lat: -23.5475, lng: -46.63611 };

const GENERIC_CENTROID_RADIUS_KM = 0.2;
const SAME_ORIGIN_RADIUS_KM = 0.05;

const cache = new Map<string, CacheEntry>();
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const USER_AGENT = "oficialkaimports-motoboy/1.0 (cotacao de frete motoboy)";
const NOMINATIM_GAP_MS = 1100;

const BRASIL_API_CEP_V2 = "https://brasilapi.com.br/api/cep/v2";
const AWESOME_API_CEP = "https://cep.awesomeapi.com.br/json";
const VIA_CEP = "https://viacep.com.br/ws";
const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const PHOTON_SEARCH = "https://photon.komoot.io/api/";
const GOOGLE_GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";
const SLOW_FETCH_TIMEOUT_MS = 8000;

let nominatimQueue: Promise<void> = Promise.resolve();
let lastNominatimAt = 0;

export function normalizeHouseNumber(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/\s+/g, "").slice(0, 20);
}

export function motoboyGeocodeCacheKey(cepRaw: string | null | undefined, numberRaw: string | null | undefined): string {
  return `${normalizeCep(cepRaw)}|${normalizeHouseNumber(numberRaw)}`;
}

export function isGenericCityCentroid(coords: GeoCoordinates): boolean {
  return haversineKm(
    SAO_PAULO_CITY_CENTROID.lat,
    SAO_PAULO_CITY_CENTROID.lng,
    coords.lat,
    coords.lng,
  ) < GENERIC_CENTROID_RADIUS_KM;
}

export function isSameAsMotoboyOrigin(coords: GeoCoordinates): boolean {
  return haversineKm(SE_COORDINATES.lat, SE_COORDINATES.lng, coords.lat, coords.lng) < SAME_ORIGIN_RADIUS_KM;
}

/** Coordenada inutilizável: 0,0, centroide da cidade ou o mesmo ponto da origem. */
export function isRejectedGeocode(coords: GeoCoordinates | null | undefined): boolean {
  if (!coords) return true;
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return true;
  if (Math.abs(coords.lat) > 90 || Math.abs(coords.lng) > 180) return true;
  if (coords.lat === 0 && coords.lng === 0) return true;
  if (isGenericCityCentroid(coords)) return true;
  if (isSameAsMotoboyOrigin(coords)) return true;
  return false;
}

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

export function parseAwesomeApiCoordinates(data: unknown): GeoCoordinates | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const obj = row as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown; code?: unknown; status?: unknown };
  if (obj.code === "not_found" || obj.code === "invalid") return null;
  const status = Number(obj.status);
  if (Number.isFinite(status) && status >= 400) return null;
  const lat = Number(obj.lat ?? obj.latitude);
  const lng = Number(obj.lng ?? obj.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

const NOMINATIM_CITY_TYPES = new Set([
  "city",
  "administrative",
  "state",
  "municipality",
  "county",
  "region",
  "country",
]);

function foldPlace(raw: unknown): string {
  return cleanText(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function parsePhotonCoordinates(
  data: unknown,
  hint?: { street?: string | null; city?: string | null },
): GeoCoordinates | null {
  if (!data || typeof data !== "object") return null;
  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) return null;
  const street = foldPlace(hint?.street).replace(/^(rua|avenida|av|travessa|alameda|praca)\s+/, "");
  const city = foldPlace(hint?.city);
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const props = (feature as { properties?: Record<string, unknown> }).properties ?? {};
    const country = foldPlace(props.countrycode || props.country);
    if (country && country !== "br" && country !== "brazil" && country !== "brasil") continue;
    const featureCity = foldPlace(props.city);
    if (city && featureCity && featureCity !== city) continue;
    const name = foldPlace(props.name || props.street);
    if (street && name && !name.includes(street) && !street.includes(name)) continue;
    const raw = (feature as { geometry?: { coordinates?: unknown } }).geometry?.coordinates;
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const lng = Number(raw[0]);
    const lat = Number(raw[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat === 0 && lng === 0) continue;
    return { lat, lng };
  }
  return null;
}

export function parseNominatimCoordinates(data: unknown): GeoCoordinates | null {
  if (!Array.isArray(data)) return null;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const obj = row as { lat?: unknown; lon?: unknown; type?: unknown; addresstype?: unknown };
    const kind = String(obj.addresstype || obj.type || "").toLowerCase();
    if (NOMINATIM_CITY_TYPES.has(kind)) continue;
    const lat = Number(obj.lat);
    const lng = Number(obj.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat === 0 && lng === 0) continue;
    return { lat, lng };
  }
  return null;
}

export function parseGoogleGeocodeCoordinates(data: unknown): GeoCoordinates | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as { status?: unknown; results?: unknown };
  if (obj.status !== "OK" || !Array.isArray(obj.results)) return null;
  for (const row of obj.results) {
    if (!row || typeof row !== "object") continue;
    const geometry = (row as {
      geometry?: { location?: { lat?: unknown; lng?: unknown }; location_type?: unknown };
    }).geometry;
    if (String(geometry?.location_type ?? "") === "APPROXIMATE") continue;
    const lat = Number(geometry?.location?.lat);
    const lng = Number(geometry?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat === 0 && lng === 0) continue;
    return { lat, lng };
  }
  return null;
}

export function parseViaCepAddress(data: unknown): Omit<ResolvedAddress, "cep" | "number"> | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as { erro?: unknown; logradouro?: unknown; bairro?: unknown; localidade?: unknown; uf?: unknown };
  if (obj.erro === true || obj.erro === "true") return null;
  return {
    street: cleanText(obj.logradouro),
    neighborhood: cleanText(obj.bairro),
    city: cleanText(obj.localidade),
    state: cleanText(obj.uf).toUpperCase(),
  };
}

export function formatMotoboyGeocodeQuery(address: ResolvedAddress): string {
  const line = [address.street, address.number].filter(Boolean).join(", ");
  const cep = address.cep.length === 8 ? `${address.cep.slice(0, 5)}-${address.cep.slice(5)}` : "";
  return [line, address.neighborhood, address.city, address.state, cep, "Brasil"].filter(Boolean).join(", ");
}

function cleanText(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

function cacheGet(key: string): GeocodeHit | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  const ttl = hit.hit ? HIT_TTL_MS : MISS_TTL_MS;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return undefined;
  }
  return hit.hit;
}

function googleMapsApiKey(): string {
  return String(process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
}

type FetchOutcome = {
  data: unknown | null;
  status: number | null;
  reason: "ok" | "timeout" | "network" | "http";
};

function logGeocodeFailure(source: GeocodeSource, reason: string, status?: number | null): void {
  console.warn("[motoboy-geocode] fonte falhou", {
    source,
    reason,
    status: status ?? null,
  });
}

async function fetchJson(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
  extraHeaders?: Record<string, string>,
): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...extraHeaders,
      },
    });
    if (!res.ok) return { data: null, status: res.status, reason: "http" };
    return { data: await res.json() as unknown, status: res.status, reason: "ok" };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const reason = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
    return { data: null, status: null, reason };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withNominatimSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimQueue.then(async () => {
    const wait = lastNominatimAt + NOMINATIM_GAP_MS - Date.now();
    if (wait > 0) await delay(wait);
    lastNominatimAt = Date.now();
    return fn();
  });
  nominatimQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function fillAddress(input: MotoboyGeocodeInput): Promise<ResolvedAddress> {
  const cep = normalizeCep(input.cep);
  let street = cleanText(input.street);
  let neighborhood = cleanText(input.neighborhood);
  let city = cleanText(input.city);
  let state = cleanText(input.state).toUpperCase();
  const number = normalizeHouseNumber(input.number);
  if (cep.length === 8 && (!street || !city || !state)) {
    const data = await fetchJson(`${VIA_CEP}/${cep}/json/`);
    const via = parseViaCepAddress(data.data);
    if (via) {
      street = street || via.street;
      neighborhood = neighborhood || via.neighborhood;
      city = city || via.city;
      state = state || via.state;
    }
  }
  return { cep, street, number, neighborhood, city, state };
}

function accept(source: GeocodeSource, coords: GeoCoordinates | null): GeoCoordinates | null {
  if (!coords) {
    logGeocodeFailure(source, "empty");
    return null;
  }
  if (isRejectedGeocode(coords)) {
    logGeocodeFailure(source, "rejected");
    return null;
  }
  return coords;
}

function failureReason(result: FetchOutcome): string {
  if (result.status === 429) return "quota";
  if (result.reason === "http") return "http";
  return result.reason;
}

async function geocodeGoogle(address: ResolvedAddress): Promise<GeocodeHit | null> {
  const key = googleMapsApiKey();
  if (!key) return null;
  const params = new URLSearchParams({
    address: formatMotoboyGeocodeQuery(address),
    region: "br",
    language: "pt-BR",
    key,
  });
  const result = await fetchJson(`${GOOGLE_GEOCODE}?${params.toString()}`);
  if (result.reason !== "ok") {
    logGeocodeFailure("google", failureReason(result), result.status);
    return null;
  }
  const coords = accept("google", parseGoogleGeocodeCoordinates(result.data));
  return coords ? { coords, source: "google" } : null;
}

function awesomeApiToken(): string {
  return String(process.env.AWESOMEAPI_TOKEN ?? "").trim();
}

async function geocodeAwesome(cep: string): Promise<GeocodeHit | null> {
  if (cep.length !== 8) return null;
  const params = new URLSearchParams();
  const token = awesomeApiToken();
  if (token) params.set("token", token);
  const query = params.toString();
  const result = await fetchJson(`${AWESOME_API_CEP}/${cep}${query ? `?${query}` : ""}`);
  if (result.reason !== "ok") {
    logGeocodeFailure("awesomeapi", failureReason(result), result.status);
    return null;
  }
  const coords = accept("awesomeapi", parseAwesomeApiCoordinates(result.data));
  return coords ? { coords, source: "awesomeapi" } : null;
}

async function nominatimSearch(params: URLSearchParams): Promise<GeocodeHit | null> {
  const result = await withNominatimSlot(() => fetchJson(
    `${NOMINATIM_SEARCH}?${params.toString()}`,
    SLOW_FETCH_TIMEOUT_MS,
  ));
  if (result.reason !== "ok") {
    logGeocodeFailure("nominatim", failureReason(result), result.status);
    return null;
  }
  const coords = accept("nominatim", parseNominatimCoordinates(result.data));
  return coords ? { coords, source: "nominatim" } : null;
}

async function geocodeNominatim(address: ResolvedAddress): Promise<GeocodeHit | null> {
  const q = formatMotoboyGeocodeQuery(address);
  if (q && q !== "Brasil") {
    const freeform = await nominatimSearch(new URLSearchParams({
      format: "jsonv2",
      limit: "1",
      countrycodes: "br",
      q,
    }));
    if (freeform) return freeform;
  }
  if (!address.street || !address.city) return null;
  const structured = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "br",
    street: address.street,
    city: address.city,
  });
  if (address.state.length > 2) structured.set("state", address.state);
  return nominatimSearch(structured);
}

async function geocodePhoton(address: ResolvedAddress): Promise<GeocodeHit | null> {
  const q = [address.street, address.neighborhood, address.city, address.state].filter(Boolean).join(", ");
  if (!q) return null;
  const params = new URLSearchParams({
    q,
    limit: "5",
    lat: String(SE_COORDINATES.lat),
    lon: String(SE_COORDINATES.lng),
  });
  const result = await fetchJson(`${PHOTON_SEARCH}?${params.toString()}`, SLOW_FETCH_TIMEOUT_MS);
  if (result.reason !== "ok") {
    logGeocodeFailure("photon", failureReason(result), result.status);
    return null;
  }
  const coords = accept("photon", parsePhotonCoordinates(result.data, {
    street: address.street,
    city: address.city,
  }));
  return coords ? { coords, source: "photon" } : null;
}

async function geocodeBrasil(cep: string): Promise<GeocodeHit | null> {
  if (cep.length !== 8) return null;
  const result = await fetchJson(`${BRASIL_API_CEP_V2}/${cep}`);
  if (result.reason !== "ok") {
    logGeocodeFailure("brasilapi", failureReason(result), result.status);
    return null;
  }
  const coords = accept("brasilapi", parseBrasilApiCoordinates(result.data));
  return coords ? { coords, source: "brasilapi" } : null;
}

export function clearMotoboyGeocodeCacheForTests(): void {
  cache.clear();
  nominatimQueue = Promise.resolve();
  lastNominatimAt = 0;
}

/**
 * Geocode do destino por endereço (rua, número, bairro, cidade, UF).
 * Cadeia: Google (se houver chave) → AwesomeAPI → Nominatim (texto, depois rua+cidade)
 * → Photon → BrasilAPI. Centroide e ponto igual à Sé são descartados.
 * Centroide da cidade e ponto igual à Sé são descartados. Origem não entra aqui.
 * Cache em memória por CEP + número (acerto 24h, erro 1h).
 */
export async function geocodeMotoboyDestination(input: MotoboyGeocodeInput): Promise<GeocodeHit | null> {
  const cep = normalizeCep(input.cep);
  const number = normalizeHouseNumber(input.number);
  if (cep.length !== 8 && !cleanText(input.street)) return null;
  const cacheKey = motoboyGeocodeCacheKey(cep, number);
  if (cep.length === 8) {
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;
  }

  const address = await fillAddress({ ...input, cep, number });
  const providers = [
    () => geocodeGoogle(address),
    () => geocodeAwesome(address.cep),
    () => geocodeNominatim(address),
    () => geocodePhoton(address),
    () => geocodeBrasil(address.cep),
  ];
  for (const provider of providers) {
    const hit = await provider();
    if (hit) {
      if (cep.length === 8) cache.set(cacheKey, { hit, at: Date.now() });
      return hit;
    }
  }
  if (cep.length === 8) cache.set(cacheKey, { hit: null, at: Date.now() });
  return null;
}
