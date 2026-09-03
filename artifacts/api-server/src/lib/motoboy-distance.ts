/** Motoboy por distância (km) a partir do CEP de partida — Praça da Sé por padrão. */

export const MOTOBOY_DISTANCE_SETTING_KEYS = {
  enabled: "motoboy_distance_enabled",
  originCep: "motoboy_origin_cep",
  config: "motoboy_distance_config",
} as const;

export const DEFAULT_MOTOBOY_ORIGIN_CEP = "01001000";

/** Praça da Sé — fallback se a BrasilAPI não devolver coordenadas do CEP origem. */
export const SE_COORDINATES = { lat: -23.550385, lng: -46.633956 };

export const MOTOBOY_DISTANCE_SLOT_ID = "dist";

export const MOTOBOY_DISTANCE_INTERVAL_HOURS = 2;

export type MotoboyDistanceBand = {
  maxKm: number;
  price: number;
};

export type MotoboyDistanceConfig = {
  centroPrice: number;
  consultAfterKm: number;
  bands: MotoboyDistanceBand[];
};

export const DEFAULT_MOTOBOY_DISTANCE_CONFIG: MotoboyDistanceConfig = {
  centroPrice: 50,
  consultAfterKm: 200,
  bands: [
    { maxKm: 10, price: 70 },
    { maxKm: 15, price: 80 },
    { maxKm: 30, price: 100 },
    { maxKm: 50, price: 120 },
    { maxKm: 80, price: 150 },
    { maxKm: 120, price: 200 },
    { maxKm: 200, price: 300 },
  ],
};

const CENTRO_BAIRROS = new Set([
  "se",
  "centro",
  "republica",
  "centro historico",
  "centro historico de sao paulo",
]);

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function digitsOnly(raw: string | undefined | null): string {
  return String(raw ?? "").replace(/\D/g, "");
}

export function normalizeCep(raw: string | undefined | null): string {
  return digitsOnly(raw).slice(0, 8);
}

