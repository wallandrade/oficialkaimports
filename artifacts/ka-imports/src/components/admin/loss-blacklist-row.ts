export type LossRowIdentity = {
  origin?: "store" | "peer" | null;
  orderId?: string | null;
  orderNumber?: number | null;
  orderLabel?: string | null;
  legacy?: boolean | null;
};

export function lossBlacklistRowView(item: LossRowIdentity): {
  label: string;
  opensOrder: boolean;
  legacy: boolean;
} {
  if (item.origin === "peer") {
    return { label: "Outra loja", opensOrder: false, legacy: false };
  }
  const numeric = Number(item.orderNumber);
  const fromNumber = Number.isFinite(numeric) && numeric > 0 ? String(Math.trunc(numeric)) : "";
  const orderId = String(item.orderId || "").trim();
  const legacy = item.legacy === true || !orderId;
  if (legacy) {
    return {
      label: String(item.orderLabel || "").trim() || fromNumber || "Sem pedido",
      opensOrder: false,
      legacy: true,
    };
  }
  return {
    label: String(item.orderLabel || "").trim() || fromNumber || orderId,
    opensOrder: true,
    legacy: false,
  };
}
