import { Router, type IRouter } from "express";
import crypto from "crypto";
import {
  db,
  filialPurchaseRequestAuditsTable,
  filialPurchaseRequestsTable,
  inventoryMovementsTable,
  ordersTable,
  productCostHistoryTable,
  productsTable,
  tenantsTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getAdminScope, requireAdminAuth, requirePrimaryAdmin } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { registerInventoryEntry } from "../lib/reshipments";
import { enqueueFilialOrderPurchaseRequest } from "../lib/filial-purchase-queue";

const router: IRouter = Router();

type SnapshotItem = {
  productId: string;
  productName: string;
  quantity: number;
  saleUnitPrice: number;
  baseUnitCost: number | null;
  repasseUnitCost: number;
};

type CostInput = {
  productId?: unknown;
  unitCost?: unknown;
  repasseUnitCost?: unknown;
};

type ManualPurchaseItemInput = {
  productId?: unknown;
  quantity?: unknown;
  baseUnitCost?: unknown;
  repasseUnitCost?: unknown;
};

function buildProductsTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(productsTable.tenantId, tenantId), isNull(productsTable.tenantId), eq(productsTable.tenantId, ""));
  }

  return eq(productsTable.tenantId, tenantId);
}

function getLoja1SourceProductId(productId: string, filialTenantId: string): string | null {
  const prefix = `loja1sync_${filialTenantId}_`;
  return productId.startsWith(prefix) ? productId.slice(prefix.length).trim() || null : null;
}

function parseSnapshotItems(raw: unknown): SnapshotItem[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  return list
    .map((item) => ({
      productId: String((item as { productId?: unknown })?.productId || "").trim(),
      productName: String((item as { productName?: unknown })?.productName || "Produto").trim() || "Produto",
      quantity: Number((item as { quantity?: unknown })?.quantity || 0),
      saleUnitPrice: Number((item as { saleUnitPrice?: unknown })?.saleUnitPrice || 0),
      baseUnitCost: (() => {
        const raw = Number((item as { baseUnitCost?: unknown })?.baseUnitCost);
        return Number.isFinite(raw) && raw >= 0 ? raw : null;
      })(),
      repasseUnitCost: Number((item as { repasseUnitCost?: unknown })?.repasseUnitCost || 0),
    }))
    .filter((item) => item.productId && Number.isFinite(item.quantity) && item.quantity > 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function buildManualOrderRef(tenantId: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const shortTenant = String(tenantId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase() || "FILIAL";
  return `MANUAL-${shortTenant}-${y}${m}${d}-${hh}${mm}-${suffix}`;
}

function parseDateInput(value: unknown): string | null {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function buildSupplierBatchLabel(fromDate: string | null, toDate: string | null): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const period = fromDate && toDate
    ? `${fromDate} a ${toDate}`
    : fromDate
      ? `${fromDate}`
      : toDate
        ? `${toDate}`
        : now.toISOString().slice(0, 10);
  return `Lote ${period} ${hh}:${mm}`;
}

function readUpdateProductCostFlag(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as { updateProductCost?: unknown }).updateProductCost;
  return typeof value === "boolean" ? value : null;
}

function ensureDefaultTenantScope(req: Parameters<typeof router.get>[1] extends (req: infer R, _res: infer _S) => unknown ? R : never, res: Parameters<typeof router.get>[1] extends (_req: infer _R, res: infer S) => unknown ? S : never): boolean {
  const scope = getAdminScope(req as never);
  const tenantId = String(scope?.tenantId || "").trim() || DEFAULT_TENANT_ID;
  if (tenantId !== DEFAULT_TENANT_ID) {
    (res as any).status(403).json({
      error: "FORBIDDEN",
      message: "Gestão de compras das filiais disponível apenas para a Loja 1.",
    });
    return false;
  }
  return true;
}

async function backfillFilialPaidOrdersQueue(tenantId: string): Promise<void> {
  const paidStatuses = ["paid", "completed", "pago", "finalizado"];
  const candidates = await db
    .select({
      id: ordersTable.id,
      updatedAt: ordersTable.updatedAt,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.tenantId, tenantId),
      inArray(ordersTable.status, paidStatuses),
    ))
    .orderBy(desc(ordersTable.updatedAt), desc(ordersTable.createdAt))
    .limit(250);

  for (const row of candidates) {
    const orderId = String(row.id || "").trim();
    if (!orderId) continue;
    try {
      await enqueueFilialOrderPurchaseRequest(orderId);
    } catch (err) {
      console.warn("[FilialPurchases] backfill enqueue failed:", orderId, err);
    }
  }
}

async function restoreCancelledBatchedRequestsForTenant(tenantId: string): Promise<void> {
  const rows = await db
    .select({
      id: filialPurchaseRequestsTable.id,
      orderId: filialPurchaseRequestsTable.orderId,
      supplierBatchId: filialPurchaseRequestsTable.supplierBatchId,
    })
    .from(filialPurchaseRequestsTable)
    .where(and(
      eq(filialPurchaseRequestsTable.filialTenantId, tenantId),
      eq(filialPurchaseRequestsTable.status, "cancelado"),
      sql`${filialPurchaseRequestsTable.supplierBatchId} IS NOT NULL`,
      sql`${filialPurchaseRequestsTable.supplierBatchId} <> ''`,
    ))
    .limit(250);

  for (const row of rows) {
    const requestId = String(row.id || "").trim();
    if (!requestId) continue;

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "aguardando_compra_loja1",
        supplierBatchId: null,
        supplierBatchLabel: null,
        supplierBatchSentAt: null,
        supplierBatchReceivedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(filialPurchaseRequestsTable.id, requestId));

    await addAudit({
      requestId,
      action: "auto_restaurado_para_filial",
      payload: {
        reason: "cancelado_em_lote_restaurado_para_relancamento",
        orderId: String(row.orderId || "").trim() || null,
        tenantId,
      },
    });
  }
}

