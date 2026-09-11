export type CustomerSplitPackageItem = {
  productName?: string;
  name?: string;
  quantity?: number;
};

export type CustomerSplitPackage = {
  id: string;
  enviado?: boolean;
  inventoryReserved?: boolean;
  envioecomStatus?: string | null;
  envioecomBarcode?: string | null;
  envioecomShipmentId?: number | null;
  items?: CustomerSplitPackageItem[];
};

export type CustomerPackageKind = "delivered" | "shipped" | "packing" | "waiting";

export type CustomerPackageSituation = {
  kind: CustomerPackageKind;
  label: string;
  hint: string | null;
};

function normalizeTrackingText(value?: string | null): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isPackingBeforePostStatus(status?: string | null): boolean {
  const normalized = normalizeTrackingText(status);
  if (!normalized) return false;
  if (normalized.includes("cancelad") || normalized.includes("aguardando pagamento")) return false;
  if (["coletado", "em transito", "postado", "saiu para entrega", "entregue"].some((marker) => normalized.includes(marker))) {
    return false;
  }
  return [
    "pronto para envio",
    "etiqueta",
    "processando envio",
    "aguardando expedicao",
    "dc-e",
    "dce",
    "envio criado",
    "aguardando postagem",
  ].some((marker) => normalized.includes(marker));
}

function toFriendlyShippingLabel(status?: string | null): string {
  const raw = String(status || "").trim();
  if (!raw) return raw;
  const normalized = normalizeTrackingText(raw);
  if (isPackingBeforePostStatus(raw)) return "Estamos embalando esta parte";
  if (normalized.includes("aguardando pagamento")) return "Preparando envio";
  if (normalized.includes("saiu para entrega") || normalized.includes("em rota")) return "Saiu para entrega";
  if (normalized.includes("entregue")) return "Entregue";
  return raw;
}

export function isCustomerSplitOrder(packages?: unknown): boolean {
  return Array.isArray(packages) && packages.length >= 2;
}

export function isCustomerPackageDelivered(status?: string | null): boolean {
  const normalized = normalizeTrackingText(status);
  return normalized.includes("entregue") && !normalized.includes("cancelad");
}

export function isCustomerPackageShipped(pkg: CustomerSplitPackage): boolean {
  if (pkg.enviado) return true;
  const normalized = normalizeTrackingText(pkg.envioecomStatus);
  if (!normalized || normalized.includes("cancelad")) return false;
  return [
    "coletado",
    "em transito",
    "postado",
    "saiu para entrega",
    "entregue",
    "objeto entregue",
  ].some((marker) => normalized.includes(marker));
}

export function getCustomerPackageSituation(pkg: CustomerSplitPackage): CustomerPackageSituation {
  if (isCustomerPackageDelivered(pkg.envioecomStatus)) {
    return { kind: "delivered", label: "Entregue", hint: null };
  }
  if (isCustomerPackageShipped(pkg)) {
    return {
      kind: "shipped",
      label: toFriendlyShippingLabel(pkg.envioecomStatus) || "Enviado",
      hint: null,
    };
  }
  const hasPrep =
    isPackingBeforePostStatus(pkg.envioecomStatus)
    || Boolean(pkg.envioecomShipmentId)
    || Boolean(String(pkg.envioecomBarcode || "").trim())
    || Boolean(pkg.inventoryReserved);
  if (hasPrep) {
    const label = toFriendlyShippingLabel(pkg.envioecomStatus) || "Estamos embalando esta parte";
    return {
      kind: "packing",
      label,
      hint: "Em breve esta parte será despachada. Aguarde a atualização do rastreio.",
    };
  }
  return {
    kind: "waiting",
    label: "Aguardando estoque",
    hint: "Esta parte do pedido ainda não saiu. Assim que o estoque for liberado, o rastreio aparece aqui.",
  };
}

export function getCustomerSplitBadgeStatus(
  packages: CustomerSplitPackage[],
  orderStatus: string,
  orderEnviado?: boolean,
): string {
  if (orderStatus === "cancelled") return "cancelled";
  if (packages.every((pkg) => isCustomerPackageDelivered(pkg.envioecomStatus))) return "completed";
  const shippedCount = packages.filter((pkg) => isCustomerPackageShipped(pkg)).length;
  if (shippedCount === packages.length) return "enviado";
  if (shippedCount > 0) return "enviado_parcial";
  return orderEnviado ? "enviado" : orderStatus;
}

export function getCustomerSplitSituation(packages: CustomerSplitPackage[]): string {
  if (packages.every((pkg) => isCustomerPackageDelivered(pkg.envioecomStatus))) return "Entregue";
  const kinds = packages.map((pkg) => getCustomerPackageSituation(pkg).kind);
  const shippedOrDelivered = kinds.filter((kind) => kind === "shipped" || kind === "delivered").length;
  const waiting = kinds.filter((kind) => kind === "waiting").length;
  const packing = kinds.filter((kind) => kind === "packing").length;
  if (shippedOrDelivered > 0 && shippedOrDelivered < packages.length) return "Enviado parcialmente";
  if (shippedOrDelivered === packages.length) return "Enviado";
  if (waiting > 0 && waiting < packages.length) return "Parte aguardando estoque";
  if (waiting === packages.length) return "Aguardando estoque";
  if (packing === packages.length) return "Estamos embalando seu pedido";
  return "Em preparação";
}

export function formatCustomerPackageItems(pkg: CustomerSplitPackage): string[] {
  return (pkg.items || [])
    .map((item) => {
      const qty = Number(item.quantity) || 0;
      const name = String(item.productName || item.name || "").trim();
      if (qty <= 0 || !name) return "";
      return `${qty}x ${name}`;
    })
    .filter(Boolean);
}
