import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { db, orderBankDepositsTable, ordersTable } from "@workspace/db";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { parseOfxStatement } from "../lib/ofx-bank-statement";
import { reconcileBankStatement } from "../lib/bank-statement-reconcile";
import { isManualInterDepositOrder } from "../lib/bank-deposit-manual";
import {
  deleteOrderDeposits,
  depositLinkRequiresNote,
  ensureOrderDepositsMirrored,
  findDepositByFitid,
  insertOrderDeposit,
  listDepositsForOrders,
  listUsedFitids,
  moneyToCents,
  syncOrderDepositSummary,
} from "../lib/order-bank-deposits";

const router: IRouter = Router();

function formatBrlFromCents(cents: number): string {
  const n = (Math.round(cents) / 100).toFixed(2).replace(".", ",");
  return `R$ ${n}`;
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
// GET /api/admin/bank-deposits — histórico persistente (confirmed_100 e opcionalmente ok)
// query: status?=confirmed_100|ok|all  limit?
// --------------------------------------------------------------------------
router.get("/admin/bank-deposits", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = getAdminScope(req);
    if (!adminScope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const statusFilter = String(req.query.status || "confirmed_100").trim().toLowerCase();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 200;

    const conditions = [buildOrderTenantWhere(adminScope.tenantId)];

    if (statusFilter === "confirmed_100") {
      conditions.push(eq(orderBankDepositsTable.matchStatus, "confirmed_100"));
    } else if (statusFilter === "ok") {
      conditions.push(eq(orderBankDepositsTable.matchStatus, "ok"));
    } else {
      conditions.push(
        or(
          eq(orderBankDepositsTable.matchStatus, "confirmed_100"),
          eq(orderBankDepositsTable.matchStatus, "ok"),
        )!,
      );
    }

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
        clientPhone: ordersTable.clientPhone,
        total: ordersTable.total,
        status: ordersTable.status,
        paymentMethod: ordersTable.paymentMethod,
        sellerCode: ordersTable.sellerCode,
        createdAt: ordersTable.createdAt,
        orderDepositAmount: ordersTable.bankDepositAmount,
        matchStatus: orderBankDepositsTable.matchStatus,
        fitid: orderBankDepositsTable.fitid,
        amount: orderBankDepositsTable.amount,
        payerName: orderBankDepositsTable.payerName,
        postedAt: orderBankDepositsTable.postedAt,
        matchedAt: orderBankDepositsTable.createdAt,
      })
      .from(orderBankDepositsTable)
      .innerJoin(ordersTable, eq(orderBankDepositsTable.orderId, ordersTable.id))
      .where(and(...conditions))
      .orderBy(desc(orderBankDepositsTable.createdAt), desc(ordersTable.createdAt))
      .limit(limit);

    res.json({
      ok: true,
      deposits: rows.map((r) => ({
        orderId: r.id,
        orderNumber: r.orderNumber ?? null,
        clientName: r.clientName,
        clientPhone: r.clientPhone,
        orderTotal: Number(r.total),
        orderStatus: r.status,
        paymentMethod: r.paymentMethod || "pix",
        sellerCode: r.sellerCode,
        orderCreatedAt: r.createdAt?.toISOString?.() ?? null,
        matchStatus: r.matchStatus,
        fitid: r.fitid,
        amount: r.amount != null ? Number(r.amount) : null,
        orderDepositAmount: r.orderDepositAmount != null ? Number(r.orderDepositAmount) : null,
        payerName: r.payerName,
        postedAt: r.postedAt,
        matchedAt: r.matchedAt?.toISOString?.() ?? null,
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error("[bank-statement] list deposits error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar depósitos." });
  }
});

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
        clientDocument: ordersTable.clientDocument,
        total: ordersTable.total,
        createdAt: ordersTable.createdAt,
        status: ordersTable.status,
        paymentMethod: ordersTable.paymentMethod,
        transactionId: ordersTable.transactionId,
        bankDepositMatchStatus: ordersTable.bankDepositMatchStatus,
        bankDepositFitid: ordersTable.bankDepositFitid,
        bankDepositAmount: ordersTable.bankDepositAmount,
      })
      .from(ordersTable)
      .where(and(...conditions));

    const manualRows = rows.filter((r) =>
      isManualInterDepositOrder({
        paymentMethod: r.paymentMethod,
        transactionId: r.transactionId,
      }),
    );

    const usedFitids = await listUsedFitids(buildOrderTenantWhere(adminScope.tenantId));

    const creditsFresh = parsed.credits.filter((c) => !usedFitids.has(c.fitid));
    const skippedDuplicateCredits = parsed.credits.length - creditsFresh.length;

    const report = reconcileBankStatement({
      credits: creditsFresh,
      orders: manualRows.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber ?? null,
        clientName: r.clientName,
        clientDocument: r.clientDocument,
        totalCents: moneyToCents(r.total),
        createdAt: r.createdAt?.toISOString?.() ?? new Date().toISOString(),
        status: r.status,
        bankDepositMatchStatus: r.bankDepositMatchStatus,
        bankDepositFitid: r.bankDepositFitid,
      })),
      dateWindowDays: window,
      usedFitids,
    });

    const depositsByOrder = await listDepositsForOrders(manualRows.map((r) => r.id));
    const linkableOrders = manualRows.map((r) => {
      const links = depositsByOrder.get(r.id) || [];
      const fitids = links.map((d) => d.fitid).filter(Boolean);
      if (!fitids.length && r.bankDepositFitid) fitids.push(r.bankDepositFitid);
      const depositSum = links.length
        ? links.reduce((acc, d) => acc + moneyToCents(d.amount), 0) / 100
        : r.bankDepositFitid
          ? Number(r.bankDepositAmount) || 0
          : 0;
      return {
        orderId: r.id,
        orderNumber: r.orderNumber ?? null,
        clientName: r.clientName,
        total: Number(r.total),
        createdAt: r.createdAt?.toISOString?.() ?? null,
        status: r.status,
        bankDepositMatchStatus: r.bankDepositMatchStatus,
        bankDepositFitid: r.bankDepositFitid,
        bankDepositFitids: fitids,
        bankDepositAmount: depositSum,
      };
    });

    res.json({
      ok: true,
      meta: parsed.meta,
      debitCount: parsed.debitCount,
      skippedDuplicateCredits,
      ordersInRange: rows.length,
      ordersManualOnly: manualRows.length,
      creditsTotal: parsed.credits.length,
      creditsNew: creditsFresh.length,
      credits: parsed.credits.map((c) => ({
        fitid: c.fitid,
        amount: c.amount,
        postedAt: c.postedAt,
        name: c.name,
        memo: c.memo,
        alreadyUsed: usedFitids.has(c.fitid),
      })),
      linkableOrders,
      report,
    });
  } catch (err) {
    console.error("[bank-statement] analyze error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao analisar extrato." });
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/bank-statement/clear
// body: { orderId, fitid? }
// Remove um PIX (fitid) ou todos os depósitos do pedido. Não altera status pago.
// --------------------------------------------------------------------------
router.post("/admin/bank-statement/clear", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = getAdminScope(req);
    if (!adminScope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const orderId = String(req.body?.orderId || "").trim();
    const fitid = String(req.body?.fitid || "").trim();
    if (!orderId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe orderId." });
      return;
    }

    const tenantWhere = buildOrderTenantWhere(adminScope.tenantId);
    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), tenantWhere))
      .limit(1);
    const order = rows[0];
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    if (!adminScope.hasGlobalAccess && order.sellerCode !== adminScope.sellerCode) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão neste pedido." });
      return;
    }

    const previousFitid = fitid || order.bankDepositFitid || null;
    const deleted = await deleteOrderDeposits(orderId, fitid || undefined);
    const summary = await syncOrderDepositSummary({
      orderId,
      tenantWhere,
      orderTotal: order.total,
    });

    res.json({
      ok: true,
      orderId,
      cleared: deleted > 0 || Boolean(order.bankDepositFitid),
      previousFitid,
      previousMatchStatus: order.bankDepositMatchStatus ?? null,
      remainingCount: summary.count,
    });
  } catch (err) {
    console.error("[bank-statement] clear error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao desfazer depósito." });
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
      if (
        !isManualInterDepositOrder({
          paymentMethod: order.paymentMethod,
          transactionId: order.transactionId,
        })
      ) {
        errors.push({ orderId, message: "Pedido não é depósito Inter manual (PIX gateway)." });
        continue;
      }

      const existingOnOrder = await ensureOrderDepositsMirrored(order);
      const alreadyHere = existingOnOrder.find((d) => d.fitid === creditFitid);
      if (alreadyHere) {
        if (matchStatus === "confirmed_100") appliedConfirmed100 += 1;
        else appliedOk += 1;
        continue;
      }

      const dup = await findDepositByFitid(creditFitid);
      if (dup && dup.orderId !== orderId) {
        errors.push({ orderId, message: `FITID já usado no pedido ${dup.orderId}.` });
        continue;
      }

      const existingSum = existingOnOrder.reduce((acc, d) => acc + moneyToCents(d.amount), 0) / 100;
      const noteCheck = depositLinkRequiresNote({
        orderTotal: order.total,
        existingSum,
        creditAmount,
        matchStatus,
      });
      const mismatchNote = String(raw?.amountMismatchNote || "").trim().slice(0, 500);
      if (noteCheck.blocked) {
        errors.push({ orderId, message: noteCheck.message || "Valor do crédito ≠ total do pedido." });
        continue;
      }
      if (noteCheck.requiresNote && mismatchNote.length < 3) {
        errors.push({
          orderId,
          message: "Valor diferente: informe o motivo para vincular.",
        });
        continue;
      }

      const mismatchLine = noteCheck.requiresNote
        ? `OFX: PIX ${formatBrlFromCents(moneyToCents(creditAmount))} (depósitos ${formatBrlFromCents(noteCheck.nextSumCents)}) ≠ pedido ${formatBrlFromCents(moneyToCents(order.total))}. Motivo: ${mismatchNote}`
        : null;
      const nextObservation = mismatchLine
        ? [String(order.observation || "").trim(), mismatchLine].filter(Boolean).join("\n")
        : undefined;

      await insertOrderDeposit({
        tenantId: order.tenantId ?? adminScope.tenantId,
        orderId,
        fitid: creditFitid,
        amount: creditAmount,
        payerName: creditName,
        postedAt: creditPostedAt || null,
        matchStatus,
        note: noteCheck.requiresNote ? mismatchNote : null,
      });
      await syncOrderDepositSummary({
        orderId,
        tenantWhere,
        orderTotal: order.total,
      });
      if (nextObservation !== undefined) {
        await db
          .update(ordersTable)
          .set({ observation: nextObservation, updatedAt: new Date() })
          .where(and(eq(ordersTable.id, orderId), tenantWhere));
      }

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
        if (
          !isManualInterDepositOrder({
            paymentMethod: order.paymentMethod,
            transactionId: order.transactionId,
          })
        ) {
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
