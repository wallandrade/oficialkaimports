import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, ordersTable, sellerCommissionPaymentsTable, sellersTable } from "@workspace/db";
import { getAdminScope, requireAdminAuth } from "./admin-auth";

const router: IRouter = Router();

type CommissionOrderRow = {
  id: string;
  sellerCode: string | null;
  clientName: string;
  total: string;
  status: string;
  createdAt: Date | string;
  sellerCommissionRateSnapshot: string | number | null;
};

function parseOrderIds(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((value) => String(value || "").trim()).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((value) => String(value || "").trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDateKey(value: string | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[0] : raw.slice(0, 10);
}

function normalizeDate(value: string | undefined, boundary: "start" | "end" = "start"): Date | null {
  const dateKey = normalizeDateKey(value);
  if (!dateKey) return null;
  const time = boundary === "end" ? "23:59:59.999" : "00:00:00.000";
  // Interpreta o dia no fuso de Sao Paulo (UTC-3) para evitar incluir pedidos do dia seguinte.
  const parsed = new Date(`${dateKey}T${time}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toSaoPauloDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function getBatchDateKey(value: Date | string | null | undefined): string | null {
  const direct = normalizeDateKey(typeof value === "string" ? value : undefined);
  return direct || toSaoPauloDateKey(value);
}

function normalizeSellerCode(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function calcCommission(order: CommissionOrderRow, sellerRateMap: Map<string, number>): number {
  const total = Number(order.total || 0);
  const normalizedSeller = normalizeSellerCode(order.sellerCode);
  let rate = 0;

  // Keep historical rate when snapshot exists.
  if (order.sellerCommissionRateSnapshot !== undefined && order.sellerCommissionRateSnapshot !== null) {
    rate = Number(order.sellerCommissionRateSnapshot) || 0;
  } else if (normalizedSeller) {
    // Fallback only for legacy orders without snapshot.
    rate = sellerRateMap.get(normalizedSeller) ?? 0;
  }

  if (!Number.isFinite(total) || !Number.isFinite(rate) || total <= 0 || rate <= 0) return 0;
  if (!normalizedSeller) return 0;
  return Math.round(total * (rate / 100) * 100) / 100;
}

async function getSellerRateMap(sellerCodes: string[]): Promise<Map<string, number>> {
  const unique = Array.from(new Set(sellerCodes.map((value) => normalizeSellerCode(value)).filter(Boolean)));
  if (unique.length === 0) return new Map<string, number>();

  const rows = await db
    .select({
      slug: sellersTable.slug,
      hasCommission: sellersTable.hasCommission,
      commissionRate: sellersTable.commissionRate,
    })
    .from(sellersTable)
    .where(inArray(sellersTable.slug, unique));

  return new Map(
    rows.map((seller) => [
      normalizeSellerCode(seller.slug),
      seller.hasCommission ? Number(seller.commissionRate ?? 0) : 0,
    ]),
  );
}

function createBatchId(): string {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `scb_${timePart}_${randomPart}`;
}

router.get("/admin/seller-commission-payments", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const { sellerCode, dateFrom, dateTo } = req.query as Record<string, string>;
    const effectiveSellerCode = String(sellerCode || "").trim().toLowerCase();
    const scopedSellerCode = normalizeSellerCode(scope.sellerCode);
    if (!scope.hasGlobalAccess && effectiveSellerCode && effectiveSellerCode !== scopedSellerCode) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para outro vendedor." });
      return;
    }

    const activeSellerCode = scope.hasGlobalAccess ? effectiveSellerCode : scopedSellerCode;
    const dateConditions = [];
    const startDate = normalizeDate(dateFrom, "start");
    const endDate = normalizeDate(dateTo, "end");
    if (startDate) dateConditions.push(gte(ordersTable.createdAt, startDate));
    if (endDate) dateConditions.push(lte(ordersTable.createdAt, endDate));

    const pendingConditions = [
      inArray(ordersTable.status, ["paid", "completed"]),
      isNull(ordersTable.sellerCommissionBatchId),
      isNull(ordersTable.sellerCommissionPaidAt),
    ];
    pendingConditions.push(...dateConditions);

    const pendingRows = await db
      .select({
        id: ordersTable.id,
        sellerCode: ordersTable.sellerCode,
        clientName: ordersTable.clientName,
        total: ordersTable.total,
        status: ordersTable.status,
        createdAt: ordersTable.createdAt,
        sellerCommissionRateSnapshot: ordersTable.sellerCommissionRateSnapshot,
        sellerCommissionBatchId: ordersTable.sellerCommissionBatchId,
        sellerCommissionPaidAt: ordersTable.sellerCommissionPaidAt,
      })
      .from(ordersTable)
      .where(pendingConditions.length > 0 ? and(...pendingConditions) : undefined)
      .orderBy(desc(ordersTable.createdAt));

    const batchRows = await db
      .select()
      .from(sellerCommissionPaymentsTable)
      .orderBy(desc(sellerCommissionPaymentsTable.createdAt));

    const scopedBatchRows = batchRows.filter((batch) => {
      if (!activeSellerCode) return true;
      return normalizeSellerCode(batch.sellerCode) === activeSellerCode;
    });

    const paidOrderIds = new Set(
      scopedBatchRows
      .filter((batch) => batch.status === "paid")
      .flatMap((batch) => parseOrderIds(batch.orderIds)),
    );

    const sellerRateMap = await getSellerRateMap(
      pendingRows
        .map((row) => String(row.sellerCode || ""))
        .filter(Boolean),
    );

    const pendingOrders = pendingRows
      .filter((row) => {
        if (!activeSellerCode) return true;
        return normalizeSellerCode(row.sellerCode) === activeSellerCode;
      })
      .map((row) => ({
        id: row.id,
        sellerCode: row.sellerCode ?? null,
        clientName: row.clientName,
        total: Number(row.total || 0),
        status: row.status,
        createdAt: toIso(row.createdAt),
        sellerCommissionRateSnapshot: Number(row.sellerCommissionRateSnapshot || 0),
        commissionAmount: calcCommission(row, sellerRateMap),
      }))
      .filter((row) => row.commissionAmount > 0)
      .filter((row) => !paidOrderIds.has(row.id));

    const batches = scopedBatchRows.map((batch) => ({
      id: batch.id,
      sellerCode: batch.sellerCode,
      orderIds: parseOrderIds(batch.orderIds),
      periodStart: batch.periodStartDate || toIso(batch.periodStart),
      periodEnd: batch.periodEndDate || toIso(batch.periodEnd),
      totalAmount: Number(batch.totalAmount || 0),
      orderCount: Number(batch.orderCount || 0),
      status: batch.status,
      paymentMethod: batch.paymentMethod || null,
      paidAt: toIso(batch.paidAt),
      notes: batch.notes || null,
      createdAt: toIso(batch.createdAt) || new Date().toISOString(),
      updatedAt: toIso(batch.updatedAt) || new Date().toISOString(),
    }));

    res.json({ pendingOrders, batches });
  } catch (err) {
    console.error("[SellerCommissionPayments] list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar comissões." });
  }
});

router.post("/admin/seller-commission-payments", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const { sellerCode, dateFrom, dateTo, orderIds } = req.body as {
      sellerCode?: string;
      dateFrom?: string;
      dateTo?: string;
      orderIds?: string[];
    };

    const effectiveSellerCode = String(sellerCode || "").trim().toLowerCase();
    const scopedSellerCode = normalizeSellerCode(scope.sellerCode);
    if (!scope.hasGlobalAccess && effectiveSellerCode && effectiveSellerCode !== scopedSellerCode) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para outro vendedor." });
      return;
    }

    const targetSellerCode = scope.hasGlobalAccess ? effectiveSellerCode : scopedSellerCode;
    if (!targetSellerCode) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Selecione um vendedor." });
      return;
    }

    const dateConditions = [];
    const startDate = normalizeDate(dateFrom, "start");
    const endDate = normalizeDate(dateTo, "end");
    if (startDate) dateConditions.push(gte(ordersTable.createdAt, startDate));
    if (endDate) dateConditions.push(lte(ordersTable.createdAt, endDate));

    const orderIdList = Array.isArray(orderIds) ? Array.from(new Set(orderIds.map((value) => String(value || "").trim()).filter(Boolean))) : [];

    const conditions = [
      eq(ordersTable.sellerCode, targetSellerCode),
      inArray(ordersTable.status, ["paid", "completed"]),
      isNull(ordersTable.sellerCommissionBatchId),
      isNull(ordersTable.sellerCommissionPaidAt),
      ...dateConditions,
    ];

    if (orderIdList.length > 0) {
      conditions.push(inArray(ordersTable.id, orderIdList));
    }

    const rows = await db
      .select({
        id: ordersTable.id,
        sellerCode: ordersTable.sellerCode,
        clientName: ordersTable.clientName,
        total: ordersTable.total,
        status: ordersTable.status,
        createdAt: ordersTable.createdAt,
        sellerCommissionRateSnapshot: ordersTable.sellerCommissionRateSnapshot,
      })
      .from(ordersTable)
      .where(and(...conditions))
      .orderBy(desc(ordersTable.createdAt));

    const sellerBatchRows = await db
      .select()
      .from(sellerCommissionPaymentsTable)
      .where(eq(sellerCommissionPaymentsTable.sellerCode, targetSellerCode));

    const paidWindows = sellerBatchRows
      .filter((batch) => batch.status === "paid")
      .flatMap((batch) => parseOrderIds(batch.orderIds));

    const paidOrderIds = new Set(paidWindows);
    const sellerRateMap = await getSellerRateMap([targetSellerCode]);

    const eligibleOrders = rows
      .map((row) => ({
        id: row.id,
        sellerCode: row.sellerCode ?? null,
        clientName: row.clientName,
        total: Number(row.total || 0),
        status: row.status,
        createdAt: toIso(row.createdAt),
        sellerCommissionRateSnapshot: Number(row.sellerCommissionRateSnapshot || 0),
        commissionAmount: calcCommission(row, sellerRateMap),
      }))
      .filter((row) => row.commissionAmount > 0)
      .filter((row) => !paidOrderIds.has(row.id));

    if (eligibleOrders.length === 0) {
      res.status(400).json({ error: "NO_ELIGIBLE_ORDERS", message: "Nenhum pedido elegível encontrado." });
      return;
    }

    const batchId = createBatchId();
    const totalAmount = eligibleOrders.reduce((sum, order) => sum + order.commissionAmount, 0);
    const now = new Date();
    const periodStartDate = normalizeDateKey(dateFrom);
    const periodEndDate = normalizeDateKey(dateTo);

    await db.insert(sellerCommissionPaymentsTable).values({
      id: batchId,
      sellerCode: targetSellerCode,
      orderIds: eligibleOrders.map((order) => order.id),
      periodStartDate,
      periodEndDate,
      periodStart: startDate,
      periodEnd: endDate,
      totalAmount: totalAmount.toFixed(2),
      orderCount: eligibleOrders.length,
      status: "open",
      notes: null,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .update(ordersTable)
      .set({ sellerCommissionBatchId: batchId, updatedAt: now })
      .where(inArray(ordersTable.id, eligibleOrders.map((order) => order.id)));

    res.status(201).json({
      ok: true,
      batch: {
        id: batchId,
        sellerCode: targetSellerCode,
        orderIds: eligibleOrders.map((order) => order.id),
        periodStartDate,
        periodEndDate,
        periodStart: startDate?.toISOString() || null,
        periodEnd: endDate?.toISOString() || null,
        totalAmount: Number(totalAmount.toFixed(2)),
        orderCount: eligibleOrders.length,
        status: "open",
        paidAt: null,
        paymentMethod: null,
        notes: null,
      },
    });
  } catch (err) {
    console.error("[SellerCommissionPayments] create error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar lote de comissão." });
  }
});

router.patch("/admin/seller-commission-payments/:id/pay", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const paymentId = String(req.params.id || "").trim();
    const { paymentMethod, notes } = req.body as { paymentMethod?: string; notes?: string };
    const now = new Date();

    const existing = await db
      .select()
      .from(sellerCommissionPaymentsTable)
      .where(eq(sellerCommissionPaymentsTable.id, paymentId))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Lote não encontrado." });
      return;
    }

    if (!scope.hasGlobalAccess && normalizeSellerCode(existing[0].sellerCode) !== normalizeSellerCode(scope.sellerCode)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para este lote." });
      return;
    }

    await db
      .update(sellerCommissionPaymentsTable)
      .set({
        status: "paid",
        paymentMethod: String(paymentMethod || existing[0].paymentMethod || "").trim() || null,
        notes: notes !== undefined ? String(notes || "").trim() || null : existing[0].notes || null,
        paidAt: now,
        updatedAt: now,
      })
      .where(eq(sellerCommissionPaymentsTable.id, paymentId));

    const orderIds = parseOrderIds(existing[0].orderIds);
    if (orderIds.length > 0) {
      await db
        .update(ordersTable)
        .set({ sellerCommissionPaidAt: now, updatedAt: now })
        .where(inArray(ordersTable.id, orderIds));
    }

    res.json({ ok: true, id: paymentId, status: "paid", paidAt: now.toISOString() });
  } catch (err) {
    console.error("[SellerCommissionPayments] pay error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao marcar lote como pago." });
  }
});

export default router;