export function normalizeNeighborhoodName(s: string): string {
  return stripAccents(s)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSaoPauloCity(cidade: string | undefined | null): boolean {
  const city = stripAccents(String(cidade ?? "")).replace(/\s+/g, " ").trim();
  if (!city) return true;
  return city === "sao paulo" || city === "sao paulo sp" || city.startsWith("sao paulo ");
}

/** Sé (CEP 010xxxxx) ou bairro centro/sé/república em São Paulo. */
export function isCentroSe(input: {
  cep?: string | null;
  bairro?: string | null;
  cidade?: string | null;
}): boolean {
  const cep = normalizeCep(input.cep);
  if (cep.length === 8 && cep.startsWith("010")) return true;
  if (!isSaoPauloCity(input.cidade)) return false;
  const bairro = normalizeNeighborhoodName(String(input.bairro ?? ""));
  if (!bairro) return false;
  if (CENTRO_BAIRROS.has(bairro)) return true;
  const tokens = bairro.split(" ").filter(Boolean);
  if (
    tokens.length > 0 &&
    tokens.every((t) => CENTRO_BAIRROS.has(t) || t === "de" || t === "sao" || t === "paulo" || t === "historico")
  ) {
    return tokens.some((t) => t === "se" || t === "centro" || t === "republica");
  }
  return false;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Km cobrado: arredonda para cima em inteiro (10,1 km entra na faixa 11–15). */
export function billedKmFromDistance(km: number): number {
  const n = Number(km);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

export function parseMotoboyDistanceEnabled(raw: string | undefined | null, defaultValue = true): boolean {
  if (raw == null || String(raw).trim() === "") return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

/** Km e bairro são exclusivos: km ligado não consulta cadastro de bairros. */
export function shouldLookupMotoboyNeighborhoods(distanceEnabled: boolean): boolean {
  return !distanceEnabled;
}

export function parseMotoboyOriginCep(raw: string | undefined | null): string {
  const cep = normalizeCep(raw);
  return cep.length === 8 ? cep : DEFAULT_MOTOBOY_ORIGIN_CEP;
}

export function parseMotoboyDistanceConfig(raw: unknown): MotoboyDistanceConfig {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return { ...DEFAULT_MOTOBOY_DISTANCE_CONFIG, bands: [...DEFAULT_MOTOBOY_DISTANCE_CONFIG.bands] };
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return { ...DEFAULT_MOTOBOY_DISTANCE_CONFIG, bands: [...DEFAULT_MOTOBOY_DISTANCE_CONFIG.bands] };
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_MOTOBOY_DISTANCE_CONFIG, bands: [...DEFAULT_MOTOBOY_DISTANCE_CONFIG.bands] };
  }
  const obj = parsed as Record<string, unknown>;
  const centroPrice = Number(obj.centroPrice);
  const consultAfterKm = Number(obj.consultAfterKm);
  const bandsRaw = Array.isArray(obj.bands) ? obj.bands : [];
  const bands: MotoboyDistanceBand[] = [];
  for (const row of bandsRaw) {
    if (!row || typeof row !== "object") continue;
    const maxKm = Number((row as MotoboyDistanceBand).maxKm);
    const price = Number((row as MotoboyDistanceBand).price);
    if (!Number.isFinite(maxKm) || maxKm <= 0) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    bands.push({ maxKm, price });
  }
  bands.sort((a, b) => a.maxKm - b.maxKm);
  return {
    centroPrice: Number.isFinite(centroPrice) && centroPrice >= 0
      ? centroPrice
      : DEFAULT_MOTOBOY_DISTANCE_CONFIG.centroPrice,
    consultAfterKm: Number.isFinite(consultAfterKm) && consultAfterKm > 0
      ? consultAfterKm
      : DEFAULT_MOTOBOY_DISTANCE_CONFIG.consultAfterKm,
    bands: bands.length > 0 ? bands : [...DEFAULT_MOTOBOY_DISTANCE_CONFIG.bands],
  };
}

export function serializeMotoboyDistanceConfig(config: MotoboyDistanceConfig): string {
  return JSON.stringify({
    centroPrice: config.centroPrice,
    consultAfterKm: config.consultAfterKm,
    bands: [...config.bands].sort((a, b) => a.maxKm - b.maxKm),
  });
}

export function priceForBilledKm(
  billedKm: number,
  config: MotoboyDistanceConfig = DEFAULT_MOTOBOY_DISTANCE_CONFIG,
): { outcome: "priced"; price: number; label: string } | { outcome: "consult" } {
  if (billedKm > config.consultAfterKm) return { outcome: "consult" };
  const band = [...config.bands]
    .sort((a, b) => a.maxKm - b.maxKm)
    .find((b) => billedKm <= b.maxKm);
  if (!band) return { outcome: "consult" };
  const prev = [...config.bands]
    .sort((a, b) => a.maxKm - b.maxKm)
    .filter((b) => b.maxKm < band.maxKm)
    .at(-1);
  const from = prev ? prev.maxKm + 1 : 0;
  const label = from <= 0
    ? `Até ${band.maxKm} km`
    : `${from}–${band.maxKm} km`;
  return { outcome: "priced", price: band.price, label };
}

export type MotoboyDistanceQuote =
  | { outcome: "centro"; price: number; km: number | null; billedKm: number | null; label: string }
  | { outcome: "priced"; price: number; km: number; billedKm: number; label: string }
  | { outcome: "consult"; km: number; billedKm: number }
  | { outcome: "unavailable" };

export function quoteMotoboyDistance(input: {
  cep?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  km?: number | null;
  config?: MotoboyDistanceConfig;
}): MotoboyDistanceQuote {
  const config = input.config ?? DEFAULT_MOTOBOY_DISTANCE_CONFIG;
  if (isCentroSe(input)) {
    const km = input.km != null && Number.isFinite(Number(input.km)) ? Number(input.km) : null;
    return {
      outcome: "centro",
      price: config.centroPrice,
      km,
      billedKm: km == null ? null : billedKmFromDistance(km),
      label: "Sé e centro",
    };
  }
  if (input.km == null || !Number.isFinite(Number(input.km))) {
    return { outcome: "unavailable" };
  }
  const km = Math.max(0, Number(input.km));
  const billedKm = billedKmFromDistance(km);
  const priced = priceForBilledKm(billedKm, config);
  if (priced.outcome === "consult") {
    return { outcome: "consult", km, billedKm };
  }
  return {
    outcome: "priced",
    price: priced.price,
    km,
    billedKm,
    label: priced.label,
  };
}

export function isMotoboyDistanceSlotId(neighborhoodId: string): boolean {
  const id = String(neighborhoodId ?? "").trim();
  return id === MOTOBOY_DISTANCE_SLOT_ID || id.startsWith(`${MOTOBOY_DISTANCE_SLOT_ID}_`);
}

export function motoboyCepRangeSlotId(rangeId: string): string {
  return `range_${rangeId}`;
}
