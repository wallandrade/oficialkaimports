import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { parseOfxStatement } from "../lib/ofx-bank-statement";
import { reconcileBankStatement } from "../lib/bank-statement-reconcile";

const router: IRouter = Router();

function moneyToCents(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function toIsoDateStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = toIsoDateStart(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildOrderTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

// --------------------------------------------------------------------------
// POST /api/admin/bank-statement/analyze
// body: { ofxText, dateWindowDays? }
// --------------------------------------------------------------------------
router.post("/admin/bank-statement/analyze", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = getAdminScope(req);
    if (!adminScope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const ofxText = String(req.body?.ofxText || "");
    if (ofxText.length < 50) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Cole ou envie o conteúdo do arquivo OFX." });
      return;
    }
    if (ofxText.length > 12_000_000) {
      res.status(400).json({ error: "TOO_LARGE", message: "Arquivo OFX muito grande." });
      return;
    }

    const dateWindowDays = Number(req.body?.dateWindowDays);
    let parsed;
    try {
      parsed = parseOfxStatement(ofxText);
    } catch (err) {
      res.status(400).json({
        error: "OFX_PARSE_ERROR",
        message: err instanceof Error ? err.message : "Falha ao ler o OFX.",
      });
      return;
    }

    if (!parsed.credits.length) {
      res.status(400).json({
        error: "NO_CREDITS",
        message: "Nenhum crédito (PIX recebido) encontrado no extrato.",
        meta: parsed.meta,
      });
      return;
    }

    const window = Number.isFinite(dateWindowDays) ? dateWindowDays : 5;
    const startYmd = parsed.meta.dateStart || parsed.credits[0]!.postedAt;
    const endYmd = parsed.meta.dateEnd || parsed.credits[parsed.credits.length - 1]!.postedAt;
    const rangeStart = toIsoDateStart(addDaysYmd(startYmd, -2));
    const rangeEnd = toIsoDateStart(addDaysYmd(endYmd, Math.max(1, window) + 1));
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const conditions = [
      buildOrderTenantWhere(adminScope.tenantId),
      gte(ordersTable.createdAt, rangeStart),
      lte(ordersTable.createdAt, rangeEnd),
      ne(ordersTable.status, "cancelled"),
    ];
    if (!adminScope.hasGlobalAccess) {
      if (!adminScope.sellerCode) {
        res.status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
        return;
      }
      conditions.push(eq(ordersTable.sellerCode, adminScope.sellerCode));
    }

    const rows = await db
      .select({
        id: ordersTable.id,
        orderNumber: ordersTable.orderNumber,
        clientName: ordersTable.clientName,
        total: ordersTable.total,
        createdAt: ordersTable.createdAt,
        status: ordersTable.status,
        bankDepositMatchStatus: ordersTable.bankDepositMatchStatus,
        bankDepositFitid: ordersTable.bankDepositFitid,
      })
      .from(ordersTable)
      .where(and(...conditions));

    const usedFitidRows = await db
      .select({ fitid: ordersTable.bankDepositFitid })
      .from(ordersTable)
      .where(
        and(
          buildOrderTenantWhere(adminScope.tenantId),
          isNotNull(ordersTable.bankDepositFitid),
          or(
            eq(ordersTable.bankDepositMatchStatus, "ok"),
            eq(ordersTable.bankDepositMatchStatus, "confirmed_100"),
          ),
        ),
      );

    const usedFitids = new Set(
      usedFitidRows.map((r) => String(r.fitid || "").trim()).filter(Boolean),
    );

    const report = reconcileBankStatement({
      credits: parsed.credits,
      orders: rows.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber ?? null,
        clientName: r.clientName,
        totalCents: moneyToCents(r.total),
        createdAt: r.createdAt?.toISOString?.() ?? new Date().toISOString(),
        status: r.status,
        bankDepositMatchStatus: r.bankDepositMatchStatus,
        bankDepositFitid: r.bankDepositFitid,
      })),
      dateWindowDays: window,
      usedFitids,
    });

    res.json({
      ok: true,
      meta: parsed.meta,
      debitCount: parsed.debitCount,
      report,
    });
  } catch (err) {
    console.error("[bank-statement] analyze error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao analisar extrato." });
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/bank-statement/apply
// --------------------------------------------------------------------------
router.post("/admin/bank-statement/apply", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = getAdminScope(req);
    if (!adminScope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const onlyConfirmed100 = Boolean(req.body?.onlyConfirmed100);
    const matchesRaw = Array.isArray(req.body?.matches) ? req.body.matches : [];
    const notFoundOrderIds = Array.isArray(req.body?.notFoundOrderIds)
      ? req.body.notFoundOrderIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];

    const matches = onlyConfirmed100
      ? matchesRaw.filter((raw: { nameScore?: unknown; matchStatus?: unknown }) => {
          const status = String(raw?.matchStatus || "").trim();
          if (status === "confirmed_100") return true;
          const score = Number(raw?.nameScore);
          return Number.isFinite(score) && score >= 0.999;
        })
      : matchesRaw;

    if (!matches.length && !notFoundOrderIds.length) {
      res.status(400).json({
        error: "INVALID_INPUT",
        message: onlyConfirmed100
          ? "Nenhum match com score 100% para aplicar."
          : "Envie matches e/ou notFoundOrderIds.",
      });
      return;
    }

    let appliedOk = 0;
    let appliedConfirmed100 = 0;
    let appliedNotFound = 0;
    const errors: Array<{ orderId?: string; message: string }> = [];
    const tenantWhere = buildOrderTenantWhere(adminScope.tenantId);

    for (const raw of matches) {
      const orderId = String(raw?.orderId || "").trim();
      const creditFitid = String(raw?.creditFitid || "").trim();
      const creditAmount = Number(raw?.creditAmount);
      const creditPostedAt = String(raw?.creditPostedAt || "").trim().slice(0, 10);
      const creditName = raw?.creditName != null ? String(raw.creditName).trim().slice(0, 255) : null;
      const nameScore = Number(raw?.nameScore);
      const requestedStatus = String(raw?.matchStatus || "").trim();
      const isConfirmed100 =
        requestedStatus === "confirmed_100" ||
        (Number.isFinite(nameScore) && nameScore >= 0.999) ||
        onlyConfirmed100;
      const matchStatus = isConfirmed100 ? "confirmed_100" : "ok";

      if (!orderId || !creditFitid || !Number.isFinite(creditAmount)) {
        errors.push({ orderId, message: "Match incompleto." });
        continue;
      }

      const rows = await db
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.id, orderId), tenantWhere))
        .limit(1);
      const order = rows[0];
      if (!order) {
        errors.push({ orderId, message: "Pedido não encontrado." });
        continue;
      }
      if (!adminScope.hasGlobalAccess && order.sellerCode !== adminScope.sellerCode) {
        errors.push({ orderId, message: "Sem permissão neste pedido." });
        continue;
      }

      const dup = await db
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(
          and(
            tenantWhere,
            eq(ordersTable.bankDepositFitid, creditFitid),
            or(
              eq(ordersTable.bankDepositMatchStatus, "ok"),
              eq(ordersTable.bankDepositMatchStatus, "confirmed_100"),
            ),
            ne(ordersTable.id, orderId),
          ),
        )
        .limit(1);
      if (dup[0]) {
        errors.push({ orderId, message: `FITID já usado no pedido ${dup[0].id}.` });
        continue;
      }

      if (moneyToCents(order.total) !== moneyToCents(creditAmount)) {
        errors.push({ orderId, message: "Valor do crédito ≠ total do pedido." });
        continue;
      }

      await db
        .update(ordersTable)
        .set({
          bankDepositMatchStatus: matchStatus,
          bankDepositFitid: creditFitid,
          bankDepositAmount: String(Math.round(creditAmount * 100) / 100),
          bankDepositPayerName: creditName,
          bankDepositPostedAt: creditPostedAt || null,
          bankDepositMatchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(ordersTable.id, orderId), tenantWhere));

      if (matchStatus === "confirmed_100") appliedConfirmed100 += 1;
      else appliedOk += 1;
    }

    if (notFoundOrderIds.length) {
      const uniqueIds = [...new Set(notFoundOrderIds)];
      const rows = await db
        .select()
        .from(ordersTable)
        .where(and(inArray(ordersTable.id, uniqueIds), tenantWhere));
      for (const order of rows) {
        if (!adminScope.hasGlobalAccess && order.sellerCode !== adminScope.sellerCode) {
          errors.push({ orderId: order.id, message: "Sem permissão neste pedido." });
          continue;
        }
        if (order.bankDepositMatchStatus === "ok" || order.bankDepositMatchStatus === "confirmed_100") {
          continue;
        }
        await db
          .update(ordersTable)
          .set({
            bankDepositMatchStatus: "not_found",
            bankDepositMatchedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(ordersTable.id, order.id), tenantWhere));
        appliedNotFound += 1;
      }
    }

    res.json({
      ok: true,
      appliedOk,
      appliedConfirmed100,
      appliedNotFound,
      errors,
    });
  } catch (err) {
    console.error("[bank-statement] apply error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao aplicar conciliação." });
  }
});

export default router;
