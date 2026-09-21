import { normalizeCustomerDocument } from "./customer-document";
import { isLabelBlockedStatus, isUsableLabelBarcode } from "./envioecom-status";
import { ENVIOECOM_ENV_ACCOUNT_ID, ENVIOECOM_TENANT_ACCOUNT_ID } from "./envioecom-accounts-core";
import { isSplitShipments, parseOrderShipmentItems } from "./order-shipments-logic";

export const RELATED_CPF_SHIPMENT_RECENT_MS = 14 * 24 * 60 * 60 * 1000;
export const RELATED_CPF_SHIPMENT_SCAN_LIMIT = 25;
export const RELATED_CPF_SHIPMENT_CARD_LIMIT = 5;

export type RelatedCpfProduct = {
  productId: string | null;
  productName: string;
  quantity: number;
};

export type RelatedCpfWarningLevel = "none" | "recent" | "same_product";

export type RelatedCpfShipment = {
  orderId: string;
  orderNumber: number | null;
  parentOrderId: string | null;
  isReshipRelated: boolean;
  shippedAt: string;
  enviado: boolean;
  barcode: string | null;
  envioecomShipmentId: number | null;
  envioecomStatus: string | null;
  accountId: string | null;
  accountName: string | null;
  products: RelatedCpfProduct[];
  sameProduct: boolean;
  recent: boolean;
};

export type RelatedCpfShipmentsResult = {
  cpf: string | null;
  shipments: RelatedCpfShipment[];
  recentCount: number;
  sameProductCount: number;
  warningLevel: RelatedCpfWarningLevel;
  recentDays: number;
};

export type RelatedCpfPackageInput = {
  id?: string;
  inventoryPool?: string | null;
  items?: unknown;
  enviado?: boolean | null;
  envioecomShipmentId?: number | null;
  envioecomBarcode?: string | null;
  envioecomStatus?: string | null;
  envioecomStatusUpdatedAt?: string | Date | null;
  envioecomAccountId?: string | null;
  envioecomLabelUrl?: string | null;
};

export type RelatedCpfOrderInput = {
  id: string;
  orderNumber?: number | null;
  parentOrderId?: string | null;
  createdAt?: string | Date | null;
  enviado?: boolean | null;
  products?: unknown;
  trackingCode?: string | null;
  envioecomShipmentId?: number | null;
  envioecomBarcode?: string | null;
  envioecomStatus?: string | null;
  envioecomStatusUpdatedAt?: string | Date | null;
  envioecomAccountId?: string | null;
  packages?: RelatedCpfPackageInput[] | null;
};

export function parseRelatedCpfDigits(value: unknown): string | null {
  const digits = normalizeCustomerDocument(value);
  return digits.length === 11 ? digits : null;
}

export function emptyRelatedCpfShipmentsResult(cpf: string | null = null): RelatedCpfShipmentsResult {
  return {
    cpf,
    shipments: [],
    recentCount: 0,
    sameProductCount: 0,
    warningLevel: "none",
    recentDays: Math.round(RELATED_CPF_SHIPMENT_RECENT_MS / (24 * 60 * 60 * 1000)),
  };
}

export function prettyRelatedAccountName(
  accountId?: string | null,
  accountNames?: Record<string, string>,
): string | null {
  const id = String(accountId || "").trim();
  if (!id) return null;
  const named = String(accountNames?.[id] || "").trim();
  if (named) return named;
  if (id === ENVIOECOM_ENV_ACCOUNT_ID) return "São Paulo";
  if (id === ENVIOECOM_TENANT_ACCOUNT_ID) return "Conta da loja";
  return id;
}

export function relatedProductKeys(products: unknown): Set<string> {
  const keys = new Set<string>();
  for (const item of parseOrderShipmentItems(products)) {
    if (item.productId) keys.add(`id:${item.productId}`);
    const name = item.productName.trim().toLowerCase();
    if (name) keys.add(`name:${name}`);
  }
  return keys;
}

export function relatedProductsOverlap(current: Set<string>, other: unknown): boolean {
  if (current.size === 0) return false;
  for (const key of relatedProductKeys(other)) {
    if (current.has(key)) return true;
  }
  return false;
}

export function hasUsableRelatedEnvioEcomShipment(input: {
  envioecomShipmentId?: number | null;
  envioecomBarcode?: string | null;
  trackingCode?: string | null;
  envioecomStatus?: string | null;
  envioecomLabelUrl?: string | null;
}): boolean {
  if (isLabelBlockedStatus(input.envioecomStatus)) return false;
  const shipmentId = Number(input.envioecomShipmentId || 0);
  if (Number.isFinite(shipmentId) && shipmentId > 0) return true;
  if (isUsableLabelBarcode(input.envioecomBarcode)) return true;
  if (isUsableLabelBarcode(input.trackingCode)) return true;
  return Boolean(String(input.envioecomLabelUrl || "").trim());
}

function toIso(value: string | Date | null | undefined, fallback: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return new Date(parsed).toISOString();
}

function orderCreatedIso(order: RelatedCpfOrderInput): string {
  return toIso(order.createdAt, new Date(0).toISOString());
}

function isReshipRelated(
  currentOrderId: string,
  currentParentOrderId: string | null,
  sibling: RelatedCpfOrderInput,
): boolean {
  const siblingParent = String(sibling.parentOrderId || "").trim() || null;
  if (siblingParent && siblingParent === currentOrderId) return true;
  if (currentParentOrderId && sibling.id === currentParentOrderId) return true;
  if (currentParentOrderId && siblingParent && siblingParent === currentParentOrderId) return true;
  return false;
}

