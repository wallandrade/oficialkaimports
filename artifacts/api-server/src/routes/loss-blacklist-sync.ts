import { and, desc, gte, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { carrierLossIncidentsTable, db } from "@workspace/db";
import { CARRIER_LOSS_WINDOW_MS } from "../lib/carrier-loss";
import {
  buildLossSnapshotEnvelope,
  LOSS_SNAPSHOT_LIMIT,
  toPublishedLossIncident,
  type PublishedLossIncident,
} from "../lib/loss-peer";
import {
  getLossSyncToken,
  lossSyncAuthStatus,
  readLossSyncCredential,
} from "../lib/loss-sync-config";

const router: IRouter = Router();

router.get("/integrations/loss-blacklist/snapshot", async (req, res) => {
  const status = lossSyncAuthStatus(
    readLossSyncCredential(req.get("authorization"), req.get("x-api-key")),
    getLossSyncToken(),
  );
  if (status === 503) {
    res.status(503).json({ error: "LOSS_SYNC_DISABLED" });
    return;
  }
  if (status === 401) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const since = new Date(Date.now() - CARRIER_LOSS_WINDOW_MS);
    const rows = await db
      .select({
        id: carrierLossIncidentsTable.id,
        carrierKey: carrierLossIncidentsTable.carrierKey,
        carrierName: carrierLossIncidentsTable.carrierName,
        cityKey: carrierLossIncidentsTable.cityKey,
        cityName: carrierLossIncidentsTable.cityName,
        state: carrierLossIncidentsTable.state,
        neighborhoodKey: carrierLossIncidentsTable.neighborhoodKey,
        neighborhoodName: carrierLossIncidentsTable.neighborhoodName,
        regionKey: carrierLossIncidentsTable.regionKey,
        incidentType: carrierLossIncidentsTable.incidentType,
        occurredAt: carrierLossIncidentsTable.occurredAt,
      })
      .from(carrierLossIncidentsTable)
      .where(and(
        isNull(carrierLossIncidentsTable.removedAt),
        gte(carrierLossIncidentsTable.occurredAt, since),
      ))
      .orderBy(desc(carrierLossIncidentsTable.occurredAt))
      .limit(LOSS_SNAPSHOT_LIMIT + 1);
    const truncated = rows.length > LOSS_SNAPSHOT_LIMIT;
    const incidents = (truncated ? rows.slice(0, LOSS_SNAPSHOT_LIMIT) : rows)
      .map((row) => toPublishedLossIncident({
        ...row,
        occurredAt: row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt),
      }))
      .filter((item): item is PublishedLossIncident => item != null);
    res.json(buildLossSnapshotEnvelope(incidents, truncated));
  } catch (err) {
    console.error("[LossSync] snapshot failed", err);
    res.status(500).json({ error: "SNAPSHOT_FAILED" });
  }
});

export default router;
