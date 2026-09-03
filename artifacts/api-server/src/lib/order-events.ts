import crypto from "crypto";
import { db, orderEventsTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import type { Request } from "express";
import {
  mapOrderEventRow,
  type OrderEventActorType,
  type OrderEventRecord,
} from "./order-events-core";

export {
  actionFromStatusChange,
  buildOrderEditPayload,
  mapOrderEventRow,
  type OrderEventActorType,
  type OrderEventRecord,
} from "./order-events-core";

export type AddOrderEventInput = {
  orderId: string;
  tenantId?: string | null;
  action: string;
  actorType?: OrderEventActorType;
  actorUsername?: string | null;
  payload?: Record<string, unknown> | null;
};

function randomId(): string {
  return `oev_${crypto.randomBytes(8).toString("hex")}`;
}

export function actorFromAdminRequest(req: Request): {
  actorType: "admin";
  actorUsername: string | null;
} {
  const username = String((req as { adminSession?: { username?: string } }).adminSession?.username || "").trim();
  return { actorType: "admin", actorUsername: username || null };
}

export async function addOrderEvent(params: AddOrderEventInput): Promise<void> {
  const orderId = String(params.orderId || "").trim();
  const action = String(params.action || "").trim();
  if (!orderId || !action) return;
  try {
    await db.insert(orderEventsTable).values({
      id: randomId(),
      orderId,
      tenantId: String(params.tenantId || "").trim() || null,
      action,
      actorType: params.actorType || "admin",
      actorUsername: String(params.actorUsername || "").trim() || null,
      payload: params.payload || null,
      createdAt: new Date(),
    });
  } catch (err) {
    console.warn("[OrderEvents] Falha ao gravar evento", { orderId, action, err });
  }
}

export async function listOrderEvents(orderId: string): Promise<OrderEventRecord[]> {
  const id = String(orderId || "").trim();
  if (!id) return [];
  const rows = await db
    .select()
    .from(orderEventsTable)
    .where(eq(orderEventsTable.orderId, id))
    .orderBy(desc(orderEventsTable.createdAt));
  return rows.map(mapOrderEventRow);
}

export async function listOrderEventsByOrderIds(orderIds: string[]): Promise<Map<string, OrderEventRecord[]>> {
  const ids = Array.from(new Set(orderIds.map((id) => String(id || "").trim()).filter(Boolean)));
  const result = new Map<string, OrderEventRecord[]>();
  if (ids.length === 0) return result;
  const rows = await db
    .select()
    .from(orderEventsTable)
    .where(inArray(orderEventsTable.orderId, ids))
    .orderBy(desc(orderEventsTable.createdAt));
  for (const row of rows) {
    const mapped = mapOrderEventRow(row);
    const list = result.get(mapped.orderId) || [];
    list.push(mapped);
    result.set(mapped.orderId, list);
  }
  return result;
}