async function addAudit(params: {
  requestId: string;
  action: string;
  actorUsername?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(filialPurchaseRequestAuditsTable).values({
    id: `fpra_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-6)}`,
    requestId: params.requestId,
    action: params.action,
    actorUsername: params.actorUsername || null,
    payload: params.payload || null,
    createdAt: new Date(),
  });
}

router.get("/admin/filial-purchases", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const statusParam = String(req.query.status || "pending").trim().toLowerCase();
    const filialTenantIdParam = String(req.query.filialTenantId || req.query.tenantId || "").trim();
    const pendingStatuses = ["pendente_pagamento_filial", "pago_na_filial", "aguardando_compra_loja1", "lote_enviado_loja1", "lote_recebido_loja1", "enviado_motoboy", "compra_registrada", "estoque_lancado_filial"];

    const statusWhere = statusParam === "all"
      ? sql`1 = 1`
      : statusParam === "finalized"
        ? eq(filialPurchaseRequestsTable.status, "finalizado")
        : inArray(filialPurchaseRequestsTable.status, pendingStatuses);

    const listWhere = filialTenantIdParam
      ? and(statusWhere, eq(filialPurchaseRequestsTable.filialTenantId, filialTenantIdParam))
      : statusWhere;

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        filialTenantId: filialPurchaseRequestsTable.filialTenantId,
        orderId: filialPurchaseRequestsTable.orderId,
        orderNumber: ordersTable.orderNumber,
        status: filialPurchaseRequestsTable.status,
        supplierBatchId: filialPurchaseRequestsTable.supplierBatchId,
        supplierBatchLabel: filialPurchaseRequestsTable.supplierBatchLabel,
        supplierBatchSentAt: filialPurchaseRequestsTable.supplierBatchSentAt,
        supplierBatchReceivedAt: filialPurchaseRequestsTable.supplierBatchReceivedAt,
        clientName: filialPurchaseRequestsTable.clientName,
        addressStreet: ordersTable.addressStreet,
        addressNumber: ordersTable.addressNumber,
        addressNeighborhood: ordersTable.addressNeighborhood,
        addressComplement: ordersTable.addressComplement,
        addressCity: ordersTable.addressCity,
        addressState: ordersTable.addressState,
        addressCep: ordersTable.addressCep,
        orderTotal: filialPurchaseRequestsTable.orderTotal,
        repasseTotal: filialPurchaseRequestsTable.repasseTotal,
        itemsSnapshot: filialPurchaseRequestsTable.itemsSnapshot,
        costsSnapshot: filialPurchaseRequestsTable.costsSnapshot,
        loja1RealCostTotal: filialPurchaseRequestsTable.loja1RealCostTotal,
        loja1RealProfit: filialPurchaseRequestsTable.loja1RealProfit,
        purchaseRecordedAt: filialPurchaseRequestsTable.purchaseRecordedAt,
        stockLaunchedAt: filialPurchaseRequestsTable.stockLaunchedAt,
        finalizedAt: filialPurchaseRequestsTable.finalizedAt,
        createdAt: filialPurchaseRequestsTable.createdAt,
        updatedAt: filialPurchaseRequestsTable.updatedAt,
        tenantName: tenantsTable.name,
      })
      .from(filialPurchaseRequestsTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, filialPurchaseRequestsTable.filialTenantId))
      .leftJoin(ordersTable, and(
        eq(ordersTable.id, filialPurchaseRequestsTable.orderId),
        eq(ordersTable.tenantId, filialPurchaseRequestsTable.filialTenantId),
      ))
      .where(listWhere)
      .orderBy(asc(filialPurchaseRequestsTable.createdAt));

    const requestIds = rows.map((row) => row.id).filter(Boolean);
    const purchaseAudits = requestIds.length > 0
      ? await db
        .select({
          requestId: filialPurchaseRequestAuditsTable.requestId,
          payload: filialPurchaseRequestAuditsTable.payload,
          createdAt: filialPurchaseRequestAuditsTable.createdAt,
        })
        .from(filialPurchaseRequestAuditsTable)
        .where(and(
          inArray(filialPurchaseRequestAuditsTable.requestId, requestIds),
          inArray(filialPurchaseRequestAuditsTable.action, ["compra_registrada", "update_product_cost_flag"]),
        ))
        .orderBy(asc(filialPurchaseRequestAuditsTable.createdAt))
      : [];

    const updateCostByRequestId = new Map<string, boolean>();
    for (const audit of purchaseAudits) {
      const requestId = String(audit.requestId || "").trim();
      if (!requestId) continue;
      const flag = readUpdateProductCostFlag(audit.payload);
      if (flag == null) continue;
      updateCostByRequestId.set(requestId, flag);
    }

    res.json({
      requests: rows.map((row) => ({
        id: row.id,
        filialTenantId: row.filialTenantId,
        filialTenantName: row.tenantName || row.filialTenantId,
        orderId: row.orderId,
        orderNumber: Number(row.orderNumber || 0) || null,
        status: row.status,
        supplierBatchId: row.supplierBatchId || null,
        supplierBatchLabel: row.supplierBatchLabel || null,
        supplierBatchSentAt: row.supplierBatchSentAt?.toISOString() || null,
        supplierBatchReceivedAt: row.supplierBatchReceivedAt?.toISOString() || null,
        clientName: row.clientName,
        addressStreet: row.addressStreet || null,
        addressNumber: row.addressNumber || null,
        addressNeighborhood: row.addressNeighborhood || null,
        addressComplement: row.addressComplement || null,
        addressCity: row.addressCity || null,
        addressState: row.addressState || null,
        addressCep: row.addressCep || null,
        orderTotal: Number(row.orderTotal || 0),
        repasseTotal: Number(row.repasseTotal || 0),
        items: parseSnapshotItems(row.itemsSnapshot),
        costs: parseSnapshotItems(row.costsSnapshot),
        loja1RealCostTotal: Number(row.loja1RealCostTotal || 0),
        loja1RealProfit: Number(row.loja1RealProfit || 0),
        updateProductCost: updateCostByRequestId.has(row.id) ? updateCostByRequestId.get(row.id)! : null,
        purchaseRecordedAt: row.purchaseRecordedAt?.toISOString() || null,
        stockLaunchedAt: row.stockLaunchedAt?.toISOString() || null,
        finalizedAt: row.finalizedAt?.toISOString() || null,
        createdAt: row.createdAt?.toISOString() || null,
        updatedAt: row.updatedAt?.toISOString() || null,
      })),
    });
  } catch (err) {
    console.error("[FilialPurchases] list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar fila de compras das filiais." });
  }
});

router.get("/admin/filial-purchases/my", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = String(scope?.tenantId || "").trim() || DEFAULT_TENANT_ID;
    if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
      res.status(403).json({
        error: "FORBIDDEN",
        message: "Esta visualização está disponível apenas para lojas filiais.",
      });
      return;
    }

    // Self-healing: restore old batched cancellations back to filial relaunch queue.
    await restoreCancelledBatchedRequestsForTenant(tenantId);

    // Self-healing: ensure paid orders that missed prior enqueue become visible to the filial queue.
    await backfillFilialPaidOrdersQueue(tenantId);

    const statusParam = String(req.query.status || "pending").trim().toLowerCase();
    const pendingStatuses = ["pendente_pagamento_filial", "pago_na_filial", "aguardando_compra_loja1", "lote_enviado_loja1", "lote_recebido_loja1", "enviado_motoboy", "compra_registrada", "estoque_lancado_filial"];

    const statusWhere = statusParam === "all"
      ? sql`1 = 1`
      : statusParam === "finalized"
        ? eq(filialPurchaseRequestsTable.status, "finalizado")
        : inArray(filialPurchaseRequestsTable.status, pendingStatuses);

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        filialTenantId: filialPurchaseRequestsTable.filialTenantId,
        orderId: filialPurchaseRequestsTable.orderId,
        orderNumber: ordersTable.orderNumber,
        status: filialPurchaseRequestsTable.status,
        supplierBatchId: filialPurchaseRequestsTable.supplierBatchId,
        supplierBatchLabel: filialPurchaseRequestsTable.supplierBatchLabel,
        supplierBatchSentAt: filialPurchaseRequestsTable.supplierBatchSentAt,
        supplierBatchReceivedAt: filialPurchaseRequestsTable.supplierBatchReceivedAt,
        clientName: filialPurchaseRequestsTable.clientName,
        addressStreet: ordersTable.addressStreet,
        addressNumber: ordersTable.addressNumber,
        addressNeighborhood: ordersTable.addressNeighborhood,
        addressComplement: ordersTable.addressComplement,
        addressCity: ordersTable.addressCity,
        addressState: ordersTable.addressState,
        addressCep: ordersTable.addressCep,
        orderTotal: filialPurchaseRequestsTable.orderTotal,
        repasseTotal: filialPurchaseRequestsTable.repasseTotal,
        itemsSnapshot: filialPurchaseRequestsTable.itemsSnapshot,
        costsSnapshot: filialPurchaseRequestsTable.costsSnapshot,
        loja1RealCostTotal: filialPurchaseRequestsTable.loja1RealCostTotal,
        loja1RealProfit: filialPurchaseRequestsTable.loja1RealProfit,
        purchaseRecordedAt: filialPurchaseRequestsTable.purchaseRecordedAt,
        stockLaunchedAt: filialPurchaseRequestsTable.stockLaunchedAt,
        finalizedAt: filialPurchaseRequestsTable.finalizedAt,
        createdAt: filialPurchaseRequestsTable.createdAt,
        updatedAt: filialPurchaseRequestsTable.updatedAt,
        tenantName: tenantsTable.name,
      })
      .from(filialPurchaseRequestsTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, filialPurchaseRequestsTable.filialTenantId))
      .leftJoin(ordersTable, and(
        eq(ordersTable.id, filialPurchaseRequestsTable.orderId),
        eq(ordersTable.tenantId, filialPurchaseRequestsTable.filialTenantId),
      ))
      .where(and(statusWhere, eq(filialPurchaseRequestsTable.filialTenantId, tenantId)))
      .orderBy(asc(filialPurchaseRequestsTable.createdAt));

    const requestIds = rows.map((row) => row.id).filter(Boolean);
    const purchaseAudits = requestIds.length > 0
      ? await db
        .select({
          requestId: filialPurchaseRequestAuditsTable.requestId,
          payload: filialPurchaseRequestAuditsTable.payload,
          createdAt: filialPurchaseRequestAuditsTable.createdAt,
        })
        .from(filialPurchaseRequestAuditsTable)
        .where(and(
          inArray(filialPurchaseRequestAuditsTable.requestId, requestIds),
          inArray(filialPurchaseRequestAuditsTable.action, ["compra_registrada", "update_product_cost_flag"]),
        ))
        .orderBy(asc(filialPurchaseRequestAuditsTable.createdAt))
      : [];

    const updateCostByRequestId = new Map<string, boolean>();
    for (const audit of purchaseAudits) {
      const requestId = String(audit.requestId || "").trim();
      if (!requestId) continue;
      const flag = readUpdateProductCostFlag(audit.payload);
      if (flag == null) continue;
      updateCostByRequestId.set(requestId, flag);
    }

    res.json({
      requests: rows.map((row) => ({
        id: row.id,
        filialTenantId: row.filialTenantId,
        filialTenantName: row.tenantName || row.filialTenantId,
        orderId: row.orderId,
        orderNumber: Number(row.orderNumber || 0) || null,
        status: row.status,
        supplierBatchId: row.supplierBatchId || null,
        supplierBatchLabel: row.supplierBatchLabel || null,
        supplierBatchSentAt: row.supplierBatchSentAt?.toISOString() || null,
        supplierBatchReceivedAt: row.supplierBatchReceivedAt?.toISOString() || null,
        clientName: row.clientName,
        addressStreet: row.addressStreet || null,
        addressNumber: row.addressNumber || null,
        addressNeighborhood: row.addressNeighborhood || null,
        addressComplement: row.addressComplement || null,
        addressCity: row.addressCity || null,
        addressState: row.addressState || null,
        addressCep: row.addressCep || null,
        orderTotal: Number(row.orderTotal || 0),
        repasseTotal: Number(row.repasseTotal || 0),
        items: parseSnapshotItems(row.itemsSnapshot),
        costs: parseSnapshotItems(row.costsSnapshot),
        loja1RealCostTotal: Number(row.loja1RealCostTotal || 0),
        loja1RealProfit: Number(row.loja1RealProfit || 0),
        updateProductCost: updateCostByRequestId.has(row.id) ? updateCostByRequestId.get(row.id)! : null,
        purchaseRecordedAt: row.purchaseRecordedAt?.toISOString() || null,
        stockLaunchedAt: row.stockLaunchedAt?.toISOString() || null,
        finalizedAt: row.finalizedAt?.toISOString() || null,
        createdAt: row.createdAt?.toISOString() || null,
        updatedAt: row.updatedAt?.toISOString() || null,
      })),
    });
  } catch (err) {
    console.error("[FilialPurchases] my list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar pedidos de compra da filial." });
  }
});

