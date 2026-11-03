import {
  isProvisionalBarcode,
  isUsableLabelBarcode,
  shouldMarkCompletedFromStatus,
  shouldMarkEnviadoFromStatus,
} from "./envioecom-status";

export const SINGLE_SHIPMENT_WHATSAPP_KEY = "order";

/** Linhas `💊 2x Nome` do aviso de rastreio. Quantidade vazia ou zero fica de fora. */
export function formatTrackingProductLines(raw: unknown): string {
  const rows = Array.isArray(raw) ? raw : [];
  const lines: string[] = [];
  for (const item of rows) {
    const row = item as { quantity?: unknown; name?: unknown; productName?: unknown };
    const qty = Math.trunc(Number(row?.quantity) || 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const name = String(row?.productName || row?.name || "").trim() || "Produto";
    lines.push(`💊 ${qty}x ${name}`);
  }
  return lines.join("\n");
}

export const PARTIAL_TRACKING_NOTICE =
  "Seu pedido foi enviado parcialmente. Aguarde: em breve você recebe outro rastreio com o restante do pedido.";

function packageHasUsableTracking(row: { envioecomBarcode?: unknown; manualTrackingCode?: unknown }): boolean {
  return isUsableLabelBarcode(row.envioecomBarcode) || isUsableLabelBarcode(row.manualTrackingCode);
}

/** Pedido dividido e algum outro pacote ainda sem código utilizável. Envio único não avisa. */
export function trackingNoticeIsPartial(input: {
  packageKey: string;
  packages: Array<{ id?: unknown; envioecomBarcode?: unknown; manualTrackingCode?: unknown }>;
}): boolean {
  const packageKey = String(input.packageKey || "").trim();
  if (!packageKey || packageKey === SINGLE_SHIPMENT_WHATSAPP_KEY) return false;
  const packages = Array.isArray(input.packages) ? input.packages : [];
  if (packages.length < 2) return false;
  const others = packages.filter((row) => String(row?.id || "").trim() !== packageKey);
  if (!others.length) return false;
  return others.some((row) => !packageHasUsableTracking(row));
}

/** Rastreio com os itens daquele pacote. Sem itens, fica só número, código e link. */
export function formatTrackingWhatsappMessage(input: {
  orderLabel: string;
  code: string;
  productsText?: string;
  partial?: boolean;
}): string {
  const lines = [`📦 *Rastreio do pedido #${input.orderLabel}*`, ""];
  const products = String(input.productsText || "").trim();
  if (products) lines.push(products, "");
  if (input.partial) lines.push(PARTIAL_TRACKING_NOTICE, "");
  lines.push(`Código: ${input.code}`, `https://envioecomrastreio.com.br/${input.code}`);
  return lines.join("\n");
}

export type ShipmentWhatsappNotice = "tracking" | "posted" | "out_for_delivery" | "delivered";

function foldStatus(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isOutForDeliveryStatus(status: unknown): boolean {
  const normalized = foldStatus(status);
  return normalized.includes("saiu para entrega") || normalized.includes("em rota");
}

/** Postado, saiu e rastreio tentam de novo com a coluna ainda NULL. Entregue só repete depois que a coluna existe. */
export function shouldBackfillShipmentNotice(
  kind: ShipmentWhatsappNotice,
  columnPresent: boolean,
  keys: readonly string[],
  packageKey: string,
): boolean {
  if (keys.includes(packageKey)) return false;
  if (kind === "delivered") return columnPresent;
  return true;
}

function inTransitForPosted(status: unknown): boolean {
  return shouldMarkEnviadoFromStatus(status) && !shouldMarkCompletedFromStatus(status);
}

export function normalizeWhatsappPhone(value: unknown): string | null {
  let digits = String(value || "").replace(/\D/g, "");
  while (digits.startsWith("0")) digits = digits.slice(1);
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

export const MENU_REPEAT_MS = 24 * 60 * 60 * 1000;

/** O menu de abertura só volta depois de 24 h. Texto livre nesse intervalo não pede de novo. */
export function menuShouldSendAgain(sentAt: Date | null, now = Date.now()): boolean {
  if (!sentAt) return true;
  const time = sentAt.getTime();
  if (!Number.isFinite(time)) return true;
  return now - time >= MENU_REPEAT_MS;
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
