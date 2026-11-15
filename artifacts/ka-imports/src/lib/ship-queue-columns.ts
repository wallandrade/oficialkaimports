import { hasEnvioEcomLabelReady, type LabelReadyInput } from "./pending-shipment-copy";

const CLOSED_RESHIPMENT = new Set([
  "reenvio_enviado",
  "reenvio_resolvido_sem_entrada",
  "reenvio_cancelado",
]);

export type ShipQueueColumnOrder = LabelReadyInput & {
  status?: string | null;
  enviado?: boolean | null;
  shippingType?: string | null;
  shippingVia?: string | null;
  motoboyDeliveryDate?: string | null;
  motoboyDeliveryTime?: string | null;
  reshipment?: { id?: string | null; status?: string | null } | null;
};

export function isShopeeShippingVia(value: string | null | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "shopee";
}

export function isMotoboyDashboardOrder(order: {
  shippingType?: string | null;
  motoboyDeliveryDate?: string | null;
  motoboyDeliveryTime?: string | null;
}): boolean {
  const shipping = String(order?.shippingType || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return shipping.includes("motoboy") || Boolean(order?.motoboyDeliveryDate && order?.motoboyDeliveryTime);
}

export function isWaitingDashboardShipment(order: ShipQueueColumnOrder): boolean {
  const reshipmentId = String(order.reshipment?.id || "").trim();
  const reshipmentStatus = String(order.reshipment?.status || "");
  const activeReshipment = Boolean(reshipmentId) && !CLOSED_RESHIPMENT.has(reshipmentStatus);
  const pendingNormal = (order.status === "paid" || order.status === "completed")
    && !order.enviado
    && !hasEnvioEcomLabelReady(order);
  return pendingNormal || activeReshipment;
}

/** Separa a fila normal já tirada do motoboy. Enviado ou etiqueta pronta não entra em nenhuma coluna. */
export function splitShipQueueOrders<T extends { shippingVia?: string | null }>(orders: T[]): { normal: T[]; shopee: T[] } {
  const normal: T[] = [];
  const shopee: T[] = [];
  for (const order of orders) {
    if (isShopeeShippingVia(order.shippingVia)) shopee.push(order);
    else normal.push(order);
  }
  return { normal, shopee };
}

export const SHIP_QUEUE_COPY_HEADING = {
  normal: "PEDIDOS PARA ENVIAR",
  shopee: "ENVIO SHOPEE",
  motoboy: "MOTOBOY PARA ENVIAR",
} as const;

/** Mesmo envelope do Copiar TXT de hoje: loja opcional, título com a contagem e um bloco por pedido. */
export function buildShipQueueCopyText(input: {
  heading: string;
  storeLabel?: string | null;
  blocks: string[];
}): string {
  return [
    input.storeLabel ? `Loja: ${input.storeLabel}` : null,
    `${input.heading}: ${input.blocks.length}`,
    "",
    input.blocks.join("\n\n"),
  ].filter((line) => line != null).join("\n");
}
