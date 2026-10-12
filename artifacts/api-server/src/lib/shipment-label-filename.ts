export function shipmentPoolLabel(pool?: string | null): string | null {
  const value = String(pool || "").trim().toLowerCase();
  if (value === "motoboy") return "Motoboy";
  if (value === "minas") return "Minas";
  if (value === "loja") return "Fóz Guaçu";
  return null;
}

function sanitizeLabelPart(value?: string | null): string {
  return String(value || "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nome do PDF: cliente primeiro, depois nº do pedido e o pool no split. */
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

export function inlinePdfContentDisposition(filename: string): string {
  const safe = sanitizeLabelPart(filename).replace(/\.pdf$/i, "") || "etiqueta";
  const unicodeName = `${safe}.pdf`;
  const ascii = unicodeName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .trim() || "etiqueta.pdf";
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(unicodeName)}`;
}

export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  const value = String(header || "");
  const star = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      const name = decodeURIComponent(star[1].trim());
      if (name) return name;
    } catch {
      /* header malformado */
    }
  }
  const quoted = value.match(/filename="([^"]+)"/i);
  return quoted?.[1]?.trim() || null;
}
