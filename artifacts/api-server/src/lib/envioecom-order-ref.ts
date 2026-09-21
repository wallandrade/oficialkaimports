import crypto from "crypto";
import { isEnvioEcomCancelledStatus, isLabelBlockedStatus } from "./envioecom-status";

export type EnvioEcomBindingFields = {
  envioecomShipmentId?: number | null;
  envioecomBarcode?: string | null;
  envioecomLabelUrl?: string | null;
  envioecomStatus?: string | null;
};

export function hasEnvioEcomShipmentBinding(bound: EnvioEcomBindingFields): boolean {
  return Boolean(
    Number(bound.envioecomShipmentId) > 0
    || String(bound.envioecomBarcode || "").trim()
    || String(bound.envioecomLabelUrl || "").trim()
    || String(bound.envioecomStatus || "").trim()
  );
}

/** ID, barcode, PDF ou status que não seja cancelado — create recusa com SHIPMENT_EXISTS. */
export function hasActiveEnvioEcomShipmentBinding(bound: EnvioEcomBindingFields): boolean {
  if (Number(bound.envioecomShipmentId) > 0) return true;
  if (String(bound.envioecomBarcode || "").trim()) return true;
  if (String(bound.envioecomLabelUrl || "").trim()) return true;
  const status = String(bound.envioecomStatus || "").trim();
  return Boolean(status) && !isLabelBlockedStatus(status);
}

export function buildExternalOrderNumber(order: { orderNumber?: number | null; id: string }): string {
  const prefix = order.orderNumber != null ? String(order.orderNumber) : "pedido";
  return `${prefix}-${String(order.id).slice(0, 8)}`;
}

/** orderId na EnvioEcom: estável no 1º create; sufixo novo depois de cancelar/desvincular (evita DUPLICATE_ORDER). */
export function nextEnvioEcomExternalOrderNumber(
  input: {
    base: string;
    shipmentId?: number | null;
    barcode?: string | null;
    prev?: string | null;
    status?: string | null;
  },
  salt?: string,
): string {
  const prev = String(input.prev || "").trim();
  const unlinked = !(Number(input.shipmentId) > 0) && !String(input.barcode || "").trim();
  const rotate = isEnvioEcomCancelledStatus(input.status) || (unlinked && Boolean(prev));
  if (!rotate) return prev || input.base;
  const suffix = String(salt || crypto.randomBytes(3).toString("hex").slice(0, 4)).replace(/[^a-z0-9]/gi, "").slice(0, 8) || "n1";
  return `${input.base}-${suffix}`.slice(0, 64);
}

export function buildNextExternalOrderNumber(
  order: {
    orderNumber?: number | null;
    id: string;
    envioecomShipmentId?: number | null;
    envioecomBarcode?: string | null;
    envioecomExternalOrderNumber?: string | null;
    envioecomStatus?: string | null;
  },
  salt?: string,
): string {
  return nextEnvioEcomExternalOrderNumber({
    base: buildExternalOrderNumber(order),
    shipmentId: order.envioecomShipmentId,
    barcode: order.envioecomBarcode,
    prev: order.envioecomExternalOrderNumber,
    status: order.envioecomStatus,
  }, salt);
}

export function isDuplicateOrderIdError(err: { code?: string; message?: string } | null | undefined): boolean {
  const text = `${err?.code || ""} ${err?.message || ""}`.toLowerCase();
  return text.includes("duplicate_order") || (text.includes("duplicate") && text.includes("order"));
}

export function shipmentEventMatchesOrder(
  order: {
    envioecomShipmentId?: number | null;
    envioecomBarcode?: string | null;
    trackingCode?: string | null;
    envioecomExternalOrderNumber?: string | null;
  },
  event: {
    barcode?: string | null;
    shipmentId?: number | null;
    externalOrderNumber?: string | null;
  },
): boolean {
  const boundId = Number(order.envioecomShipmentId || 0);
  const boundBarcode = String(order.envioecomBarcode || "").trim() || String(order.trackingCode || "").trim();
  if (!boundId && !String(order.envioecomBarcode || "").trim()) return false;

  const boundExternal = String(order.envioecomExternalOrderNumber || "").trim();
  const eventId = Number(event.shipmentId || 0);
  const eventBarcode = String(event.barcode || "").trim();
  const eventExternal = String(event.externalOrderNumber || "").trim();

  if (boundId && eventId && boundId !== eventId) return false;
  if (boundBarcode && eventBarcode && boundBarcode !== eventBarcode) return false;
  if (boundExternal && eventExternal && boundExternal !== eventExternal) return false;

  if (boundId && eventId && boundId === eventId) return true;
  if (boundBarcode && eventBarcode && boundBarcode === eventBarcode) return true;
  return false;
}
