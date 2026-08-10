import crypto from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, orderLogisticsAllocationsTable, ordersTable } from "@workspace/db";
import {
  addBusinessDays,
  buildLogisticsDeadline,
  getLogisticsQueueSlot,
  getSaoPauloDate,
  isStandardShipping,
  shiftBusinessDays,
  LOGISTICS_BASE_HOURS,
  LOGISTICS_CAPACITY_STATUSES,
  LOGISTICS_DAILY_CAPACITY,
} from "./order-logistics-calendar";

export { LOGISTICS_BASE_HOURS, LOGISTICS_DAILY_CAPACITY } from "./order-logistics-calendar";
const MAX_ALLOCATION_RETRIES = 64;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type QueryExecutor = typeof db | DbTransaction;

async function compactTenantOrderLogistics(executor: QueryExecutor, tenantId: string) {
  const pending = await executor
    .select()
    .from(orderLogisticsAllocationsTable)
    .where(and(
      eq(orderLogisticsAllocationsTable.tenantId, tenantId),
      eq(orderLogisticsAllocationsTable.status, "allocated"),
    ))
    .orderBy(asc(orderLogisticsAllocationsTable.allocatedAt), asc(orderLogisticsAllocationsTable.id));

  await executor
    .update(orderLogisticsAllocationsTable)
    .set({ activeSlotKey: null })
    .where(and(
      eq(orderLogisticsAllocationsTable.tenantId, tenantId),
      eq(orderLogisticsAllocationsTable.status, "shipped"),
    ));

  await executor
    .update(orderLogisticsAllocationsTable)
    .set({ activeSlotKey: null })
    .where(and(
      eq(orderLogisticsAllocationsTable.tenantId, tenantId),
      eq(orderLogisticsAllocationsTable.status, "allocated"),
    ));

  if (pending.length === 0) return;

  for (const [queueIndex, allocation] of pending.entries()) {
    const queueSlot = getLogisticsQueueSlot(queueIndex);
    const promiseShift = Math.trunc((queueSlot.promisedHours - allocation.promisedHours) / 24);
    const dispatchDate = shiftBusinessDays(allocation.dispatchDate, promiseShift);
    await executor
      .update(orderLogisticsAllocationsTable)
      .set({
        dispatchDate,
        slotPosition: queueSlot.slotPosition,
        capacity: LOGISTICS_DAILY_CAPACITY,
        promisedHours: queueSlot.promisedHours,
        deadlineAt: buildLogisticsDeadline(dispatchDate),
        activeSlotKey: `${tenantId}|${dispatchDate}|${queueSlot.slotPosition}`,
      })
      .where(eq(orderLogisticsAllocationsTable.id, allocation.id));
  }
}

async function compactTenantOrderLogisticsInTransaction(tenantId: string): Promise<void> {
  await db.transaction(async (tx) => compactTenantOrderLogistics(tx, tenantId));
}

async function findForecast(executor: QueryExecutor, tenantId: string, now = new Date()) {
  const pending = await executor
    .select({ id: orderLogisticsAllocationsTable.id })
    .from(orderLogisticsAllocationsTable)
    .where(and(
      eq(orderLogisticsAllocationsTable.tenantId, tenantId),
      eq(orderLogisticsAllocationsTable.status, "allocated"),
    ));
  const queueSlot = getLogisticsQueueSlot(pending.length);
  const dispatchDate = addBusinessDays(getSaoPauloDate(now), 2 + queueSlot.groupIndex);
  return {
    dispatchDate,
    deadlineAt: buildLogisticsDeadline(dispatchDate),
    promisedHours: queueSlot.promisedHours,
    slotPosition: queueSlot.slotPosition,
    capacity: LOGISTICS_DAILY_CAPACITY,
    availableSlots: queueSlot.availableSlots,
  };
}

export async function getOrderLogisticsForecast(tenantId: string, now = new Date()) {
  return findForecast(db, tenantId, now);
}

function isDuplicateEntry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "ER_DUP_ENTRY") return true;
  return "cause" in error && isDuplicateEntry(error.cause);
}

export async function allocateOrderLogistics(orderId: string, compactQueue = true) {
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
          if (compactQueue) await compactTenantOrderLogistics(tx, order.tenantId || "tenant_loja1");
          const [restored] = await tx
            .select()
            .from(orderLogisticsAllocationsTable)
            .where(eq(orderLogisticsAllocationsTable.id, existing.id))
            .limit(1);
          return restored || existing;
        }

        if (order.enviado) return null;

        const tenantId = order.tenantId || "tenant_loja1";
          if (compactQueue) await compactTenantOrderLogistics(tx, tenantId);
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
  await db.transaction(async (tx) => {
    await tx.update(orderLogisticsAllocationsTable).set({
      status: "released",
      activeSlotKey: null,
      releasedAt: new Date(),
    }).where(and(
      eq(orderLogisticsAllocationsTable.orderId, orderId),
      eq(orderLogisticsAllocationsTable.tenantId, tenantId),
      inArray(orderLogisticsAllocationsTable.status, [...LOGISTICS_CAPACITY_STATUSES]),
    ));
    await compactTenantOrderLogistics(tx, tenantId);
  });
}

export async function completeOrderLogistics(orderId: string, tenantId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(orderLogisticsAllocationsTable).set({
      status: "shipped",
      activeSlotKey: null,
    }).where(and(
      eq(orderLogisticsAllocationsTable.orderId, orderId),
      eq(orderLogisticsAllocationsTable.tenantId, tenantId),
      eq(orderLogisticsAllocationsTable.status, "allocated"),
    ));
    await compactTenantOrderLogistics(tx, tenantId);
  });
}

export async function reconcilePendingOrderLogistics(): Promise<void> {
  const activeAllocations = await db
    .select({ tenantId: orderLogisticsAllocationsTable.tenantId })
    .from(orderLogisticsAllocationsTable)
    .where(eq(orderLogisticsAllocationsTable.status, "allocated"));
  const tenantIds = new Set(activeAllocations.map((allocation) => allocation.tenantId));
  for (const tenantId of tenantIds) await compactTenantOrderLogisticsInTransaction(tenantId);

  const paidOrders = await db
    .select({ id: ordersTable.id, shippingType: ordersTable.shippingType })
    .from(ordersTable)
    .where(and(
      inArray(ordersTable.status, ["paid", "completed"]),
      eq(ordersTable.enviado, false),
    ))
    .orderBy(asc(ordersTable.createdAt));

  let allocated = 0;
  const tenantsWithNewAllocations = new Set<string>();
  for (const order of paidOrders) {
    if (!isStandardShipping(order.shippingType)) continue;
    const result = await allocateOrderLogistics(order.id, false);
    if (result) {
      allocated += 1;
      tenantsWithNewAllocations.add(result.tenantId);
    }
  }
  for (const tenantId of tenantsWithNewAllocations) await compactTenantOrderLogisticsInTransaction(tenantId);
  console.log(`[OrderLogistics] Compacted ${tenantIds.size} tenant queue(s) and reconciled ${allocated} paid standard-shipping order(s).`);
}