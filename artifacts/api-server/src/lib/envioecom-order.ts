import { db, ordersTable } from "@workspace/db";
import { desc, eq, or } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import {
  extractStatusHistoryFromShipment,
  hasEnvioEcomLabelReady,
  isLabelBlockedStatus,
  isProvisionalBarcode,
  isUsableLabelBarcode,
  mergeEnvioEcomHistory,
  shouldMarkCompletedFromStatus,
  shouldMarkEnviadoFromStatus,
  type EnvioEcomHistoryEvent,
} from "./envioecom-status";
import { allocateOrderLogistics, completeOrderLogistics } from "./order-logistics";
import { ensureOrderMarkedEnviado } from "./order-enviado";

export type EnvioEcomShipmentPatch = {
  shipmentId?: number | null;
  barcode?: string | null;
  trackingKey?: string | null;
  deliveryMode?: string | null;
  status?: string | null;
  freightCost?: string | number | null;
  externalOrderNumber?: string | null;
  labelUrl?: string | null;
  description?: string | null;
  history?: EnvioEcomHistoryEvent[] | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return null;
}

export function parseCreatedShipment(payload: unknown): EnvioEcomShipmentPatch {
  const root = asRecord(payload);
  const shippingCreate = asRecord(root.shipping_create);
  const results = Array.isArray(shippingCreate.results) ? shippingCreate.results : [];
  const first = asRecord(results[0]);
  const barcodes = Array.isArray(root.processed_barcodes) ? root.processed_barcodes : [];
  const adjustments = Array.isArray(root.freight_adjustments) ? root.freight_adjustments : [];
  const adjustment = asRecord(adjustments[0]);

  return {
    shipmentId: pickNumber(first.shipping_id, first.id, first.shipment_id),
    barcode: pickString(first.barcode, barcodes[0]),
    trackingKey: pickString(first.tracking_key, first.trackingKey),
    deliveryMode: pickString(first.delivery_mode, first.shipping_company, first.carrier),
    status: pickString(first.status),
    freightCost: pickString(adjustment.current, adjustment.freight_cost, first.freight_cost, first.cost),
    externalOrderNumber: pickString(first.orderId, first.external_order_number, first.order_id),
  };
}

export function parseShipmentDetails(payload: unknown): EnvioEcomShipmentPatch {
  const root = asRecord(payload);
  const nested = asRecord(root.data && typeof root.data === "object" ? root.data : root.shipment && typeof root.shipment === "object" ? root.shipment : root);
  const finalStatus = asRecord(nested.final_status);
  const history = extractStatusHistoryFromShipment(payload);

  return {
    shipmentId: pickNumber(nested.id, nested.shipment_id, root.shipment_id, root.id),
    barcode: pickString(nested.barcode, root.barcode),
    trackingKey: pickString(nested.tracking_key),
    deliveryMode: pickString(nested.delivery_mode, nested.shipping_company),
    status: pickString(finalStatus.status, nested.status, nested.situacao, nested.final_status, root.status),
    freightCost: pickString(nested.freight_cost),
    externalOrderNumber: pickString(nested.external_order_number, nested.orderId),
    history,
  };
}

function chooseBarcode(current: string | null | undefined, incoming: string | null | undefined): string | null {
  const next = String(incoming || "").trim() || null;
  const prev = String(current || "").trim() || null;
  if (next && isUsableLabelBarcode(next)) return next;
  if (prev && isUsableLabelBarcode(prev) && isProvisionalBarcode(next)) return prev;
  return next || prev;
}

