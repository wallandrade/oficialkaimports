/** Canal do card Pedidos para Enviar. Não altera status, PIX nem estoque. */

export const SHOPEE_SHIPPING_VIA = "shopee";

function normalizedChannel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** `undefined` = valor recusado. `null` = envio normal. `"shopee"` = coluna Shopee. */
export function parseShippingVia(value: unknown): "shopee" | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = normalizedChannel(value);
  if (!text || text === "normal" || text === "padrao") return null;
  if (text === SHOPEE_SHIPPING_VIA) return SHOPEE_SHIPPING_VIA;
  return undefined;
}

/** Valor já gravado, para a lista do admin. Texto desconhecido volta para o envio normal. */
export function storedShippingVia(value: unknown): "shopee" | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  return parseShippingVia(value) === SHOPEE_SHIPPING_VIA ? SHOPEE_SHIPPING_VIA : null;
}