router.post("/admin/filial-purchases/my/launch-batch", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = String(scope?.tenantId || "").trim() || DEFAULT_TENANT_ID;
    if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
      res.status(403).json({
        error: "FORBIDDEN",
        message: "Somente a filial pode lançar lote para fornecedor.",
      });
      return;
    }

    const actorUsername = String(scope?.username || "").trim() || null;
    const fromDate = parseDateInput(req.body?.fromDate);
    const toDate = parseDateInput(req.body?.toDate);
    const requestIdsInput = Array.isArray(req.body?.requestIds) ? req.body.requestIds : [];
    const requestIds = Array.from(new Set(
      requestIdsInput
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ));

    if (requestIds.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Selecione ao menos um pedido pago para lançar no lote." });
      return;
    }

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        orderId: filialPurchaseRequestsTable.orderId,
        status: filialPurchaseRequestsTable.status,
        createdAt: filialPurchaseRequestsTable.createdAt,
        supplierBatchId: filialPurchaseRequestsTable.supplierBatchId,
      })
      .from(filialPurchaseRequestsTable)
      .where(and(
        eq(filialPurchaseRequestsTable.filialTenantId, tenantId),
        inArray(filialPurchaseRequestsTable.id, requestIds),
      ));

    if (rows.length !== requestIds.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Um ou mais pedidos selecionados não foram encontrados na filial." });
      return;
    }

    const eligibleStatuses = new Set(["aguardando_compra_loja1", "pago_na_filial"]);
    const invalidStatusRow = rows.find((row) => !eligibleStatuses.has(String(row.status || "").trim().toLowerCase()));
    if (invalidStatusRow) {
      res.status(409).json({
        error: "INVALID_STATE",
        message: `O pedido ${invalidStatusRow.orderId} não está elegível para lançamento em lote.`,
      });
      return;
    }

    const alreadyBatched = rows.find((row) => String(row.supplierBatchId || "").trim());
    if (alreadyBatched) {
      res.status(409).json({
        error: "ALREADY_BATCHED",
        message: `O pedido ${alreadyBatched.orderId} já foi lançado em lote.`,
      });
      return;
    }

    const fromTs = fromDate ? Date.parse(`${fromDate}T00:00:00.000Z`) : null;
    const toTs = toDate ? Date.parse(`${toDate}T23:59:59.999Z`) : null;
    const outOfRange = rows.find((row) => {
      const createdAtTs = Date.parse(String(row.createdAt || ""));
      if (!Number.isFinite(createdAtTs)) return false;
      if (fromTs != null && createdAtTs < fromTs) return true;
      if (toTs != null && createdAtTs > toTs) return true;
      return false;
    });

    if (outOfRange) {
      res.status(409).json({
        error: "INVALID_RANGE",
        message: `O pedido ${outOfRange.orderId} está fora do período selecionado.`,
      });
      return;
    }

    const batchId = randomId("fpl");
    const batchLabel = buildSupplierBatchLabel(fromDate, toDate);
    const now = new Date();

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "lote_enviado_loja1",
        supplierBatchId: batchId,
        supplierBatchLabel: batchLabel,
        supplierBatchSentAt: now,
        updatedByAdmin: actorUsername,
        updatedAt: now,
      })
      .where(and(
        eq(filialPurchaseRequestsTable.filialTenantId, tenantId),
        inArray(filialPurchaseRequestsTable.id, requestIds),
      ));

    for (const row of rows) {
      await addAudit({
        requestId: row.id,
        action: "lote_enviado_loja1",
        actorUsername,
        payload: {
          filialTenantId: tenantId,
          orderId: row.orderId,
          batchId,
          batchLabel,
          fromDate,
          toDate,
        },
      });
    }

    res.json({
      ok: true,
      batchId,
      batchLabel,
      status: "lote_enviado_loja1",
      requestIds,
      count: requestIds.length,
    });
  } catch (err) {
    console.error("[FilialPurchases] launch-batch error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao lançar lote para fornecedor." });
  }
});

