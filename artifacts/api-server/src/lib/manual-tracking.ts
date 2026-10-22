import { and, eq } from "drizzle-orm";
import { db, motoboyDeliveryReservationsTable, ordersTable, orderShipmentsTable } from "@workspace/db";
import { allocateOrderLogistics, completeOrderLogistics } from "./order-logistics";
import { clearOrderManualPriority } from "./order-priority";
import { isSplitShipments, listOrderShipments, rollupOrderFromPackages } from "./order-shipments";
import { broadcastNotification } from "../routes/notifications";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import {
  decideManualTrackingUpdate,
  ManualTrackingError,
  manualTrackingKeepsEnviado,
} from "./manual-tracking-logic";

export { ManualTrackingError };

async function releasePostedOrderSideEffects(orderId: string, tenantId: string): Promise<void> {
  await completeOrderLogistics(orderId, tenantId);
  await db.delete(motoboyDeliveryReservationsTable).where(and(
    eq(motoboyDeliveryReservationsTable.orderId, orderId),
    eq(motoboyDeliveryReservationsTable.tenantId, tenantId),
  ));
  broadcastNotification({ type: "order_enviado_updated", data: { id: orderId, enviado: true, tenantId } });
}

export async function saveManualTrackingCode(input: {
  order: typeof ordersTable.$inferSelect;
  packageId?: string | null;
  rawCode: unknown;
}): Promise<{ order: typeof ordersTable.$inferSelect; packageId: string | null; code: string | null }> {
  const packages = await listOrderShipments(input.order.id);
  const split = isSplitShipments(packages);
  const requestedId = String(input.packageId || "").trim();
  const tenantId = input.order.tenantId || DEFAULT_TENANT_ID;

  if (split) {
    if (!requestedId) {
      throw new ManualTrackingError("NEED_PACKAGE_ID", "Pedido dividido: informe o pacote (Fóz, Motoboy ou Minas).");
    }
    const pkg = packages.find((row) => row.id === requestedId);
    if (!pkg) {
      throw new ManualTrackingError("PACKAGE_NOT_FOUND", "Pacote não encontrado neste pedido.");
    }
    const decision = decideManualTrackingUpdate({
      rawCode: input.rawCode,
      currentDeliveryMode: pkg.envioecomDeliveryMode,
      hasEnvioEcomLabel: manualTrackingKeepsEnviado(pkg),
    });
    if ("error" in decision) {
      throw new ManualTrackingError("INVALID_INPUT", decision.error);
    }
    const now = new Date();
    await db.update(orderShipmentsTable).set({
      manualTrackingCode: decision.code,
      enviado: decision.enviado,
      ...(decision.setCorreios ? { envioecomDeliveryMode: "Correios" } : {}),
      updatedAt: now,
    }).where(eq(orderShipmentsTable.id, pkg.id));

    const refreshed = await rollupOrderFromPackages(input.order);
    if (refreshed.enviado) await clearOrderManualPriority(input.order.id);
    if (refreshed.enviado && !input.order.enviado) {
      await releasePostedOrderSideEffects(input.order.id, tenantId);
    } else if (!refreshed.enviado && input.order.enviado) {
      try {
        await allocateOrderLogistics(input.order.id, true);
      } catch (err) {
        console.warn("[ManualTracking] Falha ao devolver pedido à fila:", err);
      }
      broadcastNotification({ type: "order_enviado_updated", data: { id: input.order.id, enviado: false, tenantId } });
    }
    return { order: refreshed, packageId: pkg.id, code: decision.code };
  }

  if (requestedId) {
    throw new ManualTrackingError("PACKAGE_NOT_FOUND", "Pacote não encontrado neste pedido.");
  }

  const decision = decideManualTrackingUpdate({
    rawCode: input.rawCode,
    currentDeliveryMode: input.order.envioecomDeliveryMode,
    hasEnvioEcomLabel: manualTrackingKeepsEnviado(input.order),
  });
  if ("error" in decision) {
    throw new ManualTrackingError("INVALID_INPUT", decision.error);
  }

  const now = new Date();
  await db.update(ordersTable).set({
    manualTrackingCode: decision.code,
    enviado: decision.enviado,
    ...(decision.setCorreios ? { envioecomDeliveryMode: "Correios" } : {}),
    updatedAt: now,
  }).where(eq(ordersTable.id, input.order.id));

  if (decision.enviado) await clearOrderManualPriority(input.order.id);
  if (decision.enviado && !input.order.enviado) {
    await releasePostedOrderSideEffects(input.order.id, tenantId);
  } else if (!decision.enviado && input.order.enviado) {
    try {
      await allocateOrderLogistics(input.order.id, true);
    } catch (err) {
      console.warn("[ManualTracking] Falha ao devolver pedido à fila:", err);
    }
    broadcastNotification({ type: "order_enviado_updated", data: { id: input.order.id, enviado: false, tenantId } });
  }

  const rows = await db.select().from(ordersTable).where(eq(ordersTable.id, input.order.id)).limit(1);
  return { order: rows[0] || input.order, packageId: null, code: decision.code };
}
