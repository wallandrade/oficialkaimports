export type YuryMotoboyNeighborhoodCoverage = {
  id: string;
  neighborhoodName: string;
  city: string | null;
  price: number;
  intervalHours: number;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
  updatedAt: string | null;
};

export type YuryMotoboyCepRangeCoverage = {
  id: string;
  label: string;
  city: string | null;
  cepStart: number;
  cepEnd: number;
  price: number;
  intervalHours: number;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
  updatedAt: string | null;
};

export type YuryMotoboyCoveragePayload = {
  syncedAt: string | null;
  neighborhoods: YuryMotoboyNeighborhoodCoverage[];
  cepRanges: YuryMotoboyCepRangeCoverage[];
};

export type YuryMotoboyCoverageEventType =
  | "motoboy.neighborhood.upserted"
  | "motoboy.neighborhood.deactivated"
  | "motoboy.neighborhood.deleted"
  | "motoboy.cep_range.upserted"
  | "motoboy.cep_range.deactivated"
  | "motoboy.cep_range.deleted"
  | "motoboy.coverage.full_sync_requested";

export type YuryMotoboyCoverageEvent = {
  eventId: string;
  eventType: YuryMotoboyCoverageEventType;
  occurredAt: string | null;
  source: string | null;
  data: Record<string, unknown>;
};

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function asNullableString(value: unknown): string | null {
  const text = asString(value);
  return text ? text : null;
}

function asBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  const normalized = asString(value).toLowerCase();
  if (!normalized) return fallback;
  return !["0", "false", "off", "no"].includes(normalized);
}

function asIntervalHours(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) return fallback;
  return parsed;
}

function asPrice(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function asCep(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function parseYuryNeighborhoodCoverage(raw: unknown): YuryMotoboyNeighborhoodCoverage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = asString(record.id);
  const neighborhoodName = asString(record.neighborhoodName);
  const price = asPrice(record.price);
  if (!id || !neighborhoodName || price == null) return null;
  return {
    id,
    neighborhoodName,
    city: asNullableString(record.city),
    price,
    intervalHours: asIntervalHours(record.intervalHours),
    isActive: asBoolean(record.isActive, true),
    sortOrder: Number.isFinite(Number(record.sortOrder)) ? Math.trunc(Number(record.sortOrder)) : 0,
    notes: asNullableString(record.notes),
    updatedAt: asNullableString(record.updatedAt),
  };
}

export function parseYuryCepRangeCoverage(raw: unknown): YuryMotoboyCepRangeCoverage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = asString(record.id);
  const label = asString(record.label);
  const price = asPrice(record.price);
  const cepStart = asCep(record.cepStart);
  const cepEnd = asCep(record.cepEnd);
  if (!id || !label || price == null || cepStart == null || cepEnd == null || cepStart > cepEnd) return null;
  return {
    id,
    label,
    city: asNullableString(record.city),
    cepStart,
    cepEnd,
    price,
    intervalHours: asIntervalHours(record.intervalHours, 2),
    isActive: asBoolean(record.isActive, true),
    sortOrder: Number.isFinite(Number(record.sortOrder)) ? Math.trunc(Number(record.sortOrder)) : 0,
    notes: asNullableString(record.notes),
    updatedAt: asNullableString(record.updatedAt),
  };
}

export function parseYuryCoveragePayload(raw: unknown): YuryMotoboyCoveragePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const neighborhoods = Array.isArray(record.neighborhoods)
    ? record.neighborhoods.map(parseYuryNeighborhoodCoverage).filter((item): item is YuryMotoboyNeighborhoodCoverage => Boolean(item))
    : [];
  const cepRanges = Array.isArray(record.cepRanges)
    ? record.cepRanges.map(parseYuryCepRangeCoverage).filter((item): item is YuryMotoboyCepRangeCoverage => Boolean(item))
    : [];
  return {
    syncedAt: asNullableString(record.syncedAt),
    neighborhoods,
    cepRanges,
  };
}

const EVENT_TYPES = new Set<YuryMotoboyCoverageEventType>([
  "motoboy.neighborhood.upserted",
  "motoboy.neighborhood.deactivated",
  "motoboy.neighborhood.deleted",
  "motoboy.cep_range.upserted",
  "motoboy.cep_range.deactivated",
  "motoboy.cep_range.deleted",
  "motoboy.coverage.full_sync_requested",
]);

export function parseYuryCoverageEvent(raw: unknown): YuryMotoboyCoverageEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const eventId = asString(record.eventId);
  const eventType = asString(record.eventType) as YuryMotoboyCoverageEventType;
  if (!eventId || !EVENT_TYPES.has(eventType)) return null;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  return {
    eventId,
    eventType,
    occurredAt: asNullableString(record.occurredAt),
    source: asNullableString(record.source),
    data,
  };
}

export function coverageYuryIdFromEventData(data: Record<string, unknown>): string {
  return asString(data.id);
}
