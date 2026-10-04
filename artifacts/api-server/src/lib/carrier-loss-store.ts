import crypto from "crypto";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { carrierLossIncidentsTable, db, orderShipmentsTable, ordersTable } from "@workspace/db";
import {
  CARRIER_LOSS_WINDOW_MS,
  carrierDisplayName,
  carrierKey,
  cepDigits,
  classifyCarrierLoss,
  foldPlace,
  lossAlertForCarrier,
  lossRegionKey,
  nextOccurredAt,
  stateCode,
  type CarrierLossAlertIncident,
  type CarrierLossPhrase,
  type CarrierLossType,
} from "./carrier-loss";
import { trackingEventsNewestFirst, type EnvioEcomHistoryEvent } from "./envioecom-status";
import { DEFAULT_TENANT_ID } from "./tenant-context";

const LOSS_BOARD_LIMIT = 500;

export type CarrierLossWriteResult = "created" | "updated" | "reopened" | "skipped";

type LossRow = typeof carrierLossIncidentsTable.$inferSelect;

export function lossPackageId(packageId: string | null | undefined): string {
  return String(packageId || "").trim();
}

function tenantKey(tenantId: string | null | undefined): string {
  return String(tenantId || "").trim() || DEFAULT_TENANT_ID;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDuplicateKey(err: unknown): boolean {
  const sources = [err, (err as { cause?: unknown } | null)?.cause];
  return sources.some((item) => {
    const row = item as { code?: string; errno?: number } | null;
    return row?.code === "ER_DUP_ENTRY" || row?.errno === 1062;
  });
}

async function findLossRow(orderId: string, packageId: string): Promise<LossRow | null> {
  const rows = await db
    .select()
    .from(carrierLossIncidentsTable)
    .where(and(
      eq(carrierLossIncidentsTable.orderId, orderId),
      eq(carrierLossIncidentsTable.packageId, packageId),
    ))
    .limit(1);
  return rows[0] || null;
}

export async function upsertCarrierLoss(input: {
  orderId: string;
  packageId?: string | null;
  tenantId?: string | null;
  carrierRaw: string;
  cityName?: string | null;
  state?: string | null;
  neighborhoodName?: string | null;
  cep?: string | null;
  incidentType: CarrierLossType;
  source: "envioecom" | "manual";
  rawStatus?: string | null;
  orderNumber?: number | null;
}): Promise<CarrierLossWriteResult> {
  const orderId = String(input.orderId || "").trim();
  const packageId = lossPackageId(input.packageId);
  const carrierName = carrierDisplayName(input.carrierRaw);
  const key = carrierKey(input.carrierRaw);
  const cityName = String(input.cityName || "").trim();
  const city = foldPlace(cityName);
  const state = stateCode(input.state);
  const cep = cepDigits(input.cep);
  const neighborhoodName = String(input.neighborhoodName || "").trim();
  if (!orderId || !key || !carrierName || !city || !state || cep.length !== 8) return "skipped";

  const now = new Date();
  const fields = {
    tenantId: tenantKey(input.tenantId),
    carrierKey: key,
    carrierName,
    cityKey: city,
    cityName,
    state,
    neighborhoodKey: foldPlace(neighborhoodName),
    neighborhoodName: neighborhoodName || null,
    cep,
    regionKey: lossRegionKey(cityName, state, cep),
    incidentType: input.incidentType,
    source: input.source,
    rawStatus: String(input.rawStatus || "").trim() || null,
    orderNumber: input.orderNumber != null && Number(input.orderNumber) > 0 ? Math.trunc(Number(input.orderNumber)) : null,
    updatedAt: now,
  };

  const existing = await findLossRow(orderId, packageId);
  if (!existing) {
    try {
      await db.insert(carrierLossIncidentsTable).values({
        id: `cli_${crypto.randomBytes(8).toString("hex")}`,
        orderId,
        packageId,
        ...fields,
        occurredAt: now,
        removedAt: null,
        createdAt: now,
      });
      return "created";
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const raced = await findLossRow(orderId, packageId);
      if (!raced) throw err;
      return updateLossRow(raced, fields, now);
    }
  }
  return updateLossRow(existing, fields, now);
}

async function updateLossRow(
  existing: LossRow,
  fields: {
    tenantId: string;
    carrierKey: string;
    carrierName: string;
    cityKey: string;
    cityName: string;
    state: string;
    neighborhoodKey: string;
    neighborhoodName: string | null;
    cep: string;
    regionKey: string;
    incidentType: string;
    source: string;
    rawStatus: string | null;
    orderNumber: number | null;
    updatedAt: Date;
  },
  now: Date,
): Promise<CarrierLossWriteResult> {
  const removedAt = asDate(existing.removedAt);
  const occurredAt = asDate(existing.occurredAt) || now;
  const reopening = removedAt != null;
  await db
    .update(carrierLossIncidentsTable)
    .set({
      ...fields,
      removedAt: null,
      occurredAt: nextOccurredAt({ removedAt, occurredAt }, now),
    })
    .where(eq(carrierLossIncidentsTable.id, existing.id));
  return reopening ? "reopened" : "updated";
}

export async function recordAutomaticCarrierLoss(input: {
  orderId: string;
  packageId?: string | null;
  tenantId?: string | null;
  orderNumber?: number | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressNeighborhood?: string | null;
  addressCep?: string | null;
  deliveryMode?: string | null;
  fallbackCarrier?: string | null;
  status?: string | null;
  description?: string | null;
  history?: CarrierLossPhrase[] | null;
}): Promise<void> {
  const classified = classifyCarrierLoss({
    status: input.status,
    description: input.description,
    history: input.history,
  });
  if (!classified) return;
  await upsertCarrierLoss({
    orderId: input.orderId,
    packageId: input.packageId,
    tenantId: input.tenantId,
    carrierRaw: String(input.deliveryMode || input.fallbackCarrier || "").trim(),
    cityName: input.addressCity,
    state: input.addressState,
    neighborhoodName: input.addressNeighborhood,
    cep: input.addressCep,
    incidentType: classified.type,
    source: "envioecom",
    rawStatus: classified.raw,
    orderNumber: input.orderNumber,
  });
}

export type CarrierLossBoardItem = {
  id: string;
  orderId: string;
  packageId: string | null;
  orderNumber: number | null;
  clientName: string | null;
  carrierName: string;
  cityName: string;
  neighborhoodName: string | null;
  state: string;
  cep: string;
  incidentType: string;
  source: string;
  rawStatus: string | null;
  occurredAt: string;
  removedAt: string | null;
  envioecomStatus: string | null;
  envioecomBarcode: string | null;
  events: EnvioEcomHistoryEvent[];
};

function isoDate(value: Date | string | null | undefined): string | null {
  const date = asDate(value);
  return date ? date.toISOString() : null;
}

export async function listCarrierLossBoard(input: {
  tenantId: string;
  q?: string | null;
  includeRemoved?: boolean;
}): Promise<{ items: CarrierLossBoardItem[]; truncated: boolean }> {
  const conditions = [eq(carrierLossIncidentsTable.tenantId, tenantKey(input.tenantId))];
  if (!input.includeRemoved) conditions.push(isNull(carrierLossIncidentsTable.removedAt));
  const rows = await db
    .select()
    .from(carrierLossIncidentsTable)
    .where(and(...conditions))
    .orderBy(desc(carrierLossIncidentsTable.occurredAt));

  const orderIds = [...new Set(rows.map((row) => row.orderId).filter(Boolean))];
  const packageIds = [...new Set(rows.map((row) => row.packageId).filter(Boolean))];
  const orders = orderIds.length
    ? await db
      .select({
        id: ordersTable.id,
        clientName: ordersTable.clientName,
        orderNumber: ordersTable.orderNumber,
        envioecomStatus: ordersTable.envioecomStatus,
        envioecomBarcode: ordersTable.envioecomBarcode,
        envioecomStatusHistory: ordersTable.envioecomStatusHistory,
      })
      .from(ordersTable)
      .where(inArray(ordersTable.id, orderIds))
    : [];
  const packages = packageIds.length
    ? await db
      .select({
        id: orderShipmentsTable.id,
        envioecomStatus: orderShipmentsTable.envioecomStatus,
        envioecomBarcode: orderShipmentsTable.envioecomBarcode,
        envioecomStatusHistory: orderShipmentsTable.envioecomStatusHistory,
      })
      .from(orderShipmentsTable)
      .where(inArray(orderShipmentsTable.id, packageIds))
    : [];
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const query = foldPlace(input.q);

  const items = rows.flatMap((row) => {
    const order = orderById.get(row.orderId);
    const pkg = row.packageId ? packageById.get(row.packageId) : null;
    const history = row.packageId ? pkg?.envioecomStatusHistory : order?.envioecomStatusHistory;
    const shipment = row.packageId ? pkg : order;
    const item: CarrierLossBoardItem = {
      id: row.id,
      orderId: row.orderId,
      packageId: row.packageId || null,
      orderNumber: row.orderNumber ?? order?.orderNumber ?? null,
      clientName: order?.clientName ?? null,
      carrierName: row.carrierName,
      cityName: row.cityName,
      neighborhoodName: row.neighborhoodName,
      state: row.state,
      cep: row.cep,
      incidentType: row.incidentType,
      source: row.source,
      rawStatus: row.rawStatus,
      occurredAt: isoDate(row.occurredAt) || new Date(0).toISOString(),
      removedAt: isoDate(row.removedAt),
      envioecomStatus: shipment?.envioecomStatus ?? null,
      envioecomBarcode: shipment?.envioecomBarcode ?? null,
      events: trackingEventsNewestFirst(history, 80),
    };
    if (!query) return [item];
    const hay = foldPlace([
      item.orderNumber,
      item.orderId,
      item.clientName,
      item.carrierName,
      item.cityName,
      item.neighborhoodName,
      item.state,
      item.cep,
      item.rawStatus,
      item.envioecomStatus,
      item.envioecomBarcode,
      item.incidentType,
    ].join(" "));
    return hay.includes(query) ? [item] : [];
  });
  const truncated = items.length > LOSS_BOARD_LIMIT;
  return { items: truncated ? items.slice(0, LOSS_BOARD_LIMIT) : items, truncated };
}

export async function getCarrierLossState(orderId: string, packageId?: string | null) {
  const row = await findLossRow(String(orderId || "").trim(), lossPackageId(packageId));
  if (!row || row.removedAt) {
    return { active: false, carrierName: null, carrierKey: null };
  }
  return { active: true, carrierName: row.carrierName, carrierKey: row.carrierKey };
}

export async function removeCarrierLoss(
  orderId: string,
  packageId?: string | null,
): Promise<{ result: "removed" | "missing" | "already"; carrierName: string | null }> {
  const row = await findLossRow(String(orderId || "").trim(), lossPackageId(packageId));
  if (!row) return { result: "missing", carrierName: null };
  if (row.removedAt) return { result: "already", carrierName: row.carrierName };
  const now = new Date();
  await db
    .update(carrierLossIncidentsTable)
    .set({ removedAt: now, updatedAt: now })
    .where(eq(carrierLossIncidentsTable.id, row.id));
  return { result: "removed", carrierName: row.carrierName };
}

export async function attachLossAlerts<T extends Record<string, unknown>>(
  tenantId: string | null | undefined,
  destination: {
    city?: string | null;
    state?: string | null;
    neighborhood?: string | null;
    cep?: string | null;
  },
  quotes: T[],
): Promise<Array<T & { lossAlert: { level: "warn" | "danger"; message: string } | null }>> {
  const cityName = String(destination.city || "").trim();
  const city = foldPlace(cityName);
  const state = stateCode(destination.state);
  const cep = cepDigits(destination.cep);
  const region = lossRegionKey(cityName, state, cep);
  if (!city || !state || cep.length !== 8) {
    return quotes.map((quote) => ({ ...quote, lossAlert: null }));
  }
  const since = new Date(Date.now() - CARRIER_LOSS_WINDOW_MS);
  const rows = await db
    .select()
    .from(carrierLossIncidentsTable)
    .where(and(
      eq(carrierLossIncidentsTable.tenantId, tenantKey(tenantId)),
      eq(carrierLossIncidentsTable.cityKey, city),
      eq(carrierLossIncidentsTable.state, state),
      isNull(carrierLossIncidentsTable.removedAt),
      gte(carrierLossIncidentsTable.occurredAt, since),
    ));
  const incidents: CarrierLossAlertIncident[] = rows
    .filter((row) => row.regionKey === region)
    .map((row) => ({
      carrierKey: row.carrierKey,
      carrierName: row.carrierName,
      neighborhoodKey: row.neighborhoodKey || "",
      neighborhoodName: row.neighborhoodName,
      regionKey: row.regionKey,
      incidentType: row.incidentType,
      orderNumber: row.orderNumber,
      occurredAt: asDate(row.occurredAt) || new Date(0),
      cityName: row.cityName,
      state: row.state,
    }));
  return quotes.map((quote) => ({
    ...quote,
    lossAlert: lossAlertForCarrier(quote.carrier || quote.shipping_company, destination.neighborhood, incidents),
  }));
}
