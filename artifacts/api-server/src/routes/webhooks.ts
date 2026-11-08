/**
 * Unified Gateway Webhook Handler
 *
 * The gateway calls these URLs when a PIX transaction status changes.
 * We update orders, custom charges and raffle reservations, then
 * broadcast an SSE notification to all connected admin sessions.
 *
 * URL format:
 *   POST /api/webhook/pix/order/:token/:orderId
 *   POST /api/webhook/pix/charge/:token/:chargeId
 *   POST /api/webhook/pix        (generic — gateway uses transactionId to match)
 */
import { Router, type IRouter } from "express";
import type { Request } from "express";
import { db, ordersTable, customChargesTable, raffleReservationsTable } from "@workspace/db";
import { and, eq, notInArray } from "drizzle-orm";
import { broadcastNotification } from "./notifications";
import { ensureOrderCommission } from "../lib/affiliates";
import { sendOutboundWebhook } from "../lib/outbound-webhook";
import { scheduleOrderPaidWhatsapp } from "../lib/whatsapp-n8n";
import { requirePrimaryAdmin } from "./admin-auth";
import { enqueueFilialOrderPurchaseRequest } from "../lib/filial-purchase-queue";
import { allocateOrderLogistics, releaseOrderLogistics } from "../lib/order-logistics";
import { applyEnvioEcomWebhook } from "./envioecom";
import { actionFromStatusChange, addOrderEvent } from "../lib/order-events";
import { confirmRaffleReservationFromPix } from "../lib/raffle-pix-confirm";
import {
  decidePixSettlement,
  pixNoticeLogFields,
  readPixNotice,
  readWebhookSecret,
  type PixNotice,
  type SettlementDecision,
  updatedRowCount,
  webhookAuthenticated,
} from "../lib/pix-settlement";

const router: IRouter = Router();

const WEBHOOK_SHARED_SECRET = String(process.env.WEBHOOK_SHARED_SECRET || "").trim();
const WEBHOOK_DIRECT_TOKEN = String(process.env.WEBHOOK_DIRECT_TOKEN || WEBHOOK_SHARED_SECRET).trim();

type SettlementResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

function requestIsAuthenticated(req: Request, directToken?: string): boolean {
  return webhookAuthenticated({
    sharedSecret: WEBHOOK_SHARED_SECRET,
    providedSecret: readWebhookSecret({
      headerSecret: req.get("x-webhook-secret"),
      signatureHeader: req.get("x-signature"),
      querySecret: req.query?.whsec,
    }),
    directTokenExpected: WEBHOOK_DIRECT_TOKEN,
    providedDirectToken: directToken,
  });
}

function reject(decision: SettlementDecision): SettlementResult {
  return {
    httpStatus: decision.httpStatus,
    body: { ok: false, error: "PIX_SETTLEMENT_REJECTED", reason: decision.reason },
  };
}

function openSettlement(notice: PixNotice, authenticated: boolean, record: {
  boundTransactionId?: string;
  expectedAmount?: number;
  alreadySettled: boolean;
}): SettlementDecision {
  return decidePixSettlement({
    authenticated,
    transactionId: notice.transactionId,
    boundTransactionId: record.boundTransactionId,
    status: notice.status,
    reportedAmount: notice.amount,
    expectedAmount: record.expectedAmount,
    currency: notice.currency,
    alreadySettled: record.alreadySettled,
  });
}

