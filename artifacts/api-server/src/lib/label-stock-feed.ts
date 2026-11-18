import { timingSafeEqual } from "crypto";
import {
  hasEnvioEcomLabelReady,
  isProvisionalBarcode,
  isUsableLabelBarcode,
} from "./envioecom-status";
import {
  defaultKaInventoryExitPool,
  isYuryInventoryPool,
  normalizeYuryProductName,
  parseKaInventoryExitedPools,
  type YuryInventoryPool,
} from "./yury-inventory";

export const LABEL_STOCK_RESULTS = ["baixou_estoque", "saiu_sem_abater"] as const;
export type LabelStockResult = (typeof LABEL_STOCK_RESULTS)[number];

export type LabelStockProduct = {
  productId: string | null;
  name: string;
  quantity: number;
};

export type PendingLabelStock = {
  labelId: string;
  orderNumber: number | null;
  customerName: string;
  status: string;
  code: string | null;
  warehouse: YuryInventoryPool;
  products: LabelStockProduct[];
};

export type LabelStockClosure = LabelStockResult | null;

export type LabelStockInspect = {
  warehouse: YuryInventoryPool | null;
  closure: LabelStockClosure;
  published: PendingLabelStock | null;
};

type LabelItem = {
  productId: string | null;
  productName: string;
  quantity: number;
};

export type LabelStockSource = {
  labelId: string;
  orderNumber: number | null;
  customerName: string;
  orderStatus: string;
  pool: unknown;
  shippingType?: unknown;
  motoboyDeliveryDate?: unknown;
  motoboyDeliveryTime?: unknown;
  inventoryExitPool?: unknown;
  exitedPools?: unknown;
  reserved: boolean;
  waived: boolean;
  labelUrl?: string | null;
  envioecomStatus?: string | null;
  barcode?: string | null;
  trackingCode?: string | null;
  trackingKey?: string | null;
  manualCode?: string | null;
  items: LabelItem[];
  yuryProducts: Array<{ productId: string; productName: string }>;
};

export function getLabelStockSyncToken(): string {
  return String(process.env.LABEL_STOCK_SYNC_TOKEN || "").trim();
}

export function readLabelStockCredential(authorization: unknown, apiKey: unknown): string {
  const auth = String(authorization || "");
  const bearer = /^Bearer\s+(\S+)/i.exec(auth);
  if (bearer?.[1]) return bearer[1].trim();
  return String(apiKey || "").trim();
}

export function labelStockAuthStatus(presented: string, configured: string): 200 | 401 | 503 {
  if (!configured) return 503;
  if (!presented || !safeEqual(presented, configured)) return 401;
  return 200;
}

export function parseLabelStockResult(raw: unknown): LabelStockResult | null {
  const value = String(raw || "").trim();
  if (value === "baixou_estoque" || value === "saiu_sem_abater") return value;
  return null;
}

export function labelStockCode(input: {
  barcode?: string | null;
  trackingCode?: string | null;
  trackingKey?: string | null;
  manualCode?: string | null;
}): string | null {
  if (isUsableLabelBarcode(input.barcode)) return String(input.barcode).trim();
  if (isUsableLabelBarcode(input.trackingCode)) return String(input.trackingCode).trim();
  const key = String(input.trackingKey || "").trim();
  if (key && !isProvisionalBarcode(key)) return key;
  const manual = String(input.manualCode || "").trim();
  if (manual) return manual;
  return null;
}

export function publishLabelProducts(
  items: LabelItem[],
  yuryRows: Array<{ productId: string; productName: string }>,
): LabelStockProduct[] {
  const byId = new Map(yuryRows.map((row) => [row.productId, row]));
  const byName = new Map<string, { productId: string; productName: string }>();
  for (const row of yuryRows) {
    const name = normalizeYuryProductName(row.productName);
    if (name && !byName.has(name)) byName.set(name, row);
  }

  const grouped = new Map<string, LabelStockProduct>();
  for (const item of items) {
    const quantity = Math.trunc(Number(item.quantity) || 0);
    if (quantity <= 0) continue;
    const matched = (item.productId ? byId.get(item.productId) : undefined)
      || byName.get(normalizeYuryProductName(item.productName));
    const productId = matched?.productId || null;
    const name = matched?.productName || item.productName || "Produto";
    const key = productId ? `id:${productId}` : `name:${normalizeYuryProductName(name) || name}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      productId,
      name: prev?.name || name,
      quantity: (prev?.quantity || 0) + quantity,
    });
  }
  return [...grouped.values()];
}

function resolvedWarehouse(input: LabelStockSource): YuryInventoryPool | null {
  const fromPool = isYuryInventoryPool(String(input.pool || ""))
    ? input.pool as YuryInventoryPool
    : null;
  if (fromPool) return fromPool;
  if (input.pool != null && String(input.pool).trim()) return null;
  const fallback = defaultKaInventoryExitPool({
    shippingType: input.shippingType,
    motoboyDeliveryDate: input.motoboyDeliveryDate,
    motoboyDeliveryTime: input.motoboyDeliveryTime,
    inventoryExitPool: input.inventoryExitPool,
  });
  return isYuryInventoryPool(fallback) ? fallback : null;
}

function labelReady(input: LabelStockSource): boolean {
  if (String(input.orderStatus || "").trim().toLowerCase() === "cancelled") return false;
  return hasEnvioEcomLabelReady({
    envioecomLabelUrl: input.labelUrl,
    envioecomStatus: input.envioecomStatus,
  });
}

export function inspectLabelStock(input: LabelStockSource): LabelStockInspect {
  const warehouse = resolvedWarehouse(input);
  const exited = warehouse
    ? parseKaInventoryExitedPools(input.exitedPools).includes(warehouse)
    : false;
  const closure: LabelStockClosure = input.reserved || exited
    ? "baixou_estoque"
    : input.waived
      ? "saiu_sem_abater"
      : null;
  const ready = labelReady(input);
  if (!warehouse || !ready || closure) {
    return { warehouse, closure, published: null };
  }
  const status = String(input.envioecomStatus || "").trim() || "Etiqueta emitida";
  return {
    warehouse,
    closure: null,
    published: {
      labelId: input.labelId,
      orderNumber: input.orderNumber,
      customerName: String(input.customerName || "").trim(),
      status,
      code: labelStockCode(input),
      warehouse,
      products: publishLabelProducts(input.items, input.yuryProducts),
    },
  };
}

export function decideLabelStockWrite(input: {
  closure: LabelStockClosure;
  published: PendingLabelStock | null;
  result: LabelStockResult;
}):
  | { http: 404; code: "LABEL_NOT_FOUND" }
  | { http: 409; code: "RESULT_CONFLICT" }
  | { http: 200; alreadyApplied: true }
  | { http: 200; alreadyApplied: false; callsYuryExit: false } {
  if (input.closure === input.result) return { http: 200, alreadyApplied: true };
  if (input.closure) return { http: 409, code: "RESULT_CONFLICT" };
  if (!input.published) return { http: 404, code: "LABEL_NOT_FOUND" };
  return { http: 200, alreadyApplied: false, callsYuryExit: false };
}

function safeEqual(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
