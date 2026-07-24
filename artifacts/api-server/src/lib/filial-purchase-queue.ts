import crypto from "crypto";
import {
  db,
  filialPurchaseRequestAuditsTable,
  filialPurchaseRequestsTable,
  ordersTable,
  tenantsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";

export type FilialPurchaseItemSnapshot = {
  productId: string;
  productName: string;
  quantity: number;
  saleUnitPrice: number;
  repasseUnitCost: number;
};

type OrderProductInput = {
  id?: unknown;
  name?: unknown;
  quantity?: unknown;
  qty?: unknown;
  price?: unknown;
  costPrice?: unknown;
  costprice?: unknown;
  cost?: unknown;
};

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function parseOrderProducts(raw: unknown): OrderProductInput[] {
  if (Array.isArray(raw)) return raw as OrderProductInput[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OrderProductInput[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeItems(rawProducts: unknown): FilialPurchaseItemSnapshot[] {
  const parsed = parseOrderProducts(rawProducts);
  const grouped = new Map<string, FilialPurchaseItemSnapshot>();

  for (const item of parsed) {
    const productId = String(item?.id || "").trim();
    const quantity = Number(item?.quantity ?? item?.qty ?? 0);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;

    const saleUnitPrice = Number(item?.price || 0);
    const repasseUnitCostRaw = Number(item?.costPrice ?? item?.costprice ?? item?.cost ?? 0);
    const repasseUnitCost = Number.isFinite(repasseUnitCostRaw) ? repasseUnitCostRaw : 0;
    const existing = grouped.get(productId);

    if (!existing) {
      grouped.set(productId, {
        productId,
        productName: String(item?.name || "Produto").trim() || "Produto",
        quantity,
        saleUnitPrice: Number.isFinite(saleUnitPrice) ? saleUnitPrice : 0,
        repasseUnitCost,
      });
      continue;
    }

    const nextQty = existing.quantity + quantity;
    const weightedSale = nextQty > 0
      ? ((existing.saleUnitPrice * existing.quantity) + ((Number.isFinite(saleUnitPrice) ? saleUnitPrice : 0) * quantity)) / nextQty
      : existing.saleUnitPrice;

    const weightedRepasse = nextQty > 0
      ? ((existing.repasseUnitCost * existing.quantity) + (repasseUnitCost * quantity)) / nextQty
      : existing.repasseUnitCost;

    grouped.set(productId, {
      ...existing,
      quantity: nextQty,
      saleUnitPrice: weightedSale,
      repasseUnitCost: weightedRepasse,
    });
  }

  return Array.from(grouped.values());
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function addAuditLog(params: {
  requestId: string;
  action: string;
  actorUsername?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(filialPurchaseRequestAuditsTable).values({
    id: randomId("fpra"),
    requestId: params.requestId,
    action: params.action,
    actorUsername: params.actorUsername || null,
    payload: params.payload || null,
    createdAt: new Date(),
  });
}

export async function enqueueFilialOrderPurchaseRequest(orderId: string): Promise<{
  enqueued: boolean;
  reason?: string;
  requestId?: string;
}> {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) return { enqueued: false, reason: "invalid_order" };

  const rows = await db
    .select({
      id: ordersTable.id,
      tenantId: ordersTable.tenantId,
      status: ordersTable.status,
      total: ordersTable.total,
      paidAmount: ordersTable.paidAmount,
      clientName: ordersTable.clientName,
      products: ordersTable.products,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, normalizedOrderId))
    .limit(1);

  const order = rows[0];
  if (!order) return { enqueued: false, reason: "order_not_found" };

  const tenantId = String(order.tenantId || "").trim() || DEFAULT_TENANT_ID;
  if (tenantId === DEFAULT_TENANT_ID) return { enqueued: false, reason: "default_tenant_order" };

  const status = String(order.status || "").trim().toLowerCase();
  if (status !== "paid" && status !== "completed") {
    return { enqueued: false, reason: "order_not_paid" };
  }

  const existing = await db
    .select({ id: filialPurchaseRequestsTable.id })
    .from(filialPurchaseRequestsTable)
    .where(eq(filialPurchaseRequestsTable.orderId, normalizedOrderId))
    .limit(1);

  if (existing[0]) {
    return { enqueued: false, reason: "already_enqueued", requestId: existing[0].id };
  }

  const itemsSnapshot = normalizeItems(order.products);
  if (itemsSnapshot.length === 0) {
    return { enqueued: false, reason: "empty_items" };
  }

  const orderTotal = round2(Number(order.paidAmount || order.total || 0));
  const repasseTotal = round2(itemsSnapshot.reduce((sum, item) => sum + (item.repasseUnitCost * item.quantity), 0));
  const requestId = randomId("fpr");

  await db.insert(filialPurchaseRequestsTable).values({
    id: requestId,
    filialTenantId: tenantId,
    orderId: normalizedOrderId,
    status: "aguardando_compra_loja1",
    clientName: String(order.clientName || "Cliente").trim() || "Cliente",
    orderTotal: String(orderTotal),
    repasseTotal: String(repasseTotal),
    itemsSnapshot,
    createdByAdmin: null,
    updatedByAdmin: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const tenantRows = await db
    .select({ id: tenantsTable.id, name: tenantsTable.name })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  await addAuditLog({
    requestId,
    action: "pago_na_filial",
    payload: {
      orderId: normalizedOrderId,
      filialTenantId: tenantId,
      filialTenantName: tenantRows[0]?.name || null,
      orderStatus: status,
      repasseTotal,
      orderTotal,
    },
  });

  await addAuditLog({
    requestId,
    action: "aguardando_compra_loja1",
    payload: {
      orderId: normalizedOrderId,
      filialTenantId: tenantId,
    },
  });

  return { enqueued: true, requestId };
}
