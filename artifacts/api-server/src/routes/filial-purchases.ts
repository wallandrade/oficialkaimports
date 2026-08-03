import { Router, type IRouter } from "express";
import crypto from "crypto";
import {
  db,
  filialPurchaseRequestAuditsTable,
  filialPurchaseRequestsTable,
  inventoryMovementsTable,
  productCostHistoryTable,
  productsTable,
  tenantsTable,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getAdminScope, requireAdminAuth, requirePrimaryAdmin } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { registerInventoryEntry } from "../lib/reshipments";

const router: IRouter = Router();

type SnapshotItem = {
  productId: string;
  productName: string;
  quantity: number;
  saleUnitPrice: number;
  repasseUnitCost: number;
};

type CostInput = {
  productId?: unknown;
  unitCost?: unknown;
};

type ManualPurchaseItemInput = {
  productId?: unknown;
  quantity?: unknown;
  repasseUnitCost?: unknown;
};

function buildProductsTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(productsTable.tenantId, tenantId), isNull(productsTable.tenantId), eq(productsTable.tenantId, ""));
  }

  return eq(productsTable.tenantId, tenantId);
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
    const pendingStatuses = ["pendente_pagamento_filial", "pago_na_filial", "aguardando_compra_loja1", "compra_registrada", "estoque_lancado_filial"];

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
        status: filialPurchaseRequestsTable.status,
        clientName: filialPurchaseRequestsTable.clientName,
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
          eq(filialPurchaseRequestAuditsTable.action, "compra_registrada"),
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
        status: row.status,
        clientName: row.clientName,
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

    const statusParam = String(req.query.status || "pending").trim().toLowerCase();
    const pendingStatuses = ["pendente_pagamento_filial", "pago_na_filial", "aguardando_compra_loja1", "compra_registrada", "estoque_lancado_filial"];

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
        status: filialPurchaseRequestsTable.status,
        clientName: filialPurchaseRequestsTable.clientName,
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
          eq(filialPurchaseRequestAuditsTable.action, "compra_registrada"),
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
        status: row.status,
        clientName: row.clientName,
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
          repasseUnitCost,
        });
        continue;
      }

      const nextQty = existing.quantity + quantity;
      const weightedSale = nextQty > 0
        ? ((existing.saleUnitPrice * existing.quantity) + (saleUnitPrice * quantity)) / nextQty
        : existing.saleUnitPrice;
      const weightedRepasse = nextQty > 0
        ? ((existing.repasseUnitCost * existing.quantity) + (repasseUnitCost * quantity)) / nextQty
        : existing.repasseUnitCost;

      grouped.set(item.productId, {
        ...existing,
        quantity: nextQty,
        saleUnitPrice: weightedSale,
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

    if (requestRow.status === "finalizado" || requestRow.status === "compra_registrada" || requestRow.status === "estoque_lancado_filial" || requestRow.status === "aguardando_compra_loja1" || requestRow.status === "pago_na_filial") {
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

    if (requestRow.status === "finalizado") {
      res.json({ ok: true, idempotent: true, message: "Compra já finalizada." });
      return;
    }

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
    for (const item of costInput) {
      const productId = String(item?.productId || "").trim();
      const unitCost = Number(item?.unitCost);
      if (!productId) continue;
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        res.status(400).json({ error: "INVALID_INPUT", message: `Custo inválido para o produto ${productId}.` });
        return;
      }
      costByProduct.set(productId, unitCost);
    }

    for (const item of snapshotItems) {
      if (!costByProduct.has(item.productId)) {
        res.status(400).json({ error: "INVALID_INPUT", message: `Informe o custo real do produto ${item.productName}.` });
        return;
      }
    }

    const costsSnapshot = snapshotItems.map((item) => {
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
    const repasseTotal = round2(Number(requestRow.repasseTotal || 0));
    const loja1RealProfit = round2(repasseTotal - loja1RealCostTotal);

    if (shouldUpdateProductCost) {
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

          const nextCost = round2(Number(item.unitCost || 0));
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
        }
      }
    }

    await db
      .update(filialPurchaseRequestsTable)
      .set({
        status: "compra_registrada",
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
      action: "compra_registrada",
      actorUsername,
      payload: {
        loja1RealCostTotal,
        loja1RealProfit,
        repasseTotal,
        updateProductCost: shouldUpdateProductCost,
      },
    });

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

    if (requestRow.status === "finalizado") {
      res.status(400).json({
        error: "INVALID_STATE",
        message: "Não é possível cancelar uma compra já finalizada.",
      });
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
