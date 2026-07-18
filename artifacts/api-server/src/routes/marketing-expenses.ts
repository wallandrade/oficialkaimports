import { Router, type IRouter } from "express";
import crypto from "crypto";
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, marketingExpensesTable } from "@workspace/db";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";

const router: IRouter = Router();

function buildMarketingExpensesTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(
      eq(marketingExpensesTable.tenantId, tenantId),
      isNull(marketingExpensesTable.tenantId),
      eq(marketingExpensesTable.tenantId, ""),
    );
  }

  return eq(marketingExpensesTable.tenantId, tenantId);
}

function toUTC(dateStr: string, hour: string, minute: string, second: string) {
  const local = new Date(`${dateStr}T${hour}:${minute}:${second}-03:00`);
  return new Date(local.toISOString());
}

function normalizeSellerCode(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

// GET /api/admin/marketing-expenses
router.get("/admin/marketing-expenses", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    if (!scope.hasGlobalAccess && !scope.sellerCode) {
      res.status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
      return;
    }

    const { dateFrom, dateTo, sellerCode } = req.query as Record<string, string>;
    const tenantId = scope.tenantId || DEFAULT_TENANT_ID;
    const conditions = [buildMarketingExpensesTenantWhere(tenantId)];
    if (dateFrom) {
      conditions.push(sql`DATE(DATE_SUB(COALESCE(${marketingExpensesTable.expenseEndDate}, ${marketingExpensesTable.expenseDate}), INTERVAL 3 HOUR)) >= ${dateFrom}`);
    }
    if (dateTo) {
      conditions.push(sql`DATE(DATE_SUB(COALESCE(${marketingExpensesTable.expenseStartDate}, ${marketingExpensesTable.expenseDate}), INTERVAL 3 HOUR)) <= ${dateTo}`);
    }

    const effectiveSellerCode = !scope.hasGlobalAccess
      ? normalizeSellerCode(scope.sellerCode)
      : normalizeSellerCode(sellerCode);

    if (effectiveSellerCode) {
      conditions.push(or(eq(marketingExpensesTable.sellerCode, effectiveSellerCode), isNull(marketingExpensesTable.sellerCode)));
    }

    const rows = await db
      .select()
      .from(marketingExpensesTable)
      .where(and(...conditions))
      .orderBy(desc(marketingExpensesTable.expenseDate), desc(marketingExpensesTable.createdAt), desc(marketingExpensesTable.id));

    const items = rows.map((row) => ({
      id: row.id,
      sellerCode: row.sellerCode ?? null,
      expenseDate: row.expenseDate?.toISOString?.() ?? new Date().toISOString(),
      expenseStartDate: row.expenseStartDate?.toISOString?.() ?? row.expenseDate?.toISOString?.() ?? new Date().toISOString(),
      expenseEndDate: row.expenseEndDate?.toISOString?.() ?? row.expenseDate?.toISOString?.() ?? new Date().toISOString(),
      channel: row.channel,
      amount: Number(row.amount || 0),
      note: row.note ?? null,
      createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
    }));

    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const byChannelMap = new Map<string, number>();
    for (const item of items) {
      const key = String(item.channel || "Sem canal").trim() || "Sem canal";
      byChannelMap.set(key, (byChannelMap.get(key) || 0) + Number(item.amount || 0));
    }

    res.json({
      items,
      total,
      byChannel: Array.from(byChannelMap.entries())
        .map(([channel, channelTotal]) => ({ channel, total: channelTotal }))
        .sort((a, b) => b.total - a.total),
    });
  } catch (err) {
    console.error("[MarketingExpenses] list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar gastos." });
  }
});

// POST /api/admin/marketing-expenses
router.post("/admin/marketing-expenses", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    if (!scope.hasGlobalAccess && !scope.sellerCode) {
      res.status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
      return;
    }

    const expenseStartDateRaw = String(req.body?.expenseStartDate ?? req.body?.expenseDate ?? "").trim();
    const expenseEndDateRaw = String(req.body?.expenseEndDate ?? req.body?.expenseDate ?? "").trim();
    const channel = String(req.body?.channel ?? "").trim();
    const note = String(req.body?.note ?? "").trim();
    const amount = Number(req.body?.amount ?? 0);

    if (!expenseStartDateRaw || !expenseEndDateRaw) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe a data inicial e final do gasto." });
      return;
    }

    if (!channel) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe o canal do gasto." });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe um valor válido." });
      return;
    }

    const expenseStartDate = new Date(`${expenseStartDateRaw}T00:00:00-03:00`);
    const expenseEndDate = new Date(`${expenseEndDateRaw}T23:59:59-03:00`);
    if (Number.isNaN(expenseStartDate.getTime()) || Number.isNaN(expenseEndDate.getTime()) || expenseEndDate < expenseStartDate) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Período inválido." });
      return;
    }

    const expenseDate = expenseStartDate;

    const id = crypto.randomUUID();
    const tenantId = scope.tenantId || DEFAULT_TENANT_ID;
    const sellerCode = scope.hasGlobalAccess ? null : normalizeSellerCode(scope.sellerCode);

    await db.insert(marketingExpensesTable).values({
      id,
      tenantId,
      sellerCode,
      expenseDate,
      expenseStartDate,
      expenseEndDate,
      channel,
      amount: amount.toFixed(2),
      note: note || null,
    });

    res.status(201).json({
      id,
      sellerCode,
      expenseDate: expenseDate.toISOString(),
      expenseStartDate: expenseStartDate.toISOString(),
      expenseEndDate: expenseEndDate.toISOString(),
      channel,
      amount,
      note: note || null,
    });
  } catch (err) {
    console.error("[MarketingExpenses] create error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar gasto." });
  }
});

// DELETE /api/admin/marketing-expenses/:id
router.delete("/admin/marketing-expenses/:id", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    if (!scope.hasGlobalAccess && !scope.sellerCode) {
      res.status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
      return;
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "INVALID_INPUT", message: "ID inválido." });
      return;
    }

    const conditions = [eq(marketingExpensesTable.id, id)];
    const tenantId = scope.tenantId || DEFAULT_TENANT_ID;
    conditions.push(buildMarketingExpensesTenantWhere(tenantId));
    if (!scope.hasGlobalAccess) {
      const sellerCode = normalizeSellerCode(scope.sellerCode);
      if (!sellerCode) {
        res.status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
        return;
      }
      conditions.push(eq(marketingExpensesTable.sellerCode, sellerCode));
    }

    const existing = await db
      .select({ id: marketingExpensesTable.id })
      .from(marketingExpensesTable)
      .where(and(...conditions))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Gasto não encontrado." });
      return;
    }

    await db.delete(marketingExpensesTable).where(eq(marketingExpensesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[MarketingExpenses] delete error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao remover gasto." });
  }
});

export default router;