function mapShipment(opts: {
  order: RelatedCpfOrderInput;
  barcode: string | null;
  envioecomShipmentId: number | null;
  envioecomStatus: string | null;
  enviado: boolean;
  shippedAt: string;
  accountId: string | null;
  accountName: string | null;
  products: RelatedCpfProduct[];
  sameProduct: boolean;
  recent: boolean;
  isReshipRelated: boolean;
}): RelatedCpfShipment {
  return {
    orderId: opts.order.id,
    orderNumber: Number.isFinite(Number(opts.order.orderNumber)) ? Number(opts.order.orderNumber) : null,
    parentOrderId: String(opts.order.parentOrderId || "").trim() || null,
    isReshipRelated: opts.isReshipRelated,
    shippedAt: opts.shippedAt,
    enviado: opts.enviado,
    barcode: opts.barcode,
    envioecomShipmentId: opts.envioecomShipmentId,
    envioecomStatus: opts.envioecomStatus,
    accountId: opts.accountId,
    accountName: opts.accountName,
    products: opts.products,
    sameProduct: opts.sameProduct,
    recent: opts.recent,
  };
}

export function collectRelatedCpfShipments(opts: {
  currentOrderId: string;
  currentParentOrderId?: string | null;
  currentProducts?: unknown;
  now?: Date;
  recentMs?: number;
  cardLimit?: number;
  accountNames?: Record<string, string>;
  siblings: RelatedCpfOrderInput[];
}): RelatedCpfShipmentsResult {
  const currentOrderId = String(opts.currentOrderId || "").trim();
  const currentParentOrderId = String(opts.currentParentOrderId || "").trim() || null;
  const currentKeys = relatedProductKeys(opts.currentProducts);
  const now = opts.now?.getTime() ?? Date.now();
  const recentMs = opts.recentMs ?? RELATED_CPF_SHIPMENT_RECENT_MS;
  const cardLimit = opts.cardLimit ?? RELATED_CPF_SHIPMENT_CARD_LIMIT;
  const shipments: RelatedCpfShipment[] = [];

  for (const sibling of opts.siblings) {
    const orderId = String(sibling.id || "").trim();
    if (!orderId || orderId === currentOrderId) continue;
    const reshipRelated = isReshipRelated(currentOrderId, currentParentOrderId, sibling);
    const createdAt = orderCreatedIso(sibling);
    const packages = Array.isArray(sibling.packages) ? sibling.packages : [];
    const usePackages = isSplitShipments(packages);

    const rows = usePackages
      ? packages.map((pkg) => ({
          barcode: String(pkg.envioecomBarcode || "").trim() || null,
          envioecomShipmentId: Number(pkg.envioecomShipmentId || 0) > 0 ? Number(pkg.envioecomShipmentId) : null,
          envioecomStatus: String(pkg.envioecomStatus || "").trim() || null,
          enviado: Boolean(pkg.enviado),
          shippedAt: toIso(pkg.envioecomStatusUpdatedAt, createdAt),
          accountId: String(pkg.envioecomAccountId || "").trim() || null,
          products: parseOrderShipmentItems(pkg.items?.length ? pkg.items : sibling.products),
          labelUrl: pkg.envioecomLabelUrl,
          trackingCode: null as string | null,
        }))
      : [{
          barcode: String(sibling.envioecomBarcode || sibling.trackingCode || "").trim() || null,
          envioecomShipmentId: Number(sibling.envioecomShipmentId || 0) > 0 ? Number(sibling.envioecomShipmentId) : null,
          envioecomStatus: String(sibling.envioecomStatus || "").trim() || null,
          enviado: Boolean(sibling.enviado),
          shippedAt: toIso(sibling.envioecomStatusUpdatedAt, createdAt),
          accountId: String(sibling.envioecomAccountId || "").trim() || null,
          products: parseOrderShipmentItems(sibling.products),
          labelUrl: null as string | null,
          trackingCode: sibling.trackingCode,
        }];

    for (const row of rows) {
      if (!hasUsableRelatedEnvioEcomShipment({
        envioecomShipmentId: row.envioecomShipmentId,
        envioecomBarcode: row.barcode,
        trackingCode: row.trackingCode,
        envioecomStatus: row.envioecomStatus,
        envioecomLabelUrl: row.labelUrl,
      })) continue;
      const shippedAtMs = Date.parse(row.shippedAt);
      const recent = Number.isFinite(shippedAtMs) && (now - shippedAtMs) <= recentMs;
      shipments.push(mapShipment({
        order: sibling,
        barcode: row.barcode,
        envioecomShipmentId: row.envioecomShipmentId,
        envioecomStatus: row.envioecomStatus,
        enviado: row.enviado,
        shippedAt: row.shippedAt,
        accountId: row.accountId,
        accountName: prettyRelatedAccountName(row.accountId, opts.accountNames),
        products: row.products,
        sameProduct: relatedProductsOverlap(currentKeys, row.products),
        recent,
        isReshipRelated: reshipRelated,
      }));
    }
  }

  shipments.sort((a, b) => Date.parse(b.shippedAt) - Date.parse(a.shippedAt));
  const warnable = shipments.filter((row) => !row.isReshipRelated && row.recent);
  const sameProductRecent = warnable.filter((row) => row.sameProduct);
  const warningLevel: RelatedCpfWarningLevel = sameProductRecent.length > 0
    ? "same_product"
    : warnable.length > 0
      ? "recent"
      : "none";

  return {
    ...emptyRelatedCpfShipmentsResult(null),
    shipments: shipments.slice(0, Math.max(1, cardLimit)),
    recentCount: warnable.length,
    sameProductCount: sameProductRecent.length,
    warningLevel,
  };
}