async function settleMatchedOrder(notice: PixNotice, authenticated: boolean): Promise<SettlementResult | null> {
  const transactionId = notice.transactionId || "";
  const existing = await db
    .select({
      id: ordersTable.id,
      tenantId: ordersTable.tenantId,
      status: ordersTable.status,
      total: ordersTable.total,
      transactionId: ordersTable.transactionId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.transactionId, transactionId))
    .limit(1);
  const row = existing[0];
  if (!row) return null;

  const alreadySettled = row.status === "paid" || row.status === "completed";
  const decision = openSettlement(notice, authenticated, {
    boundTransactionId: row.transactionId || "",
    expectedAmount: Number(row.total ?? 0),
    alreadySettled,
  });
  if (decision.action === "reject" || decision.action === "ignore" || decision.action === "duplicate") {
    if (decision.action === "reject") return reject(decision);
    return { httpStatus: decision.httpStatus, body: { ok: true, matched: true, duplicate: decision.action === "duplicate", reason: decision.reason } };
  }

  const tenantId = row.tenantId || "tenant_loja1";
  const nextStatus = decision.action === "pay" ? "paid" : "cancelled";
  const paidPatch = decision.action === "pay" ? { paidAmount: row.total } : {};
  const updated = await db
    .update(ordersTable)
    .set({ status: nextStatus, ...paidPatch, updatedAt: new Date() })
    .where(and(
      eq(ordersTable.id, row.id),
      eq(ordersTable.tenantId, tenantId),
      notInArray(ordersTable.status, ["paid", "completed"]),
    ));

  if (updatedRowCount(updated) < 1) {
    return { httpStatus: 200, body: { ok: true, matched: true, duplicate: true } };
  }

  if (decision.action === "pay") {
    await ensureOrderCommission(row.id);
    await enqueueFilialOrderPurchaseRequest(row.id);
    await allocateOrderLogistics(row.id);
    void sendOutboundWebhook("order_paid", {
      id: row.id,
      transactionId,
      status: "paid",
    }, { tenantId });
    scheduleOrderPaidWhatsapp(row.id);
  } else {
    await releaseOrderLogistics(row.id, tenantId);
  }

  await addOrderEvent({
    orderId: row.id,
    tenantId: row.tenantId,
    action: actionFromStatusChange(row.status, nextStatus),
    actorType: "webhook",
    actorUsername: "PIX",
    payload: { fromStatus: row.status, toStatus: nextStatus, source: "pix_webhook" },
  });
  broadcastNotification({
    type: decision.action === "pay" ? "order_paid" : "order_status_updated",
    data: { id: row.id, transactionId, status: nextStatus, tenantId },
  });
  console.log(`[WEBHOOK] Order ${row.id} updated to ${nextStatus}`);
  return { httpStatus: 200, body: { ok: true, matched: true, updated: "order", status: nextStatus } };
}