router.post("/admin/filial-purchases/my/launch-motoboy", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = String(scope?.tenantId || "").trim() || DEFAULT_TENANT_ID;
    if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
      res.status(403).json({
        error: "FORBIDDEN",
        message: "Somente a filial pode enviar pedidos para motoboy.",
      });
      return;
    }

    const actorUsername = String(scope?.username || "").trim() || null;
    const fromDate = parseDateInput(req.body?.fromDate);
    const toDate = parseDateInput(req.body?.toDate);
    const requestIdsInput = Array.isArray(req.body?.requestIds) ? req.body.requestIds : [];
    const requestIds = Array.from(new Set(
      requestIdsInput
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ));

    if (requestIds.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Selecione ao menos um pedido elegível para enviar ao motoboy." });
      return;
    }

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        orderId: filialPurchaseRequestsTable.orderId,
        status: filialPurchaseRequestsTable.status,
        createdAt: filialPurchaseRequestsTable.createdAt,
        supplierBatchId: filialPurchaseRequestsTable.supplierBatchId,
      })
      .from(filialPurchaseRequestsTable)
      .where(and(
        eq(filialPurchaseRequestsTable.filialTenantId, tenantId),
        inArray(filialPurchaseRequestsTable.id, requestIds),
      ));

    if (rows.length !== requestIds.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Um ou mais pedidos selecionados não foram encontrados na filial." });
      return;
    }

    const eligibleStatuses = new Set(["aguardando_compra_loja1", "pago_na_filial"]);
    const invalidStatusRow = rows.find((row) => !eligibleStatuses.has(String(row.status || "").trim().toLowerCase()));
    if (invalidStatusRow) {
      res.status(409).json({
        error: "INVALID_STATE",
        message: `O pedido ${invalidStatusRow.orderId} não está elegível para envio ao motoboy.`,
      });
      return;
    }

    const alreadyBatched = rows.find((row) => String(row.supplierBatchId || "").trim());
    if (alreadyBatched) {
      res.status(409).json({
        error: "ALREADY_BATCHED",
        message: `O pedido ${alreadyBatched.orderId} já está em um lote da Loja 1.`,
      });
      return;
    }

    const fromTs = fromDate ? Date.parse(`${fromDate}T00:00:00.000Z`) : null;
    const toTs = toDate ? Date.parse(`${toDate}T23:59:59.999Z`) : null;
    const outOfRange = rows.find((row) => {
      const createdAtTs = Date.parse(String(row.createdAt || ""));
      if (!Number.isFinite(createdAtTs)) return false;
      if (fromTs != null && createdAtTs < fromTs) return true;
      if (toTs != null && createdAtTs > toTs) return true;
      return false;
    });

    if (outOfRange) {
      res.status(409).json({
        error: "INVALID_RANGE",
        message: `O pedido ${outOfRange.orderId} está fora do período selecionado.`,
      });
      return;
    }

    const now = new Date();
    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "enviado_motoboy",
        supplierBatchId: null,
        supplierBatchLabel: null,
        supplierBatchSentAt: null,
        supplierBatchReceivedAt: null,
        updatedByAdmin: actorUsername,
        updatedAt: now,
      })
      .where(and(
        eq(filialPurchaseRequestsTable.filialTenantId, tenantId),
        inArray(filialPurchaseRequestsTable.id, requestIds),
      ));

    for (const row of rows) {
      await addAudit({
        requestId: row.id,
        action: "enviado_motoboy",
        actorUsername,
        payload: {
          filialTenantId: tenantId,
          orderId: row.orderId,
          fromDate,
          toDate,
        },
      });
    }

    res.json({
      ok: true,
      status: "enviado_motoboy",
      requestIds,
      count: requestIds.length,
    });
  } catch (err) {
    console.error("[FilialPurchases] launch-motoboy error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao enviar pedidos para motoboy." });
  }
});

router.post("/admin/filial-purchases/my/mark-order-motoboy", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = String(scope?.tenantId || "").trim() || DEFAULT_TENANT_ID;
    if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
      res.status(403).json({
        error: "FORBIDDEN",
        message: "Somente a filial pode marcar pedido para motoboy.",
      });
      return;
    }

    const actorUsername = String(scope?.username || "").trim() || null;
    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Pedido inválido para marcação de motoboy." });
      return;
    }

    const orderRows = await db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
      })
      .from(ordersTable)
      .where(and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.tenantId, tenantId),
      ))
      .limit(1);

    const orderRow = orderRows[0];
    if (!orderRow) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado na filial." });
      return;
    }

    const orderStatus = String(orderRow.status || "").trim().toLowerCase();
    if (orderStatus !== "paid" && orderStatus !== "completed") {
      res.status(409).json({
        error: "PAYMENT_PENDING",
        message: "Marque o pedido como pago antes de enviar para motoboy.",
      });
      return;
    }

    await enqueueFilialOrderPurchaseRequest(orderId);

    const requestRows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        status: filialPurchaseRequestsTable.status,
        supplierBatchId: filialPurchaseRequestsTable.supplierBatchId,
      })
      .from(filialPurchaseRequestsTable)
      .where(and(
        eq(filialPurchaseRequestsTable.orderId, orderId),
        eq(filialPurchaseRequestsTable.filialTenantId, tenantId),
      ))
      .limit(1);

    const requestRow = requestRows[0];
    if (!requestRow) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compra da filial não encontrada para este pedido." });
      return;
    }

    const requestStatus = String(requestRow.status || "").trim().toLowerCase();
    if (requestStatus === "enviado_motoboy") {
      res.json({ ok: true, idempotent: true, orderId, requestId: requestRow.id, status: "enviado_motoboy" });
      return;
    }

    if (String(requestRow.supplierBatchId || "").trim()) {
      res.status(409).json({
        error: "ALREADY_BATCHED",
        message: "Esse pedido já foi lançado para compra com fornecedor.",
      });
      return;
    }

    const allowedStatuses = new Set(["aguardando_compra_loja1", "pago_na_filial", "cancelado", "pendente_pagamento_filial"]);
    if (!allowedStatuses.has(requestStatus)) {
      res.status(409).json({
        error: "INVALID_STATE",
        message: "Esse pedido não está elegível para marcação de motoboy.",
      });
      return;
    }

    const now = new Date();
    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "enviado_motoboy",
        supplierBatchId: null,
        supplierBatchLabel: null,
        supplierBatchSentAt: null,
        supplierBatchReceivedAt: null,
        updatedByAdmin: actorUsername,
        updatedAt: now,
      })
      .where(eq(filialPurchaseRequestsTable.id, requestRow.id));

    await addAudit({
      requestId: requestRow.id,
      action: "enviado_motoboy",
      actorUsername,
      payload: {
        source: "pedido_marcar_motoboy_direto",
        tenantId,
        orderId,
      },
    });

    res.json({ ok: true, orderId, requestId: requestRow.id, status: "enviado_motoboy" });
  } catch (err) {
    console.error("[FilialPurchases] mark-order-motoboy error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao marcar pedido para motoboy." });
  }
});

router.post("/admin/filial-purchases/batches/:batchId/confirm-receipt", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const batchId = String(req.params.batchId || "").trim();
    if (!batchId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Lote inválido." });
      return;
    }

    const scope = getAdminScope(req);
    const actorUsername = String(scope?.username || "").trim() || null;

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        orderId: filialPurchaseRequestsTable.orderId,
        filialTenantId: filialPurchaseRequestsTable.filialTenantId,
        status: filialPurchaseRequestsTable.status,
        supplierBatchReceivedAt: filialPurchaseRequestsTable.supplierBatchReceivedAt,
      })
      .from(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.supplierBatchId, batchId));

    if (rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Lote não encontrado." });
      return;
    }

    const receivableStatuses = new Set(["lote_enviado_loja1", "aguardando_compra_loja1", "pago_na_filial"]);
    const receivableRows = rows.filter((row) => {
      const normalized = String(row.status || "").trim().toLowerCase();
      return receivableStatuses.has(normalized) && !row.supplierBatchReceivedAt;
    });

    if (receivableRows.length === 0) {
      res.json({ ok: true, idempotent: true, batchId, receivedCount: 0 });
      return;
    }

    const receivableIds = receivableRows.map((row) => row.id);
    const now = new Date();

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "lote_recebido_loja1",
        supplierBatchReceivedAt: now,
        updatedByAdmin: actorUsername,
        updatedAt: now,
      })
      .where(inArray(filialPurchaseRequestsTable.id, receivableIds));

    for (const row of receivableRows) {
      await addAudit({
        requestId: row.id,
        action: "lote_recebido_loja1",
        actorUsername,
        payload: {
          batchId,
          filialTenantId: row.filialTenantId,
          orderId: row.orderId,
        },
      });
    }

    res.json({
      ok: true,
      batchId,
      status: "lote_recebido_loja1",
      receivedCount: receivableRows.length,
      requestIds: receivableIds,
    });
  } catch (err) {
    console.error("[FilialPurchases] confirm-batch-receipt error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao confirmar recebimento do lote." });
  }
});

