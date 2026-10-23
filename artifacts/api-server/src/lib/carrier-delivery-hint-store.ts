import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, orderShipmentsTable, ordersTable } from "@workspace/db";
import { foldPlace, stateCode } from "./carrier-loss";
import {
  collectDeliveryHits,
  deliveryHintForCarrier,
  type CarrierDeliverySource,
} from "./carrier-delivery-hint";
import { DEFAULT_TENANT_ID } from "./tenant-context";

function orderTenantWhere(tenantId: string | null | undefined) {
  const tenant = String(tenantId || "").trim() || DEFAULT_TENANT_ID;
  if (tenant === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenant), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenant);
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function packageCounts(orderIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const unique = [...new Set(orderIds.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 400) {
    const batch = unique.slice(index, index + 400);
    if (!batch.length) continue;
    const rows = await db
      .select({
        orderId: orderShipmentsTable.orderId,
        total: sql<number>`count(*)`,
      })
      .from(orderShipmentsTable)
      .where(inArray(orderShipmentsTable.orderId, batch))
      .groupBy(orderShipmentsTable.orderId);
    for (const row of rows) counts.set(row.orderId, Number(row.total) || 0);
  }
  return counts;
}

export async function attachDeliveryHints<T extends Record<string, unknown>>(
  tenantId: string | null | undefined,
  excludeOrderId: string,
  destination: { city?: string | null; state?: string | null },
  quotes: T[],
): Promise<Array<T & { deliveryHint: { message: string } | null }>> {
  const city = foldPlace(destination.city);
  const state = stateCode(destination.state);
  if (!city || !state) {
    return quotes.map((quote) => ({ ...quote, deliveryHint: null }));
  }
  const skipId = String(excludeOrderId || "").trim() || "__none__";
  const place = () => and(
    orderTenantWhere(tenantId),
    sql`upper(trim(${ordersTable.addressState})) = ${state}`,
    ne(ordersTable.id, skipId),
  );
  const [orderRows, packageRows] = await Promise.all([
    db.select({
      orderId: ordersTable.id,
      carrierName: ordersTable.envioecomDeliveryMode,
      status: ordersTable.envioecomStatus,
      statusUpdatedAt: ordersTable.envioecomStatusUpdatedAt,
      updatedAt: ordersTable.updatedAt,
      orderNumber: ordersTable.orderNumber,
      cityName: ordersTable.addressCity,
      state: ordersTable.addressState,
    }).from(ordersTable).where(and(
      place(),
      deliveredStatusSql(ordersTable.envioecomStatus),
    )),
    db.select({
      orderId: orderShipmentsTable.orderId,
      carrierName: orderShipmentsTable.envioecomDeliveryMode,
      status: orderShipmentsTable.envioecomStatus,
      statusUpdatedAt: orderShipmentsTable.envioecomStatusUpdatedAt,
      updatedAt: orderShipmentsTable.updatedAt,
      orderNumber: ordersTable.orderNumber,
      cityName: ordersTable.addressCity,
      state: ordersTable.addressState,
    }).from(orderShipmentsTable).innerJoin(
      ordersTable,
      eq(orderShipmentsTable.orderId, ordersTable.id),
    ).where(and(
      place(),
      deliveredStatusSql(orderShipmentsTable.envioecomStatus),
    )),
  ]);
  const counts = await packageCounts([
    ...orderRows.map((row) => row.orderId),
    ...packageRows.map((row) => row.orderId),
  ]);
  const sources: CarrierDeliverySource[] = [
    ...orderRows.map((row) => toSource(row, false, counts)),
    ...packageRows.map((row) => toSource(row, true, counts)),
  ];
  const hits = collectDeliveryHits(destination, excludeOrderId, sources);
  return quotes.map((quote) => ({
    ...quote,
    deliveryHint: deliveryHintForCarrier(quote.carrier || quote.shipping_company, hits),
  }));
}

function deliveredStatusSql(status: typeof ordersTable.envioecomStatus | typeof orderShipmentsTable.envioecomStatus) {
  return sql`(
    lower(${status}) like '%entregue%'
    or lower(${status}) like '%entrega realizada%'
    or lower(${status}) like '%entrega efetuada%'
  )`;
}

function toSource(
  row: {
    orderId: string;
    carrierName: string | null;
    status: string | null;
    statusUpdatedAt: Date | null;
    updatedAt: Date;
    orderNumber: number | null;
    cityName: string | null;
    state: string | null;
  },
  fromPackage: boolean,
  counts: Map<string, number>,
): CarrierDeliverySource {
  return {
    orderId: row.orderId,
    carrierName: row.carrierName,
    status: row.status,
    deliveredAt: asDate(row.statusUpdatedAt) || asDate(row.updatedAt),
    orderNumber: row.orderNumber,
    cityName: row.cityName,
    state: row.state,
    packageCount: counts.get(row.orderId) || 0,
    fromPackage,
  };
}
