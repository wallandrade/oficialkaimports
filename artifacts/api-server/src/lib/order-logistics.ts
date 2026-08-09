import crypto from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, orderLogisticsAllocationsTable, ordersTable } from "@workspace/db";
import {
  addBusinessDays,
  buildLogisticsDeadline,
  getSaoPauloDate,
  isStandardShipping,
  LOGISTICS_BASE_HOURS,
  LOGISTICS_CAPACITY_STATUSES,
  LOGISTICS_DAILY_CAPACITY,
} from "./order-logistics-calendar";

export { LOGISTICS_BASE_HOURS, LOGISTICS_DAILY_CAPACITY } from "./order-logistics-calendar";
const MAX_ALLOCATION_RETRIES = 64;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type QueryExecutor = typeof db | DbTransaction;

async function findForecast(executor: QueryExecutor, tenantId: string, now = new Date()) {
  const firstDispatchDate = addBusinessDays(getSaoPauloDate(now), 2);

  for (let dayOffset = 0; dayOffset < 366; dayOffset += 1) {
    const dispatchDate = addBusinessDays(firstDispatchDate, dayOffset);
    const occupied = await executor
      .select({ slotPosition: orderLogisticsAllocationsTable.slotPosition })
      .from(orderLogisticsAllocationsTable)
      .where(and(
        eq(orderLogisticsAllocationsTable.tenantId, tenantId),
        eq(orderLogisticsAllocationsTable.dispatchDate, dispatchDate),
        inArray(orderLogisticsAllocationsTable.status, [...LOGISTICS_CAPACITY_STATUSES]),
      ));
    const occupiedPositions = new Set(occupied.map((row) => row.slotPosition));
    const slotPosition = Array.from({ length: LOGISTICS_DAILY_CAPACITY }, (_, index) => index + 1)
      .find((position) => !occupiedPositions.has(position));
    if (slotPosition) {
      return {
        dispatchDate,
        deadlineAt: buildLogisticsDeadline(dispatchDate),
        promisedHours: LOGISTICS_BASE_HOURS + (dayOffset * 24),
        slotPosition,
        capacity: LOGISTICS_DAILY_CAPACITY,
        availableSlots: LOGISTICS_DAILY_CAPACITY - occupiedPositions.size,
      };
    }
  }

  throw new Error("Não foi possível encontrar uma data disponível para expedição.");
}

export async function getOrderLogisticsForecast(tenantId: string, now = new Date()) {
  return findForecast(db, tenantId, now);
}

function isDuplicateEntry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "ER_DUP_ENTRY") return true;
  return "cause" in error && isDuplicateEntry(error.cause);
}

export async function allocateOrderLogistics(orderId: string) {
  for (let attempt = 0; attempt < MAX_ALLOCATION_RETRIES; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(orderLogisticsAllocationsTable)
          .where(eq(orderLogisticsAllocationsTable.orderId, orderId))
          .limit(1);
        if (existing?.status === "allocated") return existing;

        const [order] = await tx
          .select({ tenantId: ordersTable.tenantId, shippingType: ordersTable.shippingType, status: ordersTable.status, enviado: ordersTable.enviado })
          .from(ordersTable)
          .where(eq(ordersTable.id, orderId))
          .limit(1);
        if (!order || !["paid", "completed"].includes(order.status) || !isStandardShipping(order.shippingType)) return null;

        if (existing?.status === "shipped") {
          if (order.enviado) return existing;
          await tx.update(orderLogisticsAllocationsTable).set({
            status: "allocated",
          }).where(eq(orderLogisticsAllocationsTable.id, existing.id));
          const [restored] = await tx
            .select()
            .from(orderLogisticsAllocationsTable)
            .where(eq(orderLogisticsAllocationsTable.id, existing.id))
            .limit(1);
          return restored || existing;
        }

        if (order.enviado) return null;

        const tenantId = order.tenantId || "tenant_loja1";
        const forecast = await findForecast(tx, tenantId);
        const activeSlotKey = `${tenantId}|${forecast.dispatchDate}|${forecast.slotPosition}`;

        if (existing) {
          await tx.update(orderLogisticsAllocationsTable).set({
            tenantId,
            dispatchDate: forecast.dispatchDate,
            slotPosition: forecast.slotPosition,
            capacity: forecast.capacity,
            promisedHours: forecast.promisedHours,
            deadlineAt: forecast.deadlineAt,
            status: "allocated",
            activeSlotKey,
            allocatedAt: new Date(),
            releasedAt: null,
          }).where(eq(orderLogisticsAllocationsTable.id, existing.id));
        } else {
          await tx.insert(orderLogisticsAllocationsTable).values({
            id: crypto.randomBytes(16).toString("hex"),
            tenantId,
            orderId,
            dispatchDate: forecast.dispatchDate,
            slotPosition: forecast.slotPosition,
            capacity: forecast.capacity,
            promisedHours: forecast.promisedHours,
            deadlineAt: forecast.deadlineAt,
            status: "allocated",
            activeSlotKey,
          });
        }

        const [allocation] = await tx
          .select()
          .from(orderLogisticsAllocationsTable)
          .where(eq(orderLogisticsAllocationsTable.orderId, orderId))
          .limit(1);
        return allocation || null;
      });
    } catch (error) {
      if (isDuplicateEntry(error)) continue;
      throw error;
    }
  }

  throw new Error("Não foi possível reservar uma vaga de expedição após várias tentativas.");
}

export async function releaseOrderLogistics(orderId: string, tenantId: string): Promise<void> {
  await db.update(orderLogisticsAllocationsTable).set({
    status: "released",
    activeSlotKey: null,
    releasedAt: new Date(),
  }).where(and(
    eq(orderLogisticsAllocationsTable.orderId, orderId),
    eq(orderLogisticsAllocationsTable.tenantId, tenantId),
    inArray(orderLogisticsAllocationsTable.status, [...LOGISTICS_CAPACITY_STATUSES]),
  ));
}

export async function completeOrderLogistics(orderId: string, tenantId: string): Promise<void> {
  await db.update(orderLogisticsAllocationsTable).set({
    status: "shipped",
  }).where(and(
    eq(orderLogisticsAllocationsTable.orderId, orderId),
    eq(orderLogisticsAllocationsTable.tenantId, tenantId),
    eq(orderLogisticsAllocationsTable.status, "allocated"),
  ));
}

export async function reconcilePendingOrderLogistics(): Promise<void> {
  const paidOrders = await db
    .select({ id: ordersTable.id, shippingType: ordersTable.shippingType })
    .from(ordersTable)
    .where(and(
      inArray(ordersTable.status, ["paid", "completed"]),
      eq(ordersTable.enviado, false),
    ))
    .orderBy(asc(ordersTable.createdAt));

  let allocated = 0;
  for (const order of paidOrders) {
    if (!isStandardShipping(order.shippingType)) continue;
    const result = await allocateOrderLogistics(order.id);
    if (result) allocated += 1;
  }
  console.log(`[OrderLogistics] Reconciled ${allocated} paid standard-shipping order(s).`);
}