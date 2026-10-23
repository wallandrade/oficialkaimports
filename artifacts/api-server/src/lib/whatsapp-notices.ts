import {
  isProvisionalBarcode,
  isUsableLabelBarcode,
  shouldMarkCompletedFromStatus,
  shouldMarkEnviadoFromStatus,
} from "./envioecom-status";

export const SINGLE_SHIPMENT_WHATSAPP_KEY = "order";

export type ShipmentWhatsappNotice = "tracking" | "posted" | "out_for_delivery" | "delivered";

function foldStatus(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isOutForDeliveryStatus(status: unknown): boolean {
  return foldStatus(status).includes("saiu para entrega");
}

function inTransitForPosted(status: unknown): boolean {
  return shouldMarkEnviadoFromStatus(status) && !shouldMarkCompletedFromStatus(status);
}

export function normalizeWhatsappPhone(value: unknown): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return null;
}

/** Negrito do WhatsApp é um asterisco. A troca vale só no texto enviado. */
export function toWhatsappText(value: string): string {
  return String(value || "").replace(/\*\*/g, "*");
}

export function isHttpsWebhookUrl(value: unknown): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

export function filmagemShouldMark(url: unknown): boolean {
  return isHttpsWebhookUrl(url);
}

export function inboundTypeShouldIgnore(type: unknown): boolean {
  const value = String(type ?? "").trim();
  if (!value) return false;
  return !value.toLowerCase().includes("received");
}

export function currentStatusWhatsappNotices(status: unknown): Array<"posted" | "out_for_delivery" | "delivered"> {
  const notices: Array<"posted" | "out_for_delivery" | "delivered"> = [];
  if (inTransitForPosted(status)) notices.push("posted");
  if (isOutForDeliveryStatus(status)) notices.push("out_for_delivery");
  if (shouldMarkCompletedFromStatus(status)) notices.push("delivered");
  return notices;
}

export function planShipmentWhatsappNotices(input: {
  previousStatus?: unknown;
  nextStatus?: unknown;
  previousCode?: unknown;
  nextCode?: unknown;
  skipTracking?: boolean;
}): ShipmentWhatsappNotice[] {
  const nextCode = String(input.nextCode || "").trim();
  if (nextCode && isProvisionalBarcode(nextCode)) return [];

  const notices: ShipmentWhatsappNotice[] = [];
  const previousCode = String(input.previousCode || "").trim();
  const codeChanged = isUsableLabelBarcode(nextCode) && nextCode.toUpperCase() !== previousCode.toUpperCase();
  if (codeChanged && !input.skipTracking) notices.push("tracking");

  const previousStatus = input.previousStatus;
  const nextStatus = input.nextStatus;
  if (!inTransitForPosted(previousStatus) && inTransitForPosted(nextStatus)) {
    notices.push("posted");
  }
  if (!isOutForDeliveryStatus(previousStatus) && isOutForDeliveryStatus(nextStatus)) {
    notices.push("out_for_delivery");
  }
  if (!shouldMarkCompletedFromStatus(previousStatus) && shouldMarkCompletedFromStatus(nextStatus)) {
    notices.push("delivered");
  }
  return notices;
}
