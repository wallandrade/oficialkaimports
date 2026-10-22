import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { carrierLossPeerIncidentsTable, db } from "@workspace/db";
import { foldPlace, lossIncidentMatchesDestination, lossLookupCityKeys, stateCode, type CarrierLossAlertIncident } from "./carrier-loss";
import {
  getYuryLossSyncToken,
  LOSS_SNAPSHOT_PATH,
  YURY_LOSS_SOURCE,
  yuryLossPullBlockReason,
} from "./loss-sync-config";
import { getYuryMotoboyApiBase } from "./motoboy-yury-config";
import {
  parsePeerLossSnapshot,
  reconcilePeerLossList,
  type PeerLossIncident,
  type PeerLossSnapshot,
} from "./loss-peer";

const FETCH_TIMEOUT_MS = 8_000;
const REMOVE_CHUNK = 200;

export type YuryLossSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  upserted: number;
  removed: number;
  syncedAt: string;
};

export async function pullYuryLossSnapshot(): Promise<YuryLossSyncResult> {
  const block = yuryLossPullBlockReason();
  if (block) {
    return { ok: true, skipped: true, reason: block, upserted: 0, removed: 0, syncedAt: new Date().toISOString() };
  }
  const payload = await fetchYuryLossSnapshot();
  return applyPeerLossSnapshot(payload);
}

export async function fetchYuryLossSnapshot(): Promise<PeerLossSnapshot> {
  const token = getYuryLossSyncToken();
  if (!token) throw new Error("YURY_LOSS_SYNC_TOKEN ausente.");
  const url = `${getYuryMotoboyApiBase()}${LOSS_SNAPSHOT_PATH}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 401) throw new Error("Token de leitura da lista Yury inválido.");
  if (response.status === 503) throw new Error("Lista de extravio da Yury ainda sem token.");
  if (!response.ok) throw new Error(`Yury loss snapshot HTTP ${response.status}`);
  const payload = parsePeerLossSnapshot(await response.json());
  if (!payload) throw new Error("Payload de extravio da Yury inválido.");
  return payload;
}

export async function applyPeerLossSnapshot(payload: PeerLossSnapshot): Promise<YuryLossSyncResult> {
  const now = new Date();
  const existing = await db
    .select({ id: carrierLossPeerIncidentsTable.id })
    .from(carrierLossPeerIncidentsTable)
    .where(and(
      eq(carrierLossPeerIncidentsTable.source, YURY_LOSS_SOURCE),
      isNull(carrierLossPeerIncidentsTable.removedAt),
    ));
  const plan = reconcilePeerLossList(existing.map((row) => row.id), payload.incidents, payload.truncated);
  for (const incident of plan.upserts) {
    await upsertPeerIncident(incident, now);
  }
  let removed = 0;
  for (let offset = 0; offset < plan.removeIds.length; offset += REMOVE_CHUNK) {
    const chunk = plan.removeIds.slice(offset, offset + REMOVE_CHUNK);
    if (!chunk.length) continue;
    await db
      .update(carrierLossPeerIncidentsTable)
      .set({ removedAt: now, updatedAt: now })
      .where(and(
        eq(carrierLossPeerIncidentsTable.source, YURY_LOSS_SOURCE),
        inArray(carrierLossPeerIncidentsTable.id, chunk),
        isNull(carrierLossPeerIncidentsTable.removedAt),
      ));
    removed += chunk.length;
  }
  return {
    ok: true,
    upserted: plan.upserts.length,
    removed,
    syncedAt: payload.syncedAt || now.toISOString(),
  };
}

export async function listPeerLossAlerts(
  cityKey: string,
  state: string,
  regionKey: string,
  since: Date,
): Promise<CarrierLossAlertIncident[]> {
  const keys = lossLookupCityKeys(cityKey, state);
  const uf = stateCode(state);
  if (!keys.length || !uf) return [];
  const cityClause = keys.length === 1
    ? eq(carrierLossPeerIncidentsTable.cityKey, keys[0])
    : inArray(carrierLossPeerIncidentsTable.cityKey, keys);
  const rows = await db
    .select()
    .from(carrierLossPeerIncidentsTable)
    .where(and(
      eq(carrierLossPeerIncidentsTable.source, YURY_LOSS_SOURCE),
      cityClause,
      eq(carrierLossPeerIncidentsTable.state, uf),
      isNull(carrierLossPeerIncidentsTable.removedAt),
      gte(carrierLossPeerIncidentsTable.occurredAt, since),
    ));
  const destination = { city: foldPlace(cityKey), state: uf, regionKey };
  return rows
    .filter((row) => lossIncidentMatchesDestination(row, destination))
    .map((row) => ({
      carrierKey: row.carrierKey,
      carrierName: row.carrierName,
      neighborhoodKey: row.neighborhoodKey || "",
      neighborhoodName: row.neighborhoodName,
      regionKey: row.regionKey,
      incidentType: row.incidentType,
      orderNumber: null,
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt),
      cityName: row.cityName,
      state: row.state,
      fromPeer: true,
    }));
}

async function upsertPeerIncident(incident: PeerLossIncident, now: Date): Promise<void> {
  const values = {
    id: incident.id,
    source: YURY_LOSS_SOURCE,
    carrierKey: incident.carrierKey,
    carrierName: incident.carrierLabel,
    cityKey: incident.cityKey,
    cityName: incident.cityLabel,
    state: incident.state,
    neighborhoodKey: incident.neighborhoodKey,
    neighborhoodName: incident.neighborhoodLabel,
    regionKey: incident.regionKey,
    regionLabel: incident.regionLabel,
    scope: incident.scope,
    incidentType: incident.kind,
    occurredAt: incident.occurredAt,
    removedAt: incident.removedAt,
    syncedAt: now,
    updatedAt: now,
  };
  await db.insert(carrierLossPeerIncidentsTable).values({
    ...values,
    createdAt: now,
  }).onDuplicateKeyUpdate({
    set: values,
  });
}
