import { db, motoboyCepRangesTable, motoboyNeighborhoodsTable, siteSettingsTable, tenantSettingsTable } from "@workspace/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { pickMotoboyCepRange } from "./motoboy-cep-range-pick";
import { normalizeMotoboyPlaceName } from "./motoboy-neighborhood-normalize";
import {
  haversineKm,
  MOTOBOY_DISTANCE_SETTING_KEYS,
  MOTOBOY_DISTANCE_SLOT_ID,
  motoboyCepRangeSlotId,
  normalizeCep,
  parseMotoboyDistanceConfig,
  parseMotoboyDistanceEnabled,
  parseMotoboyOriginCep,
  quoteMotoboyDistance,
  shouldLookupMotoboyNeighborhoods,
  type MotoboyDistanceConfig,
} from "./motoboy-distance";
import { geocodeCepBrasilApi, geocodeOriginCep } from "./motoboy-geocode";

export type MotoboyCoverageMatch = {
  source: "neighborhood" | "distance" | "cep_range";
  id: string;
  price: number;
  label: string;
  notes: string | null;
  km: number | null;
};

export type MotoboyCoverageResult = {
  match: MotoboyCoverageMatch | null;
  consult: boolean;
};

type DistanceSettings = {
  enabled: boolean;
  originCep: string;
  config: MotoboyDistanceConfig;
};

async function getSettingValue(tenantId: string, key: string): Promise<string | null> {
  const tenantRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);

  if (tenantRows[0]?.value != null) return tenantRows[0].value;

  const legacyRows = await db
    .select({ value: siteSettingsTable.value })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.key, key))
    .limit(1);

  return legacyRows[0]?.value ?? null;
}

async function loadDistanceSettings(tenantId: string): Promise<DistanceSettings> {
  const [enabledRaw, originRaw, configRaw] = await Promise.all([
    getSettingValue(tenantId, MOTOBOY_DISTANCE_SETTING_KEYS.enabled),
    getSettingValue(tenantId, MOTOBOY_DISTANCE_SETTING_KEYS.originCep),
    getSettingValue(tenantId, MOTOBOY_DISTANCE_SETTING_KEYS.config),
  ]);
  return {
    enabled: parseMotoboyDistanceEnabled(enabledRaw),
    originCep: parseMotoboyOriginCep(originRaw),
    config: parseMotoboyDistanceConfig(configRaw),
  };
}

async function findNeighborhood(tenantId: string, bairro: string, cidade: string) {
  const lookupName = normalizeMotoboyPlaceName(bairro);
  if (!lookupName) return null;
  const lookupCity = normalizeMotoboyPlaceName(cidade);

  const rows = await db
    .select()
    .from(motoboyNeighborhoodsTable)
    .where(and(
      eq(motoboyNeighborhoodsTable.tenantId, tenantId),
      eq(motoboyNeighborhoodsTable.isActive, true),
    ));

  return rows.find((r) => (
    normalizeMotoboyPlaceName(r.neighborhoodName) === lookupName
    && (!lookupCity || normalizeMotoboyPlaceName(r.city) === lookupCity)
  )) ?? null;
}

async function findCepRange(tenantId: string, cep: string, cidade: string) {
  const digits = normalizeCep(cep);
  if (digits.length !== 8) return null;
  const cepNum = parseInt(digits, 10);

  const rows = await db
    .select()
    .from(motoboyCepRangesTable)
    .where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      eq(motoboyCepRangesTable.isActive, true),
      lte(motoboyCepRangesTable.cepStart, cepNum),
      gte(motoboyCepRangesTable.cepEnd, cepNum),
    ));

  return pickMotoboyCepRange(rows, cidade);
}

function distanceNotes(label: string, km: number | null): string {
  if (km == null) return `Motoboy — ${label}`;
  const shown = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return `Motoboy — ${label} (${shown} km)`;
}

export async function lookupMotoboyCoverage(input: {
  tenantId: string;
  cep?: string | null;
  bairro?: string | null;
  cidade?: string | null;
}): Promise<MotoboyCoverageResult> {
  const cep = normalizeCep(input.cep);
  const bairro = String(input.bairro ?? "").trim();
  const cidade = String(input.cidade ?? "").trim();
  const settings = await loadDistanceSettings(input.tenantId);

  if (shouldLookupMotoboyNeighborhoods(settings.enabled) && bairro) {
    const neighborhood = await findNeighborhood(input.tenantId, bairro, cidade);
    if (neighborhood) {
      return {
        consult: false,
        match: {
          source: "neighborhood",
          id: neighborhood.id,
          price: Number(neighborhood.price),
          label: neighborhood.neighborhoodName,
          notes: neighborhood.notes ?? `Entrega em ${neighborhood.neighborhoodName}`,
          km: null,
        },
      };
    }
  }

  if (settings.enabled && cep.length === 8) {
    const destCoords = await geocodeCepBrasilApi(cep);
    let km: number | null = null;
    if (destCoords) {
      const originCoords = await geocodeOriginCep(settings.originCep);
      km = haversineKm(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng);
    }

    const quote = quoteMotoboyDistance({
      cep,
      bairro,
      cidade,
      km,
      config: settings.config,
    });

    if (quote.outcome === "centro" || quote.outcome === "priced") {
      return {
        consult: false,
        match: {
          source: "distance",
          id: MOTOBOY_DISTANCE_SLOT_ID,
          price: quote.price,
          label: quote.label,
          notes: distanceNotes(quote.label, quote.km),
          km: quote.km,
        },
      };
    }
    if (quote.outcome === "consult") {
      return { match: null, consult: true };
    }
  }

  if (cep.length === 8) {
    const range = await findCepRange(input.tenantId, cep, cidade);
    if (range) {
      return {
        consult: false,
        match: {
          source: "cep_range",
          id: motoboyCepRangeSlotId(range.id),
          price: Number(range.price),
          label: range.label,
          notes: range.notes ?? `Entrega — ${range.label}`,
          km: null,
        },
      };
    }
  }

  return { match: null, consult: false };
}
