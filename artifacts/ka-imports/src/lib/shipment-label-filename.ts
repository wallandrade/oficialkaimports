function sanitizeLabelPart(value?: string | null): string {
  return String(value || "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Igual a `shipment-label-filename.ts` da API: cliente, nº do pedido e pool no split. */
export function shipmentLabelPdfFilename(input: {
  clientName?: string | null;
  orderNumber?: number | null;
  poolLabel?: string | null;
}): string {
  const name = sanitizeLabelPart(input.clientName) || "Cliente";
  const parts = [name];
  const orderNumber = Number(input.orderNumber);
  if (Number.isFinite(orderNumber) && orderNumber > 0) parts.push(String(Math.trunc(orderNumber)));
  const pool = sanitizeLabelPart(input.poolLabel);
  if (pool) parts.push(pool);
  return `${parts.join(" ").slice(0, 140)}.pdf`;
}
