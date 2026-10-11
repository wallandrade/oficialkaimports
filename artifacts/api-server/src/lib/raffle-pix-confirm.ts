import { db, raffleReservationsTable } from "@workspace/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { rafflePaymentBlockReason, type RafflePaymentBlockReason } from "./raffle-pix-confirm-core";

function parseNumbers(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as number[]; } catch { return []; }
}

function buildRaffleReservationsTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(
      eq(raffleReservationsTable.tenantId, tenantId),
      isNull(raffleReservationsTable.tenantId),
      eq(raffleReservationsTable.tenantId, ""),
    );
  }
  return eq(raffleReservationsTable.tenantId, tenantId);
}

export type RafflePixConfirmResult = {
  matched: boolean;
  confirmed: boolean;
  ignored?: boolean;
  reason?: RafflePaymentBlockReason | "NOT_FOUND" | "NOT_CONFIRMED";
  reservationId?: string;
};

export async function confirmRaffleReservationFromPix(input: {
  transactionId?: string;
  reservationId?: string;
  confirmed: boolean;
  source?: string;
}): Promise<RafflePixConfirmResult> {
  const transactionId = String(input.transactionId || "").trim();
  const reservationId = String(input.reservationId || "").trim();
  const source = input.source || "raffle-pix";

  if (!transactionId && !reservationId) {
    return { matched: false, confirmed: false, reason: "NOT_FOUND" };
  }

  const [reservation] = transactionId
    ? await db
      .select()
      .from(raffleReservationsTable)
      .where(eq(raffleReservationsTable.transactionId, transactionId))
      .limit(1)
    : await db
      .select()
      .from(raffleReservationsTable)
      .where(eq(raffleReservationsTable.id, reservationId))
      .limit(1);

  if (!reservation) {
    return { matched: false, confirmed: false, reason: "NOT_FOUND" };
  }

  if (!input.confirmed) {
    return { matched: true, confirmed: false, reservationId: reservation.id, reason: "NOT_CONFIRMED" };
  }

  if (reservation.status === "paid") {
    return { matched: true, confirmed: true, reservationId: reservation.id };
  }

  const tenantId = String(reservation.tenantId || "").trim() || DEFAULT_TENANT_ID;
  const now = new Date();
  const reservationNumbers = parseNumbers(reservation.numbers);
  const competingRows = reservationNumbers.length > 0
    ? await db
      .select({
        id: raffleReservationsTable.id,
        numbers: raffleReservationsTable.numbers,
        status: raffleReservationsTable.status,
        expiresAt: raffleReservationsTable.expiresAt,
      })
      .from(raffleReservationsTable)
      .where(and(
        buildRaffleReservationsTenantWhere(tenantId),
        eq(raffleReservationsTable.raffleId, reservation.raffleId),
        inArray(raffleReservationsTable.status, ["reserved", "paid"]),
      ))
    : [];

  const reason = rafflePaymentBlockReason({
    reservationId: reservation.id,
    reservationStatus: reservation.status,
    reservationExpiresAt: reservation.expiresAt,
    reservationNumbers,
    now,
    competing: competingRows.map((row) => ({
      id: row.id,
      numbers: parseNumbers(row.numbers),
      status: row.status,
      expiresAt: row.expiresAt,
    })),
  });

  if (reason) {
    await db
      .update(raffleReservationsTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(buildRaffleReservationsTenantWhere(tenantId), eq(raffleReservationsTable.id, reservation.id)));

    console.log("[RaffleWebhook] Ignored late/conflicting payment", JSON.stringify({
      reservationId: reservation.id,
      transactionId,
      source,
      reason,
    }));

    return {
      matched: true,
      confirmed: false,
      ignored: true,
      reason,
      reservationId: reservation.id,
    };
  }

  await db
    .update(raffleReservationsTable)
    .set({ status: "paid", updatedAt: new Date() })
    .where(and(buildRaffleReservationsTenantWhere(tenantId), eq(raffleReservationsTable.id, reservation.id)));

  console.log("[RaffleWebhook] Reservation paid", JSON.stringify({
    id: reservation.id,
    transactionId,
    source,
  }));

  return { matched: true, confirmed: true, reservationId: reservation.id };
}