router.post("/admin/filial-purchases/batches/:batchId/revert-receipt", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const batchId = String(req.params.batchId || "").trim();
    if (!batchId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Lote inválido." });
      return;
    }

    const scope = getAdminScope(req);
    const actorUsername = String(scope?.username || "").trim() || null;

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        orderId: filialPurchaseRequestsTable.orderId,
        filialTenantId: filialPurchaseRequestsTable.filialTenantId,
        status: filialPurchaseRequestsTable.status,
      })
      .from(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.supplierBatchId, batchId));

    if (rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Lote não encontrado." });
      return;
    }

    const blockedStatuses = new Set(["compra_registrada", "estoque_lancado_filial", "finalizado", "cancelado"]);
    const blockedRow = rows.find((row) => blockedStatuses.has(String(row.status || "").trim().toLowerCase()));
    if (blockedRow) {
      res.status(409).json({
        error: "INVALID_STATE",
        message: `Não é possível desfazer porque o pedido ${blockedRow.orderId} já avançou no fluxo.`,
      });
      return;
    }

    const revertibleRows = rows.filter((row) => String(row.status || "").trim().toLowerCase() === "lote_recebido_loja1");
    if (revertibleRows.length === 0) {
      res.json({ ok: true, idempotent: true, batchId, revertedCount: 0 });
      return;
    }

    const revertibleIds = revertibleRows.map((row) => row.id);
    const now = new Date();

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "lote_enviado_loja1",
        supplierBatchReceivedAt: null,
        updatedByAdmin: actorUsername,
        updatedAt: now,
      })
      .where(inArray(filialPurchaseRequestsTable.id, revertibleIds));

    for (const row of revertibleRows) {
      await addAudit({
        requestId: row.id,
        action: "lote_recebimento_desfeito_loja1",
        actorUsername,
        payload: {
          batchId,
          filialTenantId: row.filialTenantId,
          orderId: row.orderId,
        },
      });
    }

    res.json({
      ok: true,
      batchId,
      status: "lote_enviado_loja1",
      revertedCount: revertibleRows.length,
      requestIds: revertibleIds,
    });
  } catch (err) {
    console.error("[FilialPurchases] revert-batch-receipt error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao desfazer confirmação do lote." });
  }
});

router.post("/admin/filial-purchases/:requestId/return-to-filial", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Compra inválida." });
      return;
    }

    const scope = getAdminScope(req);
    const actorUsername = String(scope?.username || "").trim() || null;

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        status: filialPurchaseRequestsTable.status,
        orderId: filialPurchaseRequestsTable.orderId,
        filialTenantId: filialPurchaseRequestsTable.filialTenantId,
        supplierBatchId: filialPurchaseRequestsTable.supplierBatchId,
      })
      .from(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.id, requestId))
      .limit(1);

    const requestRow = rows[0];
    if (!requestRow) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compra da filial não encontrada." });
      return;
    }

    if (!String(requestRow.supplierBatchId || "").trim()) {
      res.status(409).json({
        error: "INVALID_STATE",
        message: "Somente pedidos em lote podem ser devolvidos para a filial.",
      });
      return;
    }

    const normalizedStatus = String(requestRow.status || "").trim().toLowerCase();
    const allowedStatuses = new Set(["lote_enviado_loja1", "lote_recebido_loja1", "cancelado"]);
    if (!allowedStatuses.has(normalizedStatus)) {
      res.status(409).json({
        error: "INVALID_STATE",
        message: "Esse pedido já avançou no fluxo e não pode ser devolvido para novo lançamento.",
      });
      return;
    }

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "aguardando_compra_loja1",
        supplierBatchId: null,
        supplierBatchLabel: null,
        supplierBatchSentAt: null,
        supplierBatchReceivedAt: null,
        updatedByAdmin: actorUsername,
        updatedAt: new Date(),
      })
      .where(eq(filialPurchaseRequestsTable.id, requestId));

    await addAudit({
      requestId,
      action: "devolvido_para_filial",
      actorUsername,
      payload: {
        orderId: requestRow.orderId,
        filialTenantId: requestRow.filialTenantId,
        reason: "devolucao_loja1_para_novo_lote",
      },
    });

    res.json({ ok: true, requestId, status: "aguardando_compra_loja1", returnedToFilial: true });
  } catch (err) {
    console.error("[FilialPurchases] return-to-filial error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao devolver pedido para a filial." });
  }
});

router.post("/admin/filial-purchases/manual", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const filialTenantId = String(req.body?.filialTenantId || "").trim();
    const clientName = String(req.body?.clientName || "Compra manual da filial").trim() || "Compra manual da filial";
    const inputItems = Array.isArray(req.body?.items) ? (req.body.items as ManualPurchaseItemInput[]) : [];

    if (!filialTenantId || filialTenantId === DEFAULT_TENANT_ID) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Selecione uma filial válida." });
      return;
    }

    if (inputItems.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Adicione ao menos um produto no pedido." });
      return;
    }

    const filialRows = await db
      .select({ id: tenantsTable.id, name: tenantsTable.name })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, filialTenantId))
      .limit(1);

    const filial = filialRows[0];
    if (!filial) {
      res.status(404).json({ error: "NOT_FOUND", message: "Filial não encontrada." });
      return;
    }

    const normalizedItems = inputItems
      .map((item) => ({
        productId: String(item.productId || "").trim(),
        quantity: Number(item.quantity || 0),
        baseUnitCostRaw: item.baseUnitCost,
        repasseUnitCostRaw: item.repasseUnitCost,
      }))
      .filter((item) => item.productId);

    if (normalizedItems.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Produtos inválidos no pedido." });
      return;
    }

    for (const item of normalizedItems) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        res.status(400).json({ error: "INVALID_INPUT", message: `Quantidade inválida para o produto ${item.productId}.` });
        return;
      }
    }

    const productIds = Array.from(new Set(normalizedItems.map((item) => item.productId)));
    const productRows = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        price: productsTable.price,
        costPrice: productsTable.costPrice,
      })
      .from(productsTable)
      .where(and(buildProductsTenantWhere(filialTenantId), inArray(productsTable.id, productIds)));

    const productsById = new Map(productRows.map((row) => [row.id, row]));
    for (const productId of productIds) {
      if (!productsById.has(productId)) {
        res.status(400).json({ error: "INVALID_INPUT", message: `Produto ${productId} não encontrado na filial selecionada.` });
        return;
      }
    }

    const grouped = new Map<string, SnapshotItem>();
    for (const item of normalizedItems) {
      const product = productsById.get(item.productId)!;
      const quantity = Number(item.quantity);
      const saleUnitPrice = Number(product.price || 0);
      const defaultBase = Number(product.costPrice || 0);
      const inputBase = Number(item.baseUnitCostRaw);
      const baseUnitCost = Number.isFinite(inputBase) && inputBase >= 0 ? inputBase : defaultBase;
      const defaultRepasse = Number(product.costPrice || 0);
      const inputRepasse = Number(item.repasseUnitCostRaw);
      const repasseUnitCost = Number.isFinite(inputRepasse) && inputRepasse >= 0 ? inputRepasse : defaultRepasse;

      const existing = grouped.get(item.productId);
      if (!existing) {
        grouped.set(item.productId, {
          productId: item.productId,
          productName: String(product.name || "Produto"),
          quantity,
          saleUnitPrice,
          baseUnitCost,
          repasseUnitCost,
        });
        continue;
      }

      const nextQty = existing.quantity + quantity;
      const weightedSale = nextQty > 0
        ? ((existing.saleUnitPrice * existing.quantity) + (saleUnitPrice * quantity)) / nextQty
        : existing.saleUnitPrice;
      const weightedBase = nextQty > 0
        ? ((Number(existing.baseUnitCost || 0) * existing.quantity) + (baseUnitCost * quantity)) / nextQty
        : Number(existing.baseUnitCost || 0);
      const weightedRepasse = nextQty > 0
        ? ((existing.repasseUnitCost * existing.quantity) + (repasseUnitCost * quantity)) / nextQty
        : existing.repasseUnitCost;

      grouped.set(item.productId, {
        ...existing,
        quantity: nextQty,
        saleUnitPrice: weightedSale,
        baseUnitCost: weightedBase,
        repasseUnitCost: weightedRepasse,
      });
    }

    const itemsSnapshot = Array.from(grouped.values());
    const repasseTotal = round2(itemsSnapshot.reduce((sum, item) => sum + (item.repasseUnitCost * item.quantity), 0));
    const requestId = randomId("fpr");
    const orderId = buildManualOrderRef(filialTenantId);
    const scope = getAdminScope(req);
    const actorUsername = String(scope?.username || "").trim() || null;

    await db.insert(filialPurchaseRequestsTable).values({
      id: requestId,
      filialTenantId,
      orderId,
      status: "pendente_pagamento_filial",
      clientName,
      orderTotal: String(repasseTotal),
      repasseTotal: String(repasseTotal),
      itemsSnapshot,
      createdByAdmin: actorUsername,
      updatedByAdmin: actorUsername,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await addAudit({
      requestId,
      action: "pendente_pagamento_filial",
      actorUsername,
      payload: {
        source: "manual_loja1",
        filialTenantId,
        filialTenantName: filial.name,
        orderId,
        repasseTotal,
      },
    });

    res.status(201).json({
      ok: true,
      requestId,
      orderId,
      filialTenantId,
      status: "pendente_pagamento_filial",
      repasseTotal,
    });
  } catch (err) {
    console.error("[FilialPurchases] manual create error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao gerar pedido manual da filial." });
  }
});

