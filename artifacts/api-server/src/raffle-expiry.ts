import { db, raffleReservationsTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";

const EXPIRY_CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

async function expireStaleReservations(): Promise<void> {
  try {
    const now = new Date();
    const result = await db
      .update(raffleReservationsTable)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(raffleReservationsTable.status, "reserved"),
          lt(raffleReservationsTable.expiresAt, now),
        ),
      );

    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    if (affected > 0) {
      console.log(`[RaffleExpiry] Expired ${affected} stale reservation(s).`);
    }
  } catch (err) {
    console.error("[RaffleExpiry] Error expiring reservations:", err);
  }
}

export function startRaffleExpiryJob(): void {
  // Run once shortly after boot
  setTimeout(() => void expireStaleReservations(), 10_000);
  // Then every 5 minutes
  setInterval(() => void expireStaleReservations(), EXPIRY_CHECK_INTERVAL_MS);
  console.log("[RaffleExpiry] Expiry job started (every 5 min).");
}
