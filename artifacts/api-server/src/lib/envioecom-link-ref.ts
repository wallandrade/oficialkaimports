export function parseEnvioEcomLinkRef(raw: unknown): { shipmentId?: number; barcode?: string } {
  const value = String(raw || "").trim();
  if (!value) return {};
  const compact = value.replace(/\s+/g, "");
  const digits = compact.replace(/\D/g, "");
  if (digits.length >= 4 && digits.length <= 10 && digits === compact) {
    return { shipmentId: Number(digits) };
  }
  return { barcode: compact };
}