router.patch("/admin/filial-purchases/:requestId/manual", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Compra inválida." });
      return;
    }

    const scope = getAdminScope(req);
    const actorUsername = String(scope?.username || "").trim() || null;

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        status: filialPurchaseRequestsTable.status,
        filialTenantId: filialPurchaseRequestsTable.filialTenantId,
        orderId: filialPurchaseRequestsTable.orderId,
        clientName: filialPurchaseRequestsTable.clientName,
      })
      .from(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.id, requestId))
      .limit(1);

    const requestRow = rows[0];
    if (!requestRow) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compra da filial não encontrada." });
      return;
    }

    if (String(requestRow.status || "").trim().toLowerCase() !== "pendente_pagamento_filial") {
      res.status(409).json({
        error: "INVALID_STATE",
        message: "Só é possível editar pedidos manuais pendentes de pagamento da filial.",
      });
      return;
    }

    const orderId = String(requestRow.orderId || "").trim().toUpperCase();
    if (!orderId.startsWith("MANUAL-")) {
      res.status(409).json({
        error: "INVALID_STATE",
        message: "A edição está disponível apenas para pedidos manuais da Loja 1.",
      });
      return;
    }

    const clientName = String(req.body?.clientName || requestRow.clientName || "Compra manual da filial").trim() || "Compra manual da filial";
    const inputItems = Array.isArray(req.body?.items) ? (req.body.items as ManualPurchaseItemInput[]) : [];

    if (inputItems.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Adicione ao menos um produto no pedido." });
      return;
    }

    const normalizedItems = inputItems
      .map((item) => ({
        productId: String(item.productId || "").trim(),
        quantity: Number(item.quantity || 0),
        baseUnitCostRaw: item.baseUnitCost,
        repasseUnitCostRaw: item.repasseUnitCost,
      }))
      .filter((item) => item.productId);

    if (normalizedItems.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Produtos inválidos no pedido." });
      return;
    }

    for (const item of normalizedItems) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        res.status(400).json({ error: "INVALID_INPUT", message: `Quantidade inválida para o produto ${item.productId}.` });
        return;
      }
    }

    const productIds = Array.from(new Set(normalizedItems.map((item) => item.productId)));
    const productRows = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        price: productsTable.price,
        costPrice: productsTable.costPrice,
      })
      .from(productsTable)
      .where(and(buildProductsTenantWhere(requestRow.filialTenantId), inArray(productsTable.id, productIds)));

    const productsById = new Map(productRows.map((row) => [row.id, row]));
    for (const productId of productIds) {
      if (!productsById.has(productId)) {
        res.status(400).json({ error: "INVALID_INPUT", message: `Produto ${productId} não encontrado na filial selecionada.` });
        return;
      }
    }

    const grouped = new Map<string, SnapshotItem>();
    for (const item of normalizedItems) {
      const product = productsById.get(item.productId)!;
      const quantity = Number(item.quantity);
      const saleUnitPrice = Number(product.price || 0);
      const defaultBase = Number(product.costPrice || 0);
      const inputBase = Number(item.baseUnitCostRaw);
      const baseUnitCost = Number.isFinite(inputBase) && inputBase >= 0 ? inputBase : defaultBase;
      const defaultRepasse = Number(product.costPrice || 0);
      const inputRepasse = Number(item.repasseUnitCostRaw);
      const repasseUnitCost = Number.isFinite(inputRepasse) && inputRepasse >= 0 ? inputRepasse : defaultRepasse;

      const existing = grouped.get(item.productId);
      if (!existing) {
        grouped.set(item.productId, {
          productId: item.productId,
          productName: String(product.name || "Produto"),
          quantity,
          saleUnitPrice,
          baseUnitCost,
          repasseUnitCost,
        });
        continue;
      }

      const nextQty = existing.quantity + quantity;
      const weightedSale = nextQty > 0
        ? ((existing.saleUnitPrice * existing.quantity) + (saleUnitPrice * quantity)) / nextQty
        : existing.saleUnitPrice;
      const weightedBase = nextQty > 0
        ? ((Number(existing.baseUnitCost || 0) * existing.quantity) + (baseUnitCost * quantity)) / nextQty
        : Number(existing.baseUnitCost || 0);
      const weightedRepasse = nextQty > 0
        ? ((existing.repasseUnitCost * existing.quantity) + (repasseUnitCost * quantity)) / nextQty
        : existing.repasseUnitCost;

      grouped.set(item.productId, {
        ...existing,
        quantity: nextQty,
        saleUnitPrice: weightedSale,
        baseUnitCost: weightedBase,
        repasseUnitCost: weightedRepasse,
      });
    }

    const itemsSnapshot = Array.from(grouped.values());
    const repasseTotal = round2(itemsSnapshot.reduce((sum, item) => sum + (item.repasseUnitCost * item.quantity), 0));

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        clientName,
        itemsSnapshot,
        orderTotal: String(repasseTotal),
        repasseTotal: String(repasseTotal),
        updatedByAdmin: actorUsername,
        updatedAt: new Date(),
      })
      .where(eq(filialPurchaseRequestsTable.id, requestId));

    await addAudit({
      requestId,
      action: "manual_editado_loja1",
      actorUsername,
      payload: {
        orderId: requestRow.orderId,
        clientName,
        repasseTotal,
        itemsCount: itemsSnapshot.length,
      },
    });

    res.json({
      ok: true,
      requestId,
      status: "pendente_pagamento_filial",
      repasseTotal,
      orderTotal: repasseTotal,
      clientName,
      items: itemsSnapshot,
    });
  } catch (err) {
    console.error("[FilialPurchases] manual edit error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao editar pedido manual da filial." });
  }
});

router.post("/admin/filial-purchases/:requestId/update-cost-flag", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Compra inválida." });
      return;
    }

    const updateProductCost = req.body?.updateProductCost === true;
    const scope = getAdminScope(req);
    const actorUsername = String(scope?.username || "").trim() || null;

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        filialTenantId: filialPurchaseRequestsTable.filialTenantId,
        orderId: filialPurchaseRequestsTable.orderId,
        itemsSnapshot: filialPurchaseRequestsTable.itemsSnapshot,
      })
      .from(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.id, requestId))
      .limit(1);

    const requestRow = rows[0];
    if (!requestRow) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compra da filial não encontrada." });
      return;
    }

    await addAudit({
      requestId,
      action: "update_product_cost_flag",
      actorUsername,
      payload: {
        updateProductCost,
        appliedProductCostUpdates: 0,
        filialTenantId: requestRow.filialTenantId,
        orderId: requestRow.orderId,
      },
    });

    res.json({ ok: true, requestId, updateProductCost, appliedProductCostUpdates: 0 });
  } catch (err) {
    console.error("[FilialPurchases] update-cost-flag error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar opção de atualizar custo do produto." });
  }
});