async function settleMatchedCharge(notice: PixNotice, authenticated: boolean): Promise<SettlementResult | null> {
  const transactionId = notice.transactionId || "";
  const rows = await db
    .select({
      id: customChargesTable.id,
      tenantId: customChargesTable.tenantId,
      status: customChargesTable.status,
      orderId: customChargesTable.orderId,
      amount: customChargesTable.amount,
      transactionId: customChargesTable.transactionId,
    })
    .from(customChargesTable)
    .where(eq(customChargesTable.transactionId, transactionId))
    .limit(1);
  const row = rows[0];
  if (!row?.transactionId) return null;

  const decision = openSettlement(notice, authenticated, {
    boundTransactionId: row.transactionId,
    expectedAmount: Number(row.amount ?? 0),
    alreadySettled: row.status === "paid",
  });
  if (decision.action === "reject") return reject(decision);
  if (decision.action !== "pay" && decision.action !== "cancel") {
    return { httpStatus: decision.httpStatus, body: { ok: true, matched: true, duplicate: decision.action === "duplicate", reason: decision.reason } };
  }

  const tenantId = row.tenantId || "tenant_loja1";
  const nextStatus = decision.action === "pay" ? "paid" : "cancelled";
  const updated = await db
    .update(customChargesTable)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(and(
      eq(customChargesTable.id, row.id),
      eq(customChargesTable.tenantId, tenantId),
      notInArray(customChargesTable.status, ["paid"]),
    ));
  if (updatedRowCount(updated) < 1) {
    return { httpStatus: 200, body: { ok: true, matched: true, duplicate: true } };
  }

  broadcastNotification({
    type: decision.action === "pay" ? "charge_paid" : "charge_status_updated",
    data: { id: row.id, transactionId, status: nextStatus, tenantId },
  });

  if (decision.action === "pay" && row.orderId) {
    const parentOrder = await db
      .select({ id: ordersTable.id, tenantId: ordersTable.tenantId, status: ordersTable.status, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
      .from(ordersTable)
      .where(and(eq(ordersTable.id, row.orderId), eq(ordersTable.tenantId, tenantId)))
      .limit(1);
    const parent = parentOrder[0];
    if (parent && parent.status !== "paid" && parent.status !== "completed") {
      const orderTotal = Number(parent.total ?? 0);
      const alreadyPaid = Number(parent.paidAmount ?? 0);
      const diffPaid = Number(row.amount ?? 0);
      const totalPaid = alreadyPaid + diffPaid;
      const newOrderStatus = totalPaid >= orderTotal - 0.01 ? "paid" : "awaiting_payment";
      const parentUpdate = await db
        .update(ordersTable)
        .set({ status: newOrderStatus, paidAmount: String(totalPaid), updatedAt: new Date() })
        .where(and(
          eq(ordersTable.id, row.orderId),
          eq(ordersTable.tenantId, tenantId),
          notInArray(ordersTable.status, ["paid", "completed"]),
        ));
      if (updatedRowCount(parentUpdate) > 0) {
        broadcastNotification({
          type: newOrderStatus === "paid" ? "order_paid" : "order_status_updated",
          data: { id: row.orderId, status: newOrderStatus, tenantId },
        });
        if (newOrderStatus === "paid") {
          void sendOutboundWebhook("order_paid", {
            id: row.orderId,
            status: newOrderStatus,
            source: "difference_charge",
          }, { tenantId });
          scheduleOrderPaidWhatsapp(row.orderId);
          await ensureOrderCommission(row.orderId);
          await enqueueFilialOrderPurchaseRequest(row.orderId);
        }
        await addOrderEvent({
          orderId: row.orderId,
          tenantId: row.tenantId,
          action: actionFromStatusChange(parent.status, newOrderStatus),
          actorType: "webhook",
          actorUsername: "PIX",
          payload: { fromStatus: parent.status, toStatus: newOrderStatus, source: "difference_charge", paidAmount: totalPaid },
        });
      }
    }
  }

  console.log(`[WEBHOOK] Charge ${row.id} updated to ${nextStatus}`);
  return { httpStatus: 200, body: { ok: true, matched: true, updated: "charge", status: nextStatus } };
}

async function settleMatchedRaffle(notice: PixNotice, authenticated: boolean): Promise<SettlementResult | null> {
  const transactionId = notice.transactionId || "";
  const [reservation] = await db
    .select({
      id: raffleReservationsTable.id,
      status: raffleReservationsTable.status,
      totalAmount: raffleReservationsTable.totalAmount,
      transactionId: raffleReservationsTable.transactionId,
    })
    .from(raffleReservationsTable)
    .where(eq(raffleReservationsTable.transactionId, transactionId))
    .limit(1);
  if (!reservation?.transactionId) return null;
  if (notice.reservationId && notice.reservationId !== reservation.id) {
    return reject(decidePixSettlement({
      authenticated,
      transactionId,
      boundTransactionId: "reservation-mismatch",
      reportedAmount: notice.amount,
      alreadySettled: false,
    }));
  }

  const decision = openSettlement(notice, authenticated, {
    boundTransactionId: reservation.transactionId,
    expectedAmount: Number(reservation.totalAmount ?? 0),
    alreadySettled: reservation.status === "paid",
  });
  if (decision.action === "reject") return reject(decision);
  if (decision.action !== "pay") {
    return { httpStatus: decision.httpStatus, body: { ok: true, matched: true, reason: decision.reason } };
  }

  const raffle = await confirmRaffleReservationFromPix({
    transactionId,
    confirmed: true,
    source: "pix_webhook",
  });
  return {
    httpStatus: 200,
    body: { ok: true, matched: raffle.matched, raffle: true, confirmed: raffle.confirmed, ignored: raffle.ignored ?? false },
  };
}

async function handleCallback(notice: PixNotice, authenticated: boolean): Promise<SettlementResult> {
  console.log("[WEBHOOK/pix] notice", JSON.stringify(pixNoticeLogFields(notice)));
  if (!authenticated || !notice.transactionId) {
    return reject(openSettlement(notice, authenticated, { alreadySettled: false }));
  }

  const orderResult = await settleMatchedOrder(notice, authenticated);
  if (orderResult) return orderResult;
  const chargeResult = await settleMatchedCharge(notice, authenticated);
  if (chargeResult) return chargeResult;
  const raffleResult = await settleMatchedRaffle(notice, authenticated);
  if (raffleResult) return raffleResult;
  return { httpStatus: 200, body: { ok: true, matched: false } };
}

// Generic webhook — gateway can call with just the transactionId/status
// Handles APPCNPay format: { event, transaction: { id, status, ... }, client }
router.post("/webhook/pix", async (req, res) => {
  try {
    const notice = readPixNotice(req.body);
    const result = await handleCallback(notice, requestIsAuthenticated(req));
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    console.error("[WEBHOOK] settlement failed");
    res.status(500).json({ ok: false, error: "PIX_SETTLEMENT_FAILED" });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const notice = readPixNotice(req.body);
    const result = await handleCallback(notice, requestIsAuthenticated(req));
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    console.error("[WEBHOOK/universal] settlement failed");
    res.status(500).json({ ok: false, error: "PIX_SETTLEMENT_FAILED" });
  }
});

router.post("/webhook/pix/order/:token/:orderId", async (req, res) => {
  try {
    const { token, orderId } = req.params;
    const notice = readPixNotice(req.body);
    if (!requestIsAuthenticated(req, token)) {
      res.status(403).json({ ok: false, error: "PIX_SETTLEMENT_REJECTED", reason: "untrusted" });
      return;
    }
    const rows = await db
      .select({
        id: ordersTable.id,
        tenantId: ordersTable.tenantId,
        status: ordersTable.status,
        total: ordersTable.total,
        transactionId: ordersTable.transactionId,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);
    const row = rows[0];
    if (!row?.transactionId) {
      res.status(404).json({ ok: false, error: "PIX_SETTLEMENT_REJECTED", reason: "missing_transaction" });
      return;
    }
    const decision = openSettlement(notice, true, {
      boundTransactionId: row.transactionId,
      expectedAmount: Number(row.total ?? 0),
      alreadySettled: row.status === "paid" || row.status === "completed",
    });
    if (decision.action !== "pay") {
      const failed = decision.action === "reject";
      res.status(decision.httpStatus).json({
        ok: !failed,
        matched: !failed,
        duplicate: decision.action === "duplicate",
        reason: decision.reason,
      });
      return;
    }
    const tenantId = row.tenantId || "tenant_loja1";
    const updated = await db
      .update(ordersTable)
      .set({ status: "paid", paidAmount: row.total, updatedAt: new Date() })
      .where(and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.tenantId, tenantId),
        eq(ordersTable.transactionId, row.transactionId),
        notInArray(ordersTable.status, ["paid", "completed"]),
      ));
    if (updatedRowCount(updated) < 1) {
      res.json({ ok: true, duplicate: true });
      return;
    }
    await ensureOrderCommission(orderId);
    await enqueueFilialOrderPurchaseRequest(orderId);
    await allocateOrderLogistics(orderId);
    await addOrderEvent({
      orderId,
      tenantId: row.tenantId,
      action: "marked_paid",
      actorType: "webhook",
      actorUsername: "PIX",
      payload: { fromStatus: row.status, toStatus: "paid", source: "direct_order_webhook" },
    });
    broadcastNotification({ type: "order_paid", data: { id: orderId, status: "paid", tenantId } });
    void sendOutboundWebhook("order_paid", { id: orderId, status: "paid", source: "direct_order_webhook" }, { tenantId });
    scheduleOrderPaidWhatsapp(orderId);
    console.log(`[WEBHOOK] Order ${orderId} paid via direct URL`);
    res.json({ ok: true, matched: true, status: "paid" });
  } catch (err) {
    console.error("[WEBHOOK] Order webhook failed");
    res.status(500).json({ ok: false, error: "PIX_SETTLEMENT_FAILED" });
  }
});

router.post("/webhook/pix/charge/:token/:chargeId", async (req, res) => {
  try {
    const { token, chargeId } = req.params;
    const notice = readPixNotice(req.body);
    if (!requestIsAuthenticated(req, token)) {
      res.status(403).json({ ok: false, error: "PIX_SETTLEMENT_REJECTED", reason: "untrusted" });
      return;
    }
    const rows = await db
      .select({
        id: customChargesTable.id,
        tenantId: customChargesTable.tenantId,
        status: customChargesTable.status,
        orderId: customChargesTable.orderId,
        amount: customChargesTable.amount,
        transactionId: customChargesTable.transactionId,
      })
      .from(customChargesTable)
      .where(eq(customChargesTable.id, chargeId))
      .limit(1);
    const row = rows[0];
    if (!row?.transactionId) {
      res.status(404).json({ ok: false, error: "PIX_SETTLEMENT_REJECTED", reason: "missing_transaction" });
      return;
    }
    const forced: PixNotice = { ...notice, transactionId: notice.transactionId };
    const decision = openSettlement(forced, true, {
      boundTransactionId: row.transactionId,
      expectedAmount: Number(row.amount ?? 0),
      alreadySettled: row.status === "paid",
    });
    if (decision.action !== "pay") {
      const failed = decision.action === "reject";
      res.status(decision.httpStatus).json({ ok: !failed, reason: decision.reason, duplicate: decision.action === "duplicate" });
      return;
    }
    const result = await settleMatchedCharge(forced, true);
    res.status(result?.httpStatus ?? 200).json(result?.body ?? { ok: true, matched: false });
  } catch (err) {
    console.error("[WEBHOOK] Charge webhook failed");
    res.status(500).json({ ok: false, error: "PIX_SETTLEMENT_FAILED" });
  }
});

router.post("/webhook/envioecom", async (req, res) => {
  try {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const event = String(req.get("x-webhook-event") || body.event || "").trim().toLowerCase();
    const looksLikeShipment = !!(
      body.barcode
      || body.shipment_id
      || body.status
      || body.situacao
      || body.data
      || body.shipment
      || body.external_order_number
    );
    if (event && event !== "shipment.status_updated" && !looksLikeShipment) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }
    const result = await applyEnvioEcomWebhook(body);
    res.status(200).json({ ok: true, matched: result.matched, orderId: result.orderId || null });
  } catch (err) {
    console.error("[WEBHOOK_ENVIOECOM] Error:", err);
    res.status(200).json({ ok: true, matched: false });
  }
});

router.post("/admin/outbound-webhook/test", requirePrimaryAdmin, async (req, res) => {
  try {
    const result = await sendOutboundWebhook("test", {
      message: "Teste manual disparado pelo painel administrativo.",
      triggeredAt: new Date().toISOString(),
    }, { force: true, tenantId: "tenant_loja1" });

    if (!result.sent) {
      res.status(400).json({ ok: false, error: result.error || "send_failed" });
      return;
    }

    res.json({ ok: true, status: result.status || 200 });
  } catch (err) {
    console.error("[OUTBOUND_WEBHOOK_TEST] Error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
