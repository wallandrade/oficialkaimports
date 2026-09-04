import crypto from "crypto";
import { db, orderShipmentsTable, ordersTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import type { EnvioEcomShipmentPatch } from "./envioecom-order";
import {
  grantInsuranceCashbackIfEligible,
} from "./customer-wallet";
import { allocateOrderLogistics, completeOrderLogistics } from "./order-logistics";
import {
  isEnvioEcomCancelledStatus,
  isLabelBlockedStatus,
  isProvisionalBarcode,
  isUsableLabelBarcode,
  mergeEnvioEcomHistory,
  shouldMarkEnviadoFromStatus,
} from "./envioecom-status";
import { shipmentEventMatchesOrder } from "./envioecom-order-ref";
import {
  allPackagesDelivered,
  allPackagesEnviado,
  allPackagesLabelReady,
  allPackagesReserved,
  isSplitShipments,
  leastAdvancedShipmentStatus,
  mapOrderShipmentPackage,
  parseOrderShipmentItems,
  pickInheritPackageIndex,
  rollupParentLabelUrl,
  validateOrderShipmentAllocation,
  type OrderShipmentAllocationInput,
} from "./order-shipments-logic";
import {
  debitPackageInventory,
  OrderEnviadoError,
  reverseOrderInventoryForSplit,
} from "./order-enviado";
import { parseKaInventoryExitPool, parseKaInventoryExitedPools } from "./yury-inventory";
import { DEFAULT_TENANT_ID } from "./tenant-context";

export class OrderShipmentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OrderShipmentError";
    this.code = code;
  }
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function chooseBarcode(current: string | null | undefined, incoming: string | null | undefined): string | null {
  const next = String(incoming || "").trim() || null;
  const prev = String(current || "").trim() || null;
  if (next && isUsableLabelBarcode(next)) return next;
  if (prev && isUsableLabelBarcode(prev) && isProvisionalBarcode(next)) return prev;
  return next || prev;
}

function randomShipmentId(): string {
  return `osh_${crypto.randomBytes(10).toString("hex")}`;
}

export async function listOrderShipments(orderId: string) {
  return db
    .select()
    .from(orderShipmentsTable)
    .where(eq(orderShipmentsTable.orderId, orderId))
    .orderBy(orderShipmentsTable.createdAt);
}

