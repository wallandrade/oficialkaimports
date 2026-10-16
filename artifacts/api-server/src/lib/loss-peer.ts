import {
  carrierDisplayName,
  carrierKey,
  foldPlace,
  isSharedLossKind,
  isSharedLossRegionKey,
  lossRegionLabel,
  lossScopeFromRegionKey,
  stateCode,
  type CarrierLossType,
} from "./carrier-loss";
import { LOSS_SNAPSHOT_SOURCE, YURY_LOSS_SOURCE } from "./loss-sync-config";

export const LOSS_SNAPSHOT_LIMIT = 2000;

let peerReadFailed = false;

export function notePeerLossRead(ok: boolean): void {
  peerReadFailed = !ok;
}

export function peerLossBoardStatus(enabled: boolean): { enabled: boolean; ok: boolean } {
  return { enabled, ok: enabled && !peerReadFailed };
}

export type PeerLossIncident = {
  id: string;
  carrierKey: string;
  carrierLabel: string;
  cityKey: string;
  cityLabel: string;
  state: string;
  neighborhoodKey: string;
  neighborhoodLabel: string | null;
  regionKey: string;
  regionLabel: string;
  scope: "region" | "city";
  kind: CarrierLossType;
  occurredAt: Date;
  removedAt: Date | null;
};

export type PeerLossSnapshot = {
  source: string;
  syncedAt: string | null;
  windowDays: number;
  truncated: boolean;
  incidents: PeerLossIncident[];
};

export type OwnLossSnapshotRow = {
  id: string;
  carrierKey: string;
  carrierName: string;
  cityKey: string;
  cityName: string;
  state: string;
  neighborhoodKey: string;
  neighborhoodName: string | null;
  regionKey: string;
  incidentType: string;
  occurredAt: Date;
};

export type PublishedLossIncident = {
  id: string;
  carrierKey: string;
  carrierLabel: string;
  cityKey: string;
  cityLabel: string;
  state: string;
  neighborhoodKey?: string;
  neighborhoodLabel?: string;
  regionKey: string;
  regionLabel: string;
  scope: "region" | "city";
  kind: string;
  occurredAt: string;
};

export function parsePeerLossSnapshot(raw: unknown): PeerLossSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.incidents)) return null;
  const incidents: PeerLossIncident[] = [];
  for (const item of body.incidents) {
    const parsed = parsePeerIncident(item);
    if (parsed) incidents.push(parsed);
  }
  const source = String(body.source || YURY_LOSS_SOURCE).trim() || YURY_LOSS_SOURCE;
  return {
    source,
    syncedAt: typeof body.syncedAt === "string" && body.syncedAt.trim() ? body.syncedAt.trim() : null,
    windowDays: Number.isFinite(Number(body.windowDays)) ? Number(body.windowDays) : 180,
    truncated: body.truncated === true,
    incidents,
  };
}

export function reconcilePeerLossList(
  existingActiveIds: string[],
  incidents: PeerLossIncident[],
  truncated: boolean,
): { upserts: PeerLossIncident[]; removeIds: string[] } {
  const seen = new Set(incidents.map((item) => item.id));
  const removeIds = truncated ? [] : existingActiveIds.filter((id) => !seen.has(id));
  return { upserts: incidents, removeIds };
}

export function toPublishedLossIncident(row: OwnLossSnapshotRow): PublishedLossIncident | null {
  const id = String(row.id || "").trim();
  const regionKey = String(row.regionKey || "").trim().toLowerCase();
  const kind = String(row.incidentType || "").trim().toLowerCase();
  const occurredAt = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt);
  if (!id || !isSharedLossRegionKey(regionKey) || !isSharedLossKind(kind)) return null;
  if (Number.isNaN(occurredAt.getTime())) return null;
  const key = carrierKey(row.carrierKey || row.carrierName);
  const city = foldPlace(row.cityKey || row.cityName);
  const uf = stateCode(row.state);
  const cityLabel = String(row.cityName || "").trim();
  if (!key || !city || !uf || !cityLabel) return null;
  const published: PublishedLossIncident = {
    id,
    carrierKey: key,
    carrierLabel: carrierDisplayName(row.carrierName || row.carrierKey),
    cityKey: city,
    cityLabel,
    state: uf,
    regionKey,
    regionLabel: lossRegionLabel(regionKey, cityLabel),
    scope: lossScopeFromRegionKey(regionKey),
    kind,
    occurredAt: occurredAt.toISOString(),
  };
  const neighborhoodKey = foldPlace(row.neighborhoodKey || row.neighborhoodName);
  if (neighborhoodKey) {
    published.neighborhoodKey = neighborhoodKey;
    published.neighborhoodLabel = String(row.neighborhoodName || "").trim() || neighborhoodKey;
  }
  return published;
}

export function buildLossSnapshotEnvelope(
  incidents: PublishedLossIncident[],
  truncated: boolean,
  now = new Date(),
) {
  return {
    syncedAt: now.toISOString(),
    source: LOSS_SNAPSHOT_SOURCE,
    windowDays: 180,
    truncated,
    incidents,
  };
}

function parsePeerIncident(raw: unknown): PeerLossIncident | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || "").trim();
  if (!id || id.length > 255) return null;
  const regionKey = String(row.regionKey || "").trim().toLowerCase();
  if (!isSharedLossRegionKey(regionKey)) return null;
  const kindRaw = foldPlace(row.kind);
  if (!isSharedLossKind(kindRaw)) return null;
  const occurredAt = parseRequiredDate(row.occurredAt);
  if (!occurredAt) return null;
  const removedAt = parseOptionalDate(row.removedAt);
  if (removedAt === undefined) return null;
  const carrierLabel = String(row.carrierLabel || "").trim();
  const key = carrierKey(row.carrierKey || carrierLabel);
  const cityLabel = String(row.cityLabel || "").trim();
  const city = foldPlace(row.cityKey || cityLabel);
  const uf = stateCode(row.state);
  if (!key || !carrierLabel || !city || !cityLabel || !uf) return null;
  const neighborhoodKey = foldPlace(row.neighborhoodKey || row.neighborhoodLabel);
  const neighborhoodLabel = String(row.neighborhoodLabel || "").trim();
  return {
    id,
    carrierKey: key,
    carrierLabel: carrierDisplayName(carrierLabel),
    cityKey: city,
    cityLabel,
    state: uf,
    neighborhoodKey,
    neighborhoodLabel: neighborhoodKey ? (neighborhoodLabel || neighborhoodKey) : null,
    regionKey,
    regionLabel: String(row.regionLabel || "").trim() || lossRegionLabel(regionKey, cityLabel),
    scope: lossScopeFromRegionKey(regionKey),
    kind: kindRaw,
    occurredAt,
    removedAt,
  };
}

function parseRequiredDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** null = ausente. undefined = preenchido e inválido. */
function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}