export async function persistEnvioEcomShipment(order: typeof ordersTable.$inferSelect, patch: EnvioEcomShipmentPatch): Promise<typeof ordersTable.$inferSelect> {
  const now = new Date();
  const barcode = chooseBarcode(order.envioecomBarcode || order.trackingCode, patch.barcode);
  const status = pickString(patch.status) || order.envioecomStatus;
  const history = mergeEnvioEcomHistory(
    order.envioecomStatusHistory,
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

  const updates: Partial<typeof ordersTable.$inferInsert> = {
    updatedAt: now,
  };
  if (patch.shipmentId) updates.envioecomShipmentId = patch.shipmentId;
  if (barcode) {
    updates.envioecomBarcode = barcode;
    updates.trackingCode = barcode;
  }
  if (patch.trackingKey) updates.envioecomTrackingKey = patch.trackingKey;
  if (patch.deliveryMode) updates.envioecomDeliveryMode = patch.deliveryMode;
  if (status) {
    updates.envioecomStatus = status;
    updates.envioecomStatusUpdatedAt = now;
  }
  if (history) updates.envioecomStatusHistory = history;
  if (patch.freightCost != null && String(patch.freightCost).trim()) updates.envioecomFreightCost = String(patch.freightCost);
  if (patch.externalOrderNumber) updates.envioecomExternalOrderNumber = patch.externalOrderNumber;
  if (patch.labelUrl) {
    updates.envioecomLabelUrl = patch.labelUrl;
    updates.trackingLabelUrl = patch.labelUrl;
  }

  await db.update(ordersTable).set(updates).where(eq(ordersTable.id, order.id));

  const shouldComplete = shouldMarkCompletedFromStatus(status);
  if (shouldComplete && order.status !== "cancelled" && order.status !== "completed") {
    await db.update(ordersTable).set({ status: "completed", updatedAt: now }).where(eq(ordersTable.id, order.id));
  }

  const tenantId = order.tenantId || DEFAULT_TENANT_ID;
  const labelReady = hasEnvioEcomLabelReady({
    envioecomLabelUrl: patch.labelUrl || order.envioecomLabelUrl,
    envioecomStatus: status,
  });
  if (labelReady) {
    try {
      await completeOrderLogistics(order.id, tenantId);
    } catch (logisticsErr) {
      console.warn("[EnvioEcom] Falha ao liberar vaga de expedição:", logisticsErr);
    }
  } else if (isLabelBlockedStatus(status) && !order.enviado) {
    try {
      await allocateOrderLogistics(order.id, true);
    } catch (logisticsErr) {
      console.warn("[EnvioEcom] Falha ao devolver pedido à fila após cancelamento:", logisticsErr);
    }
  }
  if (shouldMarkEnviadoFromStatus(status)) {
    try {
      await ensureOrderMarkedEnviado(order.id, tenantId);
    } catch (err) {
      console.warn("[EnvioEcom] Falha ao marcar enviado:", err);
    }
  }

  const refreshed = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id)).limit(1);
  return refreshed[0] || order;
}

export async function findOrderForEnvioEcomWebhook(input: {
  barcode?: string | null;
  externalOrderNumber?: string | null;
  shipmentId?: number | null;
}): Promise<typeof ordersTable.$inferSelect | null> {
  const barcode = String(input.barcode || "").trim();
  const external = String(input.externalOrderNumber || "").trim();
  const shipmentId = Number(input.shipmentId);

  if (barcode) {
    const byBarcode = await db
      .select()
      .from(ordersTable)
      .where(or(eq(ordersTable.envioecomBarcode, barcode), eq(ordersTable.trackingCode, barcode)))
      .orderBy(desc(ordersTable.updatedAt))
      .limit(1);
    if (byBarcode[0]) return byBarcode[0];
  }

  if (external) {
    const byExternal = await db
      .select()
      .from(ordersTable)
      .where(or(
        eq(ordersTable.envioecomExternalOrderNumber, external),
        eq(ordersTable.id, external),
      ))
      .limit(1);
    if (byExternal[0]) return byExternal[0];

    const orderNumberMatch = external.match(/^(\d+)-/);
    if (orderNumberMatch) {
      const byNumber = await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.orderNumber, Number(orderNumberMatch[1])))
        .limit(1);
      if (byNumber[0]) return byNumber[0];
    }
  }

  if (Number.isFinite(shipmentId) && shipmentId > 0) {
    const byId = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.envioecomShipmentId, shipmentId))
      .limit(1);
    if (byId[0]) return byId[0];
  }

  return null;
}

export function buildExternalOrderNumber(order: { orderNumber?: number | null; id: string }): string {
  const prefix = order.orderNumber != null ? String(order.orderNumber) : "pedido";
  return `${prefix}-${String(order.id).slice(0, 8)}`;
}

export function digitsOnly(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function sanitizeDocument(value: unknown): string {
  const digits = digitsOnly(value);
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return String(value || "").trim();
}

export function describeEnvioEcomRecipientIssues(order: {
  clientDocument?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
}): string | null {
  const docDigits = digitsOnly(order.clientDocument);
  if ((docDigits.length !== 11 && docDigits.length !== 14) || /^0+$/.test(docDigits)) {
    return "CPF/CNPJ do pedido inválido. Edite o pedido e informe o documento correto.";
  }
  const phone = digitsOnly(order.clientPhone);
  if (phone.length < 10) {
    return "Telefone do pedido inválido. Edite o pedido e informe um telefone com DDD.";
  }
  const email = String(order.clientEmail || "").trim();
  if (!email.includes("@")) {
    return "E-mail do pedido inválido. Edite o pedido e informe o e-mail do cliente.";
  }
  return null;
}

export function sanitizeUf(value: unknown): string {
  return String(value || "").trim().toUpperCase().slice(0, 2) || "SP";
}