export async function listOrderShipmentsByOrderIds(orderIds: string[]) {
  const ids = [...new Set(orderIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const map = new Map<string, ReturnType<typeof mapOrderShipmentPackage>[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select()
    .from(orderShipmentsTable)
    .where(inArray(orderShipmentsTable.orderId, ids));
  for (const row of rows) {
    const list = map.get(row.orderId) || [];
    list.push(mapOrderShipmentPackage(row));
    map.set(row.orderId, list);
  }
  return map;
}

export async function loadOrderShipment(packageId: string) {
  const id = String(packageId || "").trim();
  if (!id) return null;
  const rows = await db.select().from(orderShipmentsTable).where(eq(orderShipmentsTable.id, id)).limit(1);
  return rows[0] || null;
}

export function mappedPackagesForOrder(
  packages: Array<typeof orderShipmentsTable.$inferSelect>,
  options?: { light?: boolean },
) {
  return packages.map((row) => mapOrderShipmentPackage(row, options));
}

export async function rollupOrderFromPackages(
  order: typeof ordersTable.$inferSelect,
  packages?: Array<typeof orderShipmentsTable.$inferSelect>,
): Promise<typeof ordersTable.$inferSelect> {
  const rows = packages || await listOrderShipments(order.id);
  if (!isSplitShipments(rows)) return order;

  const now = new Date();
  const enviado = allPackagesEnviado(rows);
  const inventoryReserved = allPackagesReserved(rows);
  const labelUrl = rollupParentLabelUrl(rows);
  const status = leastAdvancedShipmentStatus(rows);
  const firstWithBarcode = rows.find((row) => String(row.envioecomBarcode || "").trim());
  const trackingCode = labelUrl || firstWithBarcode
    ? (firstWithBarcode?.envioecomBarcode || order.trackingCode || null)
    : (order.trackingCode && rows.some((row) => row.envioecomBarcode === order.trackingCode)
      ? order.trackingCode
      : null);

  const updates: Partial<typeof ordersTable.$inferInsert> = {
    enviado,
    inventoryReserved,
    envioecomStatus: status,
    envioecomLabelUrl: labelUrl,
    trackingLabelUrl: labelUrl,
    updatedAt: now,
  };
  if (status) updates.envioecomStatusUpdatedAt = now;
  if (firstWithBarcode?.envioecomBarcode) {
    updates.envioecomBarcode = firstWithBarcode.envioecomBarcode;
    updates.trackingCode = firstWithBarcode.envioecomBarcode;
  } else if (!trackingCode) {
    updates.envioecomBarcode = null;
  }
  if (enviado && !order.enviado) {
    updates.enviado = true;
  }

  await db.update(ordersTable).set(updates).where(eq(ordersTable.id, order.id));

  const tenantId = order.tenantId || DEFAULT_TENANT_ID;
  if (allPackagesLabelReady(rows) || enviado) {
    try {
      await completeOrderLogistics(order.id, tenantId);
    } catch (err) {
      console.warn("[OrderShipments] Falha ao liberar vaga de expedição:", err);
    }
  } else if (!enviado && rows.every((row) => isLabelBlockedStatus(row.envioecomStatus) || !row.envioecomShipmentId)) {
    try {
      await allocateOrderLogistics(order.id, true);
    } catch (err) {
      console.warn("[OrderShipments] Falha ao devolver pedido à fila:", err);
    }
  }

  if (allPackagesDelivered(rows) && order.status !== "cancelled" && order.status !== "completed") {
    await db.update(ordersTable).set({ status: "completed", updatedAt: now }).where(eq(ordersTable.id, order.id));
    try {
      await grantInsuranceCashbackIfEligible({ ...order, status: "completed" });
    } catch (err) {
      console.warn("[OrderShipments] Falha ao creditar cashback do seguro:", err);
    }
  }

  const refreshed = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id)).limit(1);
  return refreshed[0] || order;
}

export async function persistEnvioEcomPackage(
  order: typeof ordersTable.$inferSelect,
  pkg: typeof orderShipmentsTable.$inferSelect,
  patch: EnvioEcomShipmentPatch,
): Promise<{ order: typeof ordersTable.$inferSelect; pkg: typeof orderShipmentsTable.$inferSelect }> {
  const now = new Date();
  const status = pickString(patch.status) || pkg.envioecomStatus;
  if (isEnvioEcomCancelledStatus(status)) {
    return detachEnvioEcomPackage(order, pkg, status);
  }
  const barcode = chooseBarcode(pkg.envioecomBarcode, patch.barcode);
  const history = mergeEnvioEcomHistory(
    pkg.envioecomStatusHistory,
    patch.history,
    status
      ? {
          at: now.toISOString(),
          status,
          description: patch.description || null,
          barcode,
        }
      : null,
  );
  const updates: Partial<typeof orderShipmentsTable.$inferInsert> = { updatedAt: now };
  if (patch.shipmentId) updates.envioecomShipmentId = patch.shipmentId;
  if (barcode) updates.envioecomBarcode = barcode;
  if (patch.trackingKey) updates.envioecomTrackingKey = patch.trackingKey;
  if (patch.deliveryMode) updates.envioecomDeliveryMode = patch.deliveryMode;
  if (status) {
    updates.envioecomStatus = status;
    updates.envioecomStatusUpdatedAt = now;
  }
  if (history) updates.envioecomStatusHistory = history;
  if (patch.freightCost != null && String(patch.freightCost).trim()) updates.envioecomFreightCost = String(patch.freightCost);
  if (patch.externalOrderNumber) updates.envioecomExternalOrderNumber = patch.externalOrderNumber;
  if (patch.accountId) updates.envioecomAccountId = String(patch.accountId).trim().slice(0, 64);
  if (patch.labelUrl) updates.envioecomLabelUrl = patch.labelUrl;

  if (shouldMarkEnviadoFromStatus(status)) {
    const pool = parseKaInventoryExitPool(pkg.inventoryPool) || "loja";
    try {
      await debitPackageInventory({
        orderId: order.id,
        tenantId: order.tenantId || DEFAULT_TENANT_ID,
        packageId: pkg.id,
        pool,
        items: parseOrderShipmentItems(pkg.items),
        clientName: order.clientName || null,
      });
      updates.enviado = true;
      updates.inventoryReserved = true;
    } catch (err) {
      console.warn("[OrderShipments] Falha ao baixar estoque do pacote:", err);
    }
  }

  await db.update(orderShipmentsTable).set(updates).where(eq(orderShipmentsTable.id, pkg.id));
  const refreshedPkg = (await db.select().from(orderShipmentsTable).where(eq(orderShipmentsTable.id, pkg.id)).limit(1))[0] || pkg;
  const refreshedOrder = await rollupOrderFromPackages(order);
  return { order: refreshedOrder, pkg: refreshedPkg };
}

export async function detachEnvioEcomPackage(
  order: typeof ordersTable.$inferSelect,
  pkg: typeof orderShipmentsTable.$inferSelect,
  status?: string | null,
): Promise<{ order: typeof ordersTable.$inferSelect; pkg: typeof orderShipmentsTable.$inferSelect }> {
  const now = new Date();
  const requested = pickString(status) || pickString(pkg.envioecomStatus);
  const nextStatus = isEnvioEcomCancelledStatus(requested) ? requested! : "Aguardando cancelamento";
  const barcode = pickString(pkg.envioecomBarcode);
  const history = mergeEnvioEcomHistory(
    pkg.envioecomStatusHistory,
    null,
    {
      at: now.toISOString(),
      status: nextStatus,
      description: [
        pkg.envioecomShipmentId ? `shipment_id:${pkg.envioecomShipmentId}` : "",
        pkg.envioecomExternalOrderNumber ? `orderId:${pkg.envioecomExternalOrderNumber}` : "",
        "Envio desvinculado para permitir etiqueta nova",
      ].filter(Boolean).join(" "),
      barcode,
    },
  );
  await db.update(orderShipmentsTable).set({
    envioecomShipmentId: null,
    envioecomBarcode: null,
    envioecomTrackingKey: null,
    envioecomExternalOrderNumber: null,
    envioecomLabelUrl: null,
    envioecomDeliveryMode: null,
    envioecomFreightCost: null,
    envioecomStatus: nextStatus,
    envioecomStatusUpdatedAt: now,
    envioecomStatusHistory: history,
    updatedAt: now,
  }).where(eq(orderShipmentsTable.id, pkg.id));
  const refreshedPkg = (await db.select().from(orderShipmentsTable).where(eq(orderShipmentsTable.id, pkg.id)).limit(1))[0] || pkg;
  const refreshedOrder = await rollupOrderFromPackages(order);
  return { order: refreshedOrder, pkg: refreshedPkg };
}

function copyOrderShipmentBinding(order: typeof ordersTable.$inferSelect) {
  return {
    envioecomShipmentId: order.envioecomShipmentId,
    envioecomBarcode: order.envioecomBarcode,
    envioecomTrackingKey: order.envioecomTrackingKey,
    envioecomDeliveryMode: order.envioecomDeliveryMode,
    envioecomStatus: order.envioecomStatus,
    envioecomStatusUpdatedAt: order.envioecomStatusUpdatedAt,
    envioecomStatusHistory: order.envioecomStatusHistory,
    envioecomLabelUrl: order.envioecomLabelUrl,
    envioecomFreightCost: order.envioecomFreightCost,
    envioecomExternalOrderNumber: order.envioecomExternalOrderNumber,
    envioecomAccountId: order.envioecomAccountId,
  };
}

export async function allocateOrderShipments(input: {
  order: typeof ordersTable.$inferSelect;
  packages: OrderShipmentAllocationInput[];
}): Promise<{ order: typeof ordersTable.$inferSelect; packages: Array<typeof orderShipmentsTable.$inferSelect> }> {
  const validated = validateOrderShipmentAllocation(input.order.products, input.packages);
  if (!validated.ok) {
    throw new OrderShipmentError(validated.error.code, validated.error.message);
  }
  if (input.order.enviado) {
    throw new OrderShipmentError("ALREADY_SHIPPED", "Pedido já enviado. Não dá para dividir depois da postagem.");
  }

  const existing = await listOrderShipments(input.order.id);
  if (existing.some((row) => row.enviado || shouldMarkEnviadoFromStatus(row.envioecomStatus))) {
    throw new OrderShipmentError("SPLIT_LOCKED", "Já existe pacote postado neste pedido. Não dá para realocar.");
  }

  const exited = parseKaInventoryExitedPools((input.order as { inventoryExitedPools?: unknown }).inventoryExitedPools);
  if (exited.length > 0 || input.order.inventoryReserved) {
    try {
      await reverseOrderInventoryForSplit({
        orderId: input.order.id,
        tenantId: input.order.tenantId || DEFAULT_TENANT_ID,
        clientName: input.order.clientName,
        products: input.order.products,
        inventoryExitedPools: (input.order as { inventoryExitedPools?: unknown }).inventoryExitedPools,
      });
    } catch (err) {
      if (err instanceof OrderEnviadoError) {
        throw new OrderShipmentError(err.code, err.message);
      }
      throw err;
    }
  }

  const inheritIndex = pickInheritPackageIndex(
    validated.packages,
    (input.order as { inventoryExitPool?: string | null }).inventoryExitPool,
  );
  const hasBoundShipment = Boolean(
    input.order.envioecomShipmentId
    || input.order.envioecomBarcode
    || input.order.envioecomExternalOrderNumber,
  );

  if (existing.length > 0) {
    await db.delete(orderShipmentsTable).where(eq(orderShipmentsTable.orderId, input.order.id));
  }

  const now = new Date();
  const inserted: Array<typeof orderShipmentsTable.$inferSelect> = [];
  for (const [index, allocation] of validated.packages.entries()) {
    const inherit = hasBoundShipment && index === inheritIndex;
    const id = randomShipmentId();
    await db.insert(orderShipmentsTable).values({
      id,
      orderId: input.order.id,
      tenantId: input.order.tenantId || DEFAULT_TENANT_ID,
      inventoryPool: allocation.pool,
      items: allocation.items,
      enviado: false,
      inventoryReserved: false,
      ...(inherit ? copyOrderShipmentBinding(input.order) : {}),
      createdAt: now,
      updatedAt: now,
    });
    const row = (await db.select().from(orderShipmentsTable).where(eq(orderShipmentsTable.id, id)).limit(1))[0];
    if (row) inserted.push(row);
  }

  const order = await rollupOrderFromPackages(input.order, inserted);
  return { order, packages: inserted };
}

export async function findPackageForEnvioEcomWebhook(input: {
  barcode?: string | null;
  externalOrderNumber?: string | null;
  shipmentId?: number | null;
}): Promise<{ order: typeof ordersTable.$inferSelect; pkg: typeof orderShipmentsTable.$inferSelect } | null> {
  const barcode = String(input.barcode || "").trim();
  const external = String(input.externalOrderNumber || "").trim();
  const shipmentId = Number(input.shipmentId);

  async function matchRow(row: typeof orderShipmentsTable.$inferSelect | undefined) {
    if (!row) return null;
    if (!shipmentEventMatchesOrder({
      envioecomShipmentId: row.envioecomShipmentId,
      envioecomBarcode: row.envioecomBarcode,
      trackingCode: row.envioecomBarcode,
      envioecomExternalOrderNumber: row.envioecomExternalOrderNumber,
    }, input)) return null;
    const orders = await db.select().from(ordersTable).where(eq(ordersTable.id, row.orderId)).limit(1);
    if (!orders[0]) return null;
    return { order: orders[0], pkg: row };
  }

  if (barcode) {
    const byBarcode = await db
      .select()
      .from(orderShipmentsTable)
      .where(eq(orderShipmentsTable.envioecomBarcode, barcode))
      .orderBy(desc(orderShipmentsTable.updatedAt))
      .limit(1);
    const matched = await matchRow(byBarcode[0]);
    if (matched) return matched;
  }
  if (external) {
    const byExternal = await db
      .select()
      .from(orderShipmentsTable)
      .where(eq(orderShipmentsTable.envioecomExternalOrderNumber, external))
      .limit(1);
    const matched = await matchRow(byExternal[0]);
    if (matched) return matched;
  }
  if (Number.isFinite(shipmentId) && shipmentId > 0) {
    const byId = await db
      .select()
      .from(orderShipmentsTable)
      .where(eq(orderShipmentsTable.envioecomShipmentId, shipmentId))
      .limit(1);
    const matched = await matchRow(byId[0]);
    if (matched) return matched;
  }
  return null;
}

export function requirePackageId(isSplit: boolean, packageId: string | null | undefined): string | null {
  const id = String(packageId || "").trim();
  if (isSplit && !id) {
    throw new OrderShipmentError("NEED_PACKAGE_ID", "Pedido dividido: informe packageId do pacote.");
  }
  return id || null;
}

export { isSplitShipments };