router.post("/admin/filial-purchases/:requestId/mark-paid", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Compra inválida." });
      return;
    }

    const scope = getAdminScope(req);
    const actorUsername = String(scope?.username || "").trim() || null;

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        status: filialPurchaseRequestsTable.status,
        filialTenantId: filialPurchaseRequestsTable.filialTenantId,
        orderId: filialPurchaseRequestsTable.orderId,
      })
      .from(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.id, requestId))
      .limit(1);

    const requestRow = rows[0];
    if (!requestRow) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compra da filial não encontrada." });
      return;
    }

    if (requestRow.status === "cancelado") {
      res.status(400).json({ error: "INVALID_STATE", message: "Não é possível marcar como pago um pedido cancelado." });
      return;
    }

    if (requestRow.status === "finalizado"
      || requestRow.status === "compra_registrada"
      || requestRow.status === "estoque_lancado_filial"
      || requestRow.status === "aguardando_compra_loja1"
      || requestRow.status === "lote_enviado_loja1"
      || requestRow.status === "lote_recebido_loja1"
      || requestRow.status === "pago_na_filial") {
      res.json({ ok: true, idempotent: true, requestId, status: requestRow.status });
      return;
    }

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "aguardando_compra_loja1",
        updatedByAdmin: actorUsername,
        updatedAt: new Date(),
      })
      .where(eq(filialPurchaseRequestsTable.id, requestId));

    await addAudit({
      requestId,
      action: "pago_na_filial",
      actorUsername,
      payload: {
        source: "manual_mark_paid",
        filialTenantId: requestRow.filialTenantId,
        orderId: requestRow.orderId,
      },
    });

    await addAudit({
      requestId,
      action: "aguardando_compra_loja1",
      actorUsername,
      payload: {
        source: "manual_mark_paid",
        filialTenantId: requestRow.filialTenantId,
        orderId: requestRow.orderId,
      },
    });

    res.json({ ok: true, requestId, status: "aguardando_compra_loja1" });
  } catch (err) {
    console.error("[FilialPurchases] mark-paid error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao marcar pedido como pago na filial." });
  }
});

