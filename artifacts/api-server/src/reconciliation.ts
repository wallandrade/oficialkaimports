/**
 * Order Expiration Job
 *
 * The APPCNPay gateway explicitly blocks server-side status polling
 * ("Tentativa de polling bloqueada!"). Payment confirmation is handled
 * exclusively via webhooks (POST /api/webhook/pix).
 *
 * This job runs every hour and expires orders/charges that have been
 * awaiting payment for more than 24 hours without a webhook confirmation.
 * Admins can still manually mark any order as paid using the admin panel.
 */

import { db, ordersTable, customChargesTable } from "@workspace/db";
import { eq, or, lt, and } from "drizzle-orm";
import { broadcastNotification } from "./routes/notifications";

const INTERVAL_MS      = 60 * 60 * 1000; // 1 hour
const EXPIRY_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours

async function expireStaleOrders(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - EXPIRY_THRESHOLD);

    const expired = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(
        and(
          or(eq(ordersTable.status, "awaiting_payment"), eq(ordersTable.status, "pending")),
          lt(ordersTable.createdAt, cutoff)
        )
      );

    if (expired.length === 0) return;

    for (const row of expired) {
      await db
        .update(ordersTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(ordersTable.id, row.id));

      broadcastNotification({
        type: "order_expired",
        data: { id: row.id, status: "cancelled" },
      });

      console.log(`[EXPIRE] Order ${row.id} expired (> 24h without payment).`);
    }
  } catch (err) {
    console.error("[EXPIRE] orders error:", err);
  }
}

async function expireStaleCharges(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - EXPIRY_THRESHOLD);

    const expired = await db
      .select({ id: customChargesTable.id })
      .from(customChargesTable)
      .where(
        and(
          or(eq(customChargesTable.status, "awaiting_payment"), eq(customChargesTable.status, "pending")),
          lt(customChargesTable.createdAt, cutoff)
        )
      );

    if (expired.length === 0) return;

    for (const row of expired) {
      await db
        .update(customChargesTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(customChargesTable.id, row.id));

      console.log(`[EXPIRE] Charge ${row.id} expired (> 24h without payment).`);
    }
  } catch (err) {
    console.error("[EXPIRE] charges error:", err);
  }
}

async function runExpiration(): Promise<void> {
  await expireStaleOrders();
  await expireStaleCharges();
}

export function startReconciliationJob(): void {
  console.log("[EXPIRE] Starting order expiration job (every 1h, expires after 24h).");

  // Run after a 5-minute delay on startup to avoid interfering with boot
  setTimeout(() => void runExpiration(), 5 * 60 * 1000);

  setInterval(() => {
    void runExpiration();
  }, INTERVAL_MS);
}
