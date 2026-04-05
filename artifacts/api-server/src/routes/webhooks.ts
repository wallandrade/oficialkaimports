/**
 * Unified Gateway Webhook Handler
 *
 * The gateway calls these URLs when a PIX transaction status changes.
 * We update both orders and custom-charges tables accordingly, then
 * broadcast an SSE notification to all connected admin sessions.
 *
 * URL format:
 *   POST /api/webhook/pix/order/:token/:orderId
 *   POST /api/webhook/pix/charge/:token/:chargeId
 *   POST /api/webhook/pix        (generic — gateway uses transactionId to match)
 */
import { Router, type IRouter } from "express";
import { db, ordersTable, customChargesTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { broadcastNotification } from "./notifications";
import { isPaymentConfirmed } from "../gateway";
import { incrementCouponUse } from "./coupons";
import { ensureOrderCommission } from "../lib/affiliates";

const router: IRouter = Router();

interface GatewayCallback {
  transactionId?: string;
  identifier?: string;
  status?: string;
  amount?: number;
  paidAt?: string;
  metadata?: Record<string, string>;
}

async function handleCallback(body: GatewayCallback) {
  const { transactionId, identifier, status, metadata } = body;

  console.log("[WEBHOOK] Received:", JSON.stringify({ transactionId, identifier, status, metadata }));

  if (!status) {
    console.log("[WEBHOOK] No status, ignoring.");
    return { matched: false };
  }

  const confirmed = isPaymentConfirmed(status);
  const cancelled = ["CANCELED", "REJECTED", "FAILED"].includes((status || "").toUpperCase());

  // -----------------------------------------------------------------------
  // 1. Try to update orders table
  // -----------------------------------------------------------------------
  let orderUpdated = false;

  if (transactionId) {
    const existing = await db
      .select({ id: ordersTable.id, status: ordersTable.status, couponCode: ordersTable.couponCode, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
      .from(ordersTable)
      .where(eq(ordersTable.transactionId, transactionId))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0]!;
      // Don't downgrade already-paid orders
      if (row.status !== "paid" && row.status !== "completed") {
        const newStatus = confirmed ? "paid" : cancelled ? "cancelled" : row.status;
        if (newStatus !== row.status) {
          const setPaidAmount = confirmed && !row.paidAmount && row.total ? { paidAmount: row.total } : {};
          await db
            .update(ordersTable)
            .set({ status: newStatus, ...setPaidAmount, updatedAt: new Date() })
            .where(eq(ordersTable.id, row.id));

          if (confirmed && row.couponCode) {
            await incrementCouponUse(row.couponCode);
          }

          if (confirmed && newStatus === "paid") {
            await ensureOrderCommission(row.id);
          }

          broadcastNotification({
            type: confirmed ? "order_paid" : "order_status_updated",
            data: { id: row.id, transactionId, status: newStatus },
          });

          console.log(`[WEBHOOK] Order ${row.id} updated to ${newStatus}`);
        }
      }
      orderUpdated = true;
    }
  }

  // -----------------------------------------------------------------------
  // 2. Try to update custom charges table
  // -----------------------------------------------------------------------
  let chargeUpdated = false;

  if (transactionId || metadata?.chargeId) {
    let rows: Array<{ id: string; status: string; orderId: string | null; amount: string | null }> = [];

    if (metadata?.chargeId) {
      rows = await db
        .select({ id: customChargesTable.id, status: customChargesTable.status, orderId: customChargesTable.orderId, amount: customChargesTable.amount })
        .from(customChargesTable)
        .where(eq(customChargesTable.id, metadata.chargeId))
        .limit(1);
    }

    if (rows.length === 0 && transactionId) {
      rows = await db
        .select({ id: customChargesTable.id, status: customChargesTable.status, orderId: customChargesTable.orderId, amount: customChargesTable.amount })
        .from(customChargesTable)
        .where(eq(customChargesTable.transactionId, transactionId))
        .limit(1);
    }

    if (rows.length > 0) {
      const row = rows[0]!;
      if (row.status !== "paid") {
        const newStatus = confirmed ? "paid" : cancelled ? "cancelled" : row.status;
        if (newStatus !== row.status) {
          await db
            .update(customChargesTable)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(customChargesTable.id, row.id));

          broadcastNotification({
            type: confirmed ? "charge_paid" : "charge_status_updated",
            data: { id: row.id, transactionId, status: newStatus },
          });

          console.log(`[WEBHOOK] Charge ${row.id} updated to ${newStatus}`);

          // If this charge is linked to an order (difference charge), propagate payment to the parent order
          if (confirmed && row.orderId) {
            const parentOrder = await db
              .select({ id: ordersTable.id, status: ordersTable.status, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
              .from(ordersTable)
              .where(eq(ordersTable.id, row.orderId))
              .limit(1);

            if (parentOrder[0] && parentOrder[0].status === "awaiting_payment") {
              const orderTotal = Number(parentOrder[0].total ?? 0);
              const alreadyPaid = Number(parentOrder[0].paidAmount ?? 0);
              const diffPaid = Number(row.amount ?? 0);
              const totalPaid = alreadyPaid + diffPaid;

              // If cumulative payments cover the order total, mark as paid
              const newOrderStatus = totalPaid >= orderTotal - 0.01 ? "paid" : "awaiting_payment";
              await db
                .update(ordersTable)
                .set({ status: newOrderStatus, paidAmount: String(totalPaid), updatedAt: new Date() })
                .where(eq(ordersTable.id, row.orderId));

              broadcastNotification({
                type: "order_paid",
                data: { id: row.orderId, status: newOrderStatus },
              });

              if (newOrderStatus === "paid") {
                await ensureOrderCommission(row.orderId);
              }

              console.log(`[WEBHOOK] Order ${row.orderId} auto-updated to ${newOrderStatus} after diff charge paid (paid=${totalPaid}, total=${orderTotal})`);
            }
          }
        }
      }
      chargeUpdated = true;
    }
  }

  return { matched: orderUpdated || chargeUpdated, orderUpdated, chargeUpdated };
}

// Generic webhook — gateway can call with just the transactionId/status
// Handles APPCNPay format: { event, transaction: { id, status, ... }, client }
router.post("/webhook/pix", async (req, res) => {
  try {
    const raw = req.body as Record<string, unknown>;
    console.log("[WEBHOOK/pix] Raw body:", JSON.stringify(raw));

    // Normalize APPCNPay envelope: fields may be nested inside `transaction`
    const tx = (raw.transaction as Record<string, unknown>) ?? raw;
    const normalized: GatewayCallback = {
      transactionId: String(tx.id || raw.transactionId || raw.transaction_id || "").trim() || undefined,
      identifier:    String(tx.identifier || raw.identifier || "").trim() || undefined,
      status:        String(tx.status || raw.status || raw.event || "").trim() || undefined,
      amount:        Number(tx.amount ?? tx.chargeAmount ?? tx.originalAmount ?? raw.amount) || undefined,
      paidAt:        String(tx.payedAt || tx.paidAt || raw.paidAt || "").trim() || undefined,
    };

    // Map APPCNPay event name to a status if status is still missing
    if (!normalized.status && raw.event) {
      const ev = String(raw.event).toUpperCase();
      if (ev.includes("PAID") || ev.includes("COMPLETED") || ev.includes("APPROVED")) {
        normalized.status = "COMPLETED";
      } else if (ev.includes("CANCEL") || ev.includes("REJECT") || ev.includes("FAILED")) {
        normalized.status = "CANCELED";
      }
    }

    console.log("[WEBHOOK/pix] Normalized:", JSON.stringify(normalized));

    const result = await handleCallback(normalized);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[WEBHOOK] Error:", err);
    res.json({ ok: false });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL WEBHOOK — accepts any payment gateway or platform
//
// Accepted status values (case-insensitive):
//   PAID / OK / APPROVED / CONFIRMED / COMPLETED / SUCCESS  → mark paid
//   CANCELED / CANCELLED / REJECTED / FAILED / REFUNDED     → mark cancelled
//
// Accepted body formats:
//   { transactionId, status }                              (APPCNPay, generic)
//   { id, status }                                         (many gateways)
//   { transaction_id, status }                             (snake_case variant)
//   { payment: { id, status } }                            (nested)
//   { data: { id, status } }                               (webhook wrapper)
//   { orderId, status }                                    (direct order update)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  try {
    // Normalize various payload shapes into our standard GatewayCallback
    const body = req.body as Record<string, unknown>;

    // Unwrap common wrapper fields
    const payload: Record<string, unknown> =
      (body.payment  as Record<string, unknown>) ||
      (body.data     as Record<string, unknown>) ||
      (body.event    as Record<string, unknown>) ||
      body;

    const rawTxId: string =
      String(payload.transactionId  || payload.transaction_id || payload.txid ||
             payload.id             || payload.identifier     || payload.externalId ||
             payload.external_id    || payload.reference      || payload.charge_id || "");

    const rawStatus: string =
      String(payload.status || payload.state || payload.situation || payload.paymentStatus ||
             payload.payment_status || "");

    const rawOrderId: string =
      String(body.orderId || payload.orderId || payload.order_id || payload.metadata?.orderId || "");

    console.log(`[WEBHOOK/universal] txId=${rawTxId} status=${rawStatus} orderId=${rawOrderId}`);

    if (!rawStatus) {
      console.log("[WEBHOOK/universal] No status field found, ignoring.");
      res.json({ ok: true, matched: false, reason: "no_status" });
      return;
    }

    // Normalise statuses
    const up = rawStatus.toUpperCase();
    const confirmedStatuses = ["PAID", "OK", "APPROVED", "CONFIRMED", "COMPLETED", "SUCCESS", "CONCLUIDO", "CONCLUÍDA", "PAGO", "PAGA"];
    const canceledStatuses  = ["CANCELED", "CANCELLED", "REJECTED", "FAILED", "REFUNDED", "CHARGEBACK", "CANCELADO", "CANCELADA"];

    const isConfirmed = confirmedStatuses.some((s) => up.includes(s));
    const isCanceled  = canceledStatuses.some((s) => up.includes(s));

    // Build normalized callback
    const normalized: GatewayCallback = {
      transactionId: rawTxId || undefined,
      status:        isConfirmed ? "OK" : isCanceled ? "CANCELED" : rawStatus,
    };

    // If orderId is directly specified, update that order
    if (rawOrderId) {
      const rows = await db
        .select({ id: ordersTable.id, status: ordersTable.status, couponCode: ordersTable.couponCode, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
        .from(ordersTable)
        .where(eq(ordersTable.id, rawOrderId))
        .limit(1);

      if (rows.length > 0 && rows[0]!.status !== "paid" && rows[0]!.status !== "completed") {
        const newStatus = isConfirmed ? "paid" : isCanceled ? "cancelled" : rows[0]!.status;
        const setFields: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
        if (isConfirmed && !rows[0]!.paidAmount && rows[0]!.total) setFields.paidAmount = rows[0]!.total;
        await db.update(ordersTable).set(setFields).where(eq(ordersTable.id, rawOrderId));
        if (isConfirmed && rows[0]!.couponCode) await incrementCouponUse(rows[0]!.couponCode);
        if (isConfirmed && newStatus === "paid") await ensureOrderCommission(rawOrderId);
        broadcastNotification({ type: isConfirmed ? "order_paid" : "order_status_updated", data: { id: rawOrderId, status: newStatus } });
        console.log(`[WEBHOOK/universal] Order ${rawOrderId} → ${newStatus}`);
        res.json({ ok: true, matched: true, updated: "order", id: rawOrderId, status: newStatus });
        return;
      }
    }

    const result = await handleCallback(normalized);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[WEBHOOK/universal] Error:", err);
    res.json({ ok: false });
  }
});

// Per-order webhook URL
router.post("/webhook/pix/order/:token/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const body = req.body as GatewayCallback;

    // Also patch by orderId directly in case transactionId isn't in the body
    if (orderId && isPaymentConfirmed(body.status || "")) {
      const rows = await db
        .select({ id: ordersTable.id, status: ordersTable.status, couponCode: ordersTable.couponCode, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
        .from(ordersTable)
        .where(eq(ordersTable.id, orderId))
        .limit(1);

      if (rows.length > 0 && rows[0]!.status !== "paid" && rows[0]!.status !== "completed") {
        const paidNow = !rows[0]!.paidAmount && rows[0]!.total ? rows[0]!.total : undefined;
        await db
          .update(ordersTable)
          .set({ status: "paid", transactionId: body.transactionId || rows[0]!.id, ...(paidNow ? { paidAmount: paidNow } : {}), updatedAt: new Date() })
          .where(eq(ordersTable.id, orderId));

        if (rows[0]!.couponCode) await incrementCouponUse(rows[0]!.couponCode);

        await ensureOrderCommission(orderId);

        broadcastNotification({ type: "order_paid", data: { id: orderId, status: "paid" } });
        console.log(`[WEBHOOK] Order ${orderId} paid via direct URL`);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[WEBHOOK] Order webhook error:", err);
    res.json({ ok: false });
  }
});

// Per-charge webhook URL
router.post("/webhook/pix/charge/:token/:chargeId", async (req, res) => {
  try {
    const { chargeId } = req.params;
    const body = req.body as GatewayCallback;

    if (chargeId && isPaymentConfirmed(body.status || "")) {
      const rows = await db
        .select({ id: customChargesTable.id, status: customChargesTable.status, orderId: customChargesTable.orderId, amount: customChargesTable.amount })
        .from(customChargesTable)
        .where(eq(customChargesTable.id, chargeId))
        .limit(1);

      if (rows.length > 0 && rows[0]!.status !== "paid") {
        await db
          .update(customChargesTable)
          .set({ status: "paid", transactionId: body.transactionId || rows[0]!.id, updatedAt: new Date() })
          .where(eq(customChargesTable.id, chargeId));

        broadcastNotification({ type: "charge_paid", data: { id: chargeId, status: "paid" } });
        console.log(`[WEBHOOK] Charge ${chargeId} paid via direct URL`);

        // Propagate to parent order if this is a diff charge
        if (rows[0]!.orderId) {
          const parentOrder = await db
            .select({ id: ordersTable.id, status: ordersTable.status, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
            .from(ordersTable)
            .where(eq(ordersTable.id, rows[0]!.orderId))
            .limit(1);

          if (parentOrder[0] && parentOrder[0].status === "awaiting_payment") {
            const orderTotal   = Number(parentOrder[0].total ?? 0);
            const alreadyPaid  = Number(parentOrder[0].paidAmount ?? 0);
            const diffPaid     = Number(rows[0]!.amount ?? 0);
            const totalPaid    = alreadyPaid + diffPaid;
            const newOrderStatus = totalPaid >= orderTotal - 0.01 ? "paid" : "awaiting_payment";

            await db
              .update(ordersTable)
              .set({ status: newOrderStatus, paidAmount: String(totalPaid), updatedAt: new Date() })
              .where(eq(ordersTable.id, rows[0]!.orderId));

            broadcastNotification({ type: "order_paid", data: { id: rows[0]!.orderId, status: newOrderStatus } });
            console.log(`[WEBHOOK] Order ${rows[0]!.orderId} auto-updated to ${newOrderStatus} after diff charge (direct URL)`);

            if (newOrderStatus === "paid") {
              await ensureOrderCommission(rows[0]!.orderId);
            }
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[WEBHOOK] Charge webhook error:", err);
    res.json({ ok: false });
  }
});

export default router;
