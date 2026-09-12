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
  envioecomDeliveryMode?: string | null;
  envioecomStatusHistory?: Array<{ at?: string; status?: string; location?: string | null; description?: string | null }>;
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
    "aguardando coleta",
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

function packageHasCustomerTracking(pkg: CustomerSplitPackage): boolean {
  return Boolean(
    pkg.envioecomShipmentId
    || String(pkg.envioecomBarcode || "").trim()
    || isCustomerPackageShipped(pkg),
  );
}

export function collapseCustomerPackagesForOrder(
  packages: CustomerSplitPackage[] | undefined,
  orderEnviado?: boolean,
): CustomerSplitPackage[] {
  const list = Array.isArray(packages) ? packages : [];
  if (list.length < 2 || !orderEnviado) return list;
  const visible = list.filter(packageHasCustomerTracking);
  if (visible.length === 0) return list;
  const hidden = list.filter((pkg) => !packageHasCustomerTracking(pkg));
  if (hidden.length === 0) return list;
  const mergedItems = [
    ...(visible[0].items || []),
    ...hidden.flatMap((pkg) => pkg.items || []),
  ];
  return [{ ...visible[0], items: mergedItems }, ...visible.slice(1)];
}

export function isCustomerSplitOrder(packages?: unknown, orderEnviado?: boolean): boolean {
  const list = Array.isArray(packages) ? packages as CustomerSplitPackage[] : [];
  return collapseCustomerPackagesForOrder(list, orderEnviado).length >= 2;
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
    label: "Aguardando envio",
    hint: "Este envio ainda está sendo preparado.",
  };
}

export function getCustomerSplitBadgeStatus(
  packages: CustomerSplitPackage[],
  orderStatus: string,
  orderEnviado?: boolean,
): string {
  if (orderStatus === "cancelled") return "cancelled";
  const visible = collapseCustomerPackagesForOrder(packages, orderEnviado);
  if (visible.every((pkg) => isCustomerPackageDelivered(pkg.envioecomStatus))) return "completed";
  if (orderEnviado) return "enviado";
  const shippedCount = visible.filter((pkg) => isCustomerPackageShipped(pkg)).length;
  if (shippedCount === visible.length) return "enviado";
  if (shippedCount > 0) return "enviado_parcial";
  return orderStatus;
}

export function getCustomerSplitSituation(
  packages: CustomerSplitPackage[],
  orderEnviado?: boolean,
): string {
  const visible = collapseCustomerPackagesForOrder(packages, orderEnviado);
  if (visible.every((pkg) => isCustomerPackageDelivered(pkg.envioecomStatus))) return "Entregue";
  if (orderEnviado) {
    const first = visible.find((pkg) => pkg.envioecomStatus) || visible[0];
    return toFriendlyShippingLabel(first?.envioecomStatus) || "Enviado";
  }
  const kinds = visible.map((pkg) => getCustomerPackageSituation(pkg).kind);
  const shippedOrDelivered = kinds.filter((kind) => kind === "shipped" || kind === "delivered").length;
  const waiting = kinds.filter((kind) => kind === "waiting").length;
  const packing = kinds.filter((kind) => kind === "packing").length;
  if (shippedOrDelivered > 0 && shippedOrDelivered < visible.length) return "Enviado parcialmente";
  if (shippedOrDelivered === visible.length) return "Enviado";
  if (waiting > 0 && waiting < visible.length) return "Em preparação";
  if (waiting === visible.length) return "Aguardando envio";
  if (packing === visible.length) return "Estamos embalando seu pedido";
  return "Em preparação";
}

export function getCustomerPartialHint(
  packages: CustomerSplitPackage[],
  orderEnviado?: boolean,
): string | null {
  if (orderEnviado) return null;
  if (getCustomerSplitSituation(packages, orderEnviado) !== "Enviado parcialmente") return null;
  return "Parte do pedido já saiu. O restante ainda está sendo preparado.";
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

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

export function isCustomerOrderDelivered(order: {
  status?: string;
  enviado?: boolean;
  createdAt?: string;
  envioecomStatus?: string | null;
  envioecomStatusUpdatedAt?: string | null;
  packages?: CustomerSplitPackage[];
}): boolean {
  if (order.status === "cancelled") return false;
  const packages = Array.isArray(order.packages) ? order.packages : [];
  if (packages.length >= 2) {
    return packages.every((pkg) => isCustomerPackageDelivered(pkg.envioecomStatus));
  }
  if (isCustomerPackageDelivered(order.envioecomStatus)) return true;
  if (order.status === "completed" && !order.envioecomStatus) return true;
  if (order.enviado && !order.envioecomStatus) {
    const from = Date.parse(String(order.envioecomStatusUpdatedAt || order.createdAt || ""));
    return Number.isFinite(from) && Date.now() - from >= FIFTEEN_DAYS_MS;
  }
  return false;
}
