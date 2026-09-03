export const MOTOBOY_DISTANCE_SETTING_KEYS = {
  enabled: "motoboy_distance_enabled",
  originCep: "motoboy_origin_cep",
  config: "motoboy_distance_config",
} as const;

export type MotoboyDistanceBand = {
  maxKm: number;
  price: number;
};

export type MotoboyDistanceConfig = {
  centroPrice: number;
  consultAfterKm: number;
  bands: MotoboyDistanceBand[];
};

export const DEFAULT_MOTOBOY_ORIGIN_CEP = "01001000";

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

export function parseMotoboyDistanceEnabled(raw: string | undefined | null, defaultValue = true): boolean {
  if (raw == null || String(raw).trim() === "") return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

export function parseMotoboyOriginCep(raw: string | undefined | null): string {
  const cep = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  return cep.length === 8 ? cep : DEFAULT_MOTOBOY_ORIGIN_CEP;
}

export function parseMotoboyDistanceConfig(raw: unknown): MotoboyDistanceConfig {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return cloneConfig(DEFAULT_MOTOBOY_DISTANCE_CONFIG);
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return cloneConfig(DEFAULT_MOTOBOY_DISTANCE_CONFIG);
    }
  }
  if (!parsed || typeof parsed !== "object") return cloneConfig(DEFAULT_MOTOBOY_DISTANCE_CONFIG);
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

function cloneConfig(config: MotoboyDistanceConfig): MotoboyDistanceConfig {
  return {
    centroPrice: config.centroPrice,
    consultAfterKm: config.consultAfterKm,
    bands: [...config.bands],
  };
}