router.post("/admin/filial-purchases/:requestId/confirm", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Compra inválida." });
      return;
    }

    const scope = getAdminScope(req);
    const actorUsername = String(scope?.username || "").trim() || null;

    const rows = await db
      .select()
      .from(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.id, requestId))
      .limit(1);

    const requestRow = rows[0];
    if (!requestRow) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compra da filial não encontrada." });
      return;
    }

    const wasFinalized = requestRow.status === "finalizado";

    if (requestRow.status === "cancelado") {
      res.status(400).json({ error: "INVALID_STATE", message: "Não é possível confirmar uma compra cancelada." });
      return;
    }

    if (requestRow.status === "pendente_pagamento_filial") {
      res.status(409).json({ error: "PAYMENT_PENDING", message: "Esse pedido ainda está pendente de pagamento da filial." });
      return;
    }

    const snapshotItems = parseSnapshotItems(requestRow.itemsSnapshot);
    if (snapshotItems.length === 0) {
      res.status(400).json({ error: "INVALID_STATE", message: "Compra sem itens válidos." });
      return;
    }

    const costInput = Array.isArray(req.body?.items) ? (req.body.items as CostInput[]) : [];
    const shouldUpdateProductCost = req.body?.updateProductCost === true;
    const costByProduct = new Map<string, number>();
    const repasseByProduct = new Map<string, number>();
    for (const item of costInput) {
      const productId = String(item?.productId || "").trim();
      const unitCost = Number(item?.unitCost);
      const repasseUnitCost = Number(item?.repasseUnitCost);
      if (!productId) continue;
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        res.status(400).json({ error: "INVALID_INPUT", message: `Custo inválido para o produto ${productId}.` });
        return;
      }
      costByProduct.set(productId, unitCost);
      if (Number.isFinite(repasseUnitCost) && repasseUnitCost >= 0) {
        repasseByProduct.set(productId, repasseUnitCost);
      }
    }

    for (const item of snapshotItems) {
      if (!costByProduct.has(item.productId)) {
        res.status(400).json({ error: "INVALID_INPUT", message: `Informe o custo real do produto ${item.productName}.` });
        return;
      }
    }

    const normalizedSnapshotItems = snapshotItems.map((item) => ({
      ...item,
      baseUnitCost: round2(Number(costByProduct.get(item.productId) ?? item.baseUnitCost ?? 0)),
      repasseUnitCost: round2(Number(repasseByProduct.get(item.productId) ?? item.repasseUnitCost ?? 0)),
    }));

    const costsSnapshot = normalizedSnapshotItems.map((item) => {
      const unitCost = Number(costByProduct.get(item.productId) || 0);
      return {
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitCost,
        totalCost: round2(unitCost * item.quantity),
      };
    });

    const loja1RealCostTotal = round2(costsSnapshot.reduce((sum, item) => sum + item.totalCost, 0));
    const repasseTotal = round2(normalizedSnapshotItems.reduce((sum, item) => sum + (Number(item.repasseUnitCost || 0) * item.quantity), 0));
    const loja1RealProfit = round2(repasseTotal - loja1RealCostTotal);

    let filialProductsUpdated = 0;
    let loja1ProductsUpdated = 0;
    let openRequestsUpdated = 0;
    if (shouldUpdateProductCost) {
      const repasseCostByProductId = new Map(
        normalizedSnapshotItems.map((item) => [item.productId, round2(Number(item.repasseUnitCost || 0))]),
      );
      const productIds = Array.from(new Set(costsSnapshot.map((item) => item.productId).filter(Boolean)));
      if (productIds.length > 0) {
        const productRows = await db
          .select({
            id: productsTable.id,
            costPrice: productsTable.costPrice,
          })
          .from(productsTable)
          .where(and(buildProductsTenantWhere(requestRow.filialTenantId), inArray(productsTable.id, productIds)));

        const currentCostByProductId = new Map(productRows.map((row) => [row.id, Number(row.costPrice || 0)]));

        for (const item of costsSnapshot) {
          const currentCost = currentCostByProductId.get(item.productId);
          if (currentCost == null) continue;

          const nextCost = Number(repasseCostByProductId.get(item.productId) ?? item.unitCost ?? 0);
          if (!Number.isFinite(nextCost)) continue;
          if (round2(currentCost) === nextCost) continue;

          await db
            .update(productsTable)
            .set({
              costPrice: String(nextCost),
              updatedAt: new Date(),
            })
            .where(and(buildProductsTenantWhere(requestRow.filialTenantId), eq(productsTable.id, item.productId)));

          await db.insert(productCostHistoryTable).values({
            productId: item.productId,
            costPrice: String(nextCost),
          });

          filialProductsUpdated += 1;
        }

        for (const item of costsSnapshot) {
          const sourceProductId = getLoja1SourceProductId(item.productId, requestRow.filialTenantId);
          if (!sourceProductId) continue;

          const sourceRows = await db
            .select({ costPrice: productsTable.costPrice })
            .from(productsTable)
            .where(and(buildProductsTenantWhere(DEFAULT_TENANT_ID), eq(productsTable.id, sourceProductId)))
            .limit(1);
          if (sourceRows.length === 0 || round2(Number(sourceRows[0].costPrice || 0)) === round2(item.unitCost)) continue;

          await db
            .update(productsTable)
            .set({ costPrice: String(round2(item.unitCost)), updatedAt: new Date() })
            .where(and(buildProductsTenantWhere(DEFAULT_TENANT_ID), eq(productsTable.id, sourceProductId)));

          await db.insert(productCostHistoryTable).values({
            productId: sourceProductId,
            costPrice: String(round2(item.unitCost)),
          });

          loja1ProductsUpdated += 1;
        }

        const propagatableStatuses = [
          "pendente_pagamento_filial",
          "pago_na_filial",
          "aguardando_compra_loja1",
          "lote_enviado_loja1",
          "lote_recebido_loja1",
          "enviado_motoboy",
        ];
        const siblingRequests = await db
          .select({
            id: filialPurchaseRequestsTable.id,
            itemsSnapshot: filialPurchaseRequestsTable.itemsSnapshot,
          })
          .from(filialPurchaseRequestsTable)
          .where(and(
            eq(filialPurchaseRequestsTable.filialTenantId, requestRow.filialTenantId),
            inArray(filialPurchaseRequestsTable.status, propagatableStatuses),
          ));

        const updatedValuesByProductId = new Map(normalizedSnapshotItems.map((item) => [item.productId, {
          baseUnitCost: round2(Number(item.baseUnitCost || 0)),
          repasseUnitCost: round2(Number(item.repasseUnitCost || 0)),
        }]));

        for (const sibling of siblingRequests) {
          if (sibling.id === requestId) continue;
          const siblingItems = parseSnapshotItems(sibling.itemsSnapshot);
          let changed = false;
          const nextItems = siblingItems.map((item) => {
            const nextValues = updatedValuesByProductId.get(item.productId);
            if (!nextValues) return item;
            changed = true;
            return { ...item, ...nextValues };
          });
          if (!changed) continue;

          const nextRepasseTotal = round2(nextItems.reduce(
            (sum, item) => sum + (Number(item.repasseUnitCost || 0) * Number(item.quantity || 0)),
            0,
          ));
          await db
            .update(filialPurchaseRequestsTable)
            .set({
              itemsSnapshot: nextItems,
              repasseTotal: String(nextRepasseTotal),
              updatedByAdmin: actorUsername,
              updatedAt: new Date(),
            })
            .where(eq(filialPurchaseRequestsTable.id, sibling.id));

          await addAudit({
            requestId: sibling.id,
            action: "product_cost_propagated",
            actorUsername,
            payload: {
              sourceRequestId: requestId,
              productIds: nextItems.filter((item) => updatedValuesByProductId.has(item.productId)).map((item) => item.productId),
            },
          });
          openRequestsUpdated += 1;
        }
      }
    }

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: wasFinalized ? "finalizado" : "compra_registrada",
        itemsSnapshot: normalizedSnapshotItems,
        repasseTotal: String(repasseTotal),
        costsSnapshot,
        loja1RealCostTotal: String(loja1RealCostTotal),
        loja1RealProfit: String(loja1RealProfit),
        purchaseRecordedAt: new Date(),
        updatedByAdmin: actorUsername,
        updatedAt: new Date(),
      })
      .where(eq(filialPurchaseRequestsTable.id, requestId));

    await addAudit({
      requestId,
      action: wasFinalized ? "ajuste_pos_finalizacao" : "compra_registrada",
      actorUsername,
      payload: {
        loja1RealCostTotal,
        loja1RealProfit,
        repasseTotal,
        updateProductCost: shouldUpdateProductCost,
        filialProductsUpdated,
        loja1ProductsUpdated,
        openRequestsUpdated,
      },
    });

    if (wasFinalized) {
      res.json({
        ok: true,
        requestId,
        status: "finalizado",
        updatedAfterFinalized: true,
        loja1RealCostTotal,
        loja1RealProfit,
        filialProductsUpdated,
        loja1ProductsUpdated,
        openRequestsUpdated,
      });
      return;
    }

    const existingEntries = await db
      .select({
        productId: inventoryMovementsTable.productId,
        quantity: inventoryMovementsTable.quantity,
      })
      .from(inventoryMovementsTable)
      .where(and(
        eq(inventoryMovementsTable.tenantId, requestRow.filialTenantId),
        eq(inventoryMovementsTable.referenceId, requestId),
        eq(inventoryMovementsTable.type, "entry"),
      ));

    const launchedByProduct = new Map<string, number>();
    for (const entry of existingEntries) {
      const productId = String(entry.productId || "").trim();
      if (!productId) continue;
      launchedByProduct.set(productId, (launchedByProduct.get(productId) || 0) + Math.max(0, Number(entry.quantity || 0)));
    }

    for (const item of snapshotItems) {
      const alreadyLaunched = launchedByProduct.get(item.productId) || 0;
      const missingQty = Math.max(0, item.quantity - alreadyLaunched);
      if (missingQty <= 0) continue;

      await registerInventoryEntry({
        tenantId: requestRow.filialTenantId,
        productId: item.productId,
        quantity: missingQty,
        entrySource: "purchase",
        referenceId: requestId,
        reason: `Entrada Loja 1 por compra da filial · Pedido ${requestRow.orderId}`,
      });
    }

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "finalizado",
        stockLaunchedAt: new Date(),
        finalizedAt: new Date(),
        updatedByAdmin: actorUsername,
        updatedAt: new Date(),
      })
      .where(eq(filialPurchaseRequestsTable.id, requestId));

    await addAudit({
      requestId,
      action: "estoque_lancado_filial",
      actorUsername,
      payload: {
        filialTenantId: requestRow.filialTenantId,
        orderId: requestRow.orderId,
      },
    });

    await addAudit({
      requestId,
      action: "finalizado",
      actorUsername,
      payload: {
        loja1RealCostTotal,
        loja1RealProfit,
      },
    });

    res.json({
      ok: true,
      requestId,
      status: "finalizado",
      loja1RealCostTotal,
      loja1RealProfit,
      filialProductsUpdated,
      loja1ProductsUpdated,
      openRequestsUpdated,
    });
  } catch (err) {
    console.error("[FilialPurchases] confirm error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao confirmar compra da filial." });
  }
});

router.delete("/admin/filial-purchases/:requestId", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Compra inválida." });
      return;
    }

    const scope = getAdminScope(req);
    const actorUsername = String(scope?.username || "").trim() || null;

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        status: filialPurchaseRequestsTable.status,
      })
      .from(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.id, requestId))
      .limit(1);

    const requestRow = rows[0];
    if (!requestRow) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compra da filial não encontrada." });
      return;
    }

    if (requestRow.status === "cancelado") {
      res.json({ ok: true, requestId, idempotent: true, status: "cancelado" });
      return;
    }

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "cancelado",
        updatedByAdmin: actorUsername,
        updatedAt: new Date(),
      })
      .where(eq(filialPurchaseRequestsTable.id, requestId));

    await addAudit({
      requestId,
      action: "cancelado",
      actorUsername,
      payload: {
        reason: "cancelado_manual_admin",
      },
    });

    res.json({ ok: true, requestId, cancelled: true, status: "cancelado" });
  } catch (err) {
    console.error("[FilialPurchases] delete error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao cancelar compra da filial." });
  }
});

router.delete("/admin/filial-purchases/:requestId/purge", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Compra inválida." });
      return;
    }

    const rows = await db
      .select({
        id: filialPurchaseRequestsTable.id,
        status: filialPurchaseRequestsTable.status,
        orderId: filialPurchaseRequestsTable.orderId,
      })
      .from(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.id, requestId))
      .limit(1);

    const requestRow = rows[0];
    if (!requestRow) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compra da filial não encontrada." });
      return;
    }

    if (requestRow.status !== "cancelado") {
      res.status(400).json({
        error: "INVALID_STATE",
        message: "A exclusão definitiva só é permitida para pedidos cancelados.",
      });
      return;
    }

    await db
      .delete(filialPurchaseRequestAuditsTable)
      .where(eq(filialPurchaseRequestAuditsTable.requestId, requestId));

    await db
      .delete(filialPurchaseRequestsTable)
      .where(eq(filialPurchaseRequestsTable.id, requestId));

    res.json({ ok: true, requestId, purged: true, orderId: requestRow.orderId });
  } catch (err) {
    console.error("[FilialPurchases] purge error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao apagar rascunho da compra da filial." });
  }
});

export default router;
