import crypto from "crypto";

function historyHasEvents(history: unknown): boolean {
  return Array.isArray(history) && history.length > 0;
}

export function buildExternalOrderNumber(order: { orderNumber?: number | null; id: string }): string {
  const prefix = order.orderNumber != null ? String(order.orderNumber) : "pedido";
  return `${prefix}-${String(order.id).slice(0, 8)}`;
}

export function buildNextExternalOrderNumber(
  order: {
    orderNumber?: number | null;
    id: string;
    envioecomShipmentId?: number | null;
    envioecomExternalOrderNumber?: string | null;
    envioecomStatusHistory?: unknown;
  },
  salt?: string,
): string {
  const current = String(order.envioecomExternalOrderNumber || "").trim();
  if (order.envioecomShipmentId && current) return current;
  const base = buildExternalOrderNumber(order);
  if (!current && !historyHasEvents(order.envioecomStatusHistory)) return base;
  const suffix = String(salt || crypto.randomBytes(3).toString("hex").slice(0, 4)).replace(/[^a-z0-9]/gi, "").slice(0, 8) || "n1";
  return `${base}-${suffix}`;
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
  const boundBarcode = String(order.envioecomBarcode || order.trackingCode || "").trim();
  const boundExternal = String(order.envioecomExternalOrderNumber || "").trim();
  if (!boundId && !boundBarcode && !boundExternal) return false;

  const eventId = Number(event.shipmentId || 0);
  const eventBarcode = String(event.barcode || "").trim();
  const eventExternal = String(event.externalOrderNumber || "").trim();

  if (boundId && eventId && boundId !== eventId) return false;
  if (boundBarcode && eventBarcode && boundBarcode !== eventBarcode) return false;
  if (boundExternal && eventExternal && boundExternal !== eventExternal) return false;

  if (boundId && eventId && boundId === eventId) return true;
  if (boundBarcode && eventBarcode && boundBarcode === eventBarcode) return true;
  if (boundExternal && eventExternal && boundExternal === eventExternal) return true;
  return false;
}
