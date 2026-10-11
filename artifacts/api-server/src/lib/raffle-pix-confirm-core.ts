export type RafflePaymentBlockReason = "RESERVATION_EXPIRED" | "NUMBER_ALREADY_ASSIGNED";

type CompetingReservation = {
  id: string;
  numbers: number[];
  status: string;
  expiresAt: Date;
};

export function rafflePaymentBlockReason(input: {
  reservationId: string;
  reservationStatus: string;
  reservationExpiresAt: Date;
  reservationNumbers: number[];
  now: Date;
  competing: CompetingReservation[];
}): RafflePaymentBlockReason | null {
  const reservationExpired = input.reservationStatus === "expired"
    || (input.reservationStatus === "reserved" && input.reservationExpiresAt < input.now);
  if (reservationExpired) return "RESERVATION_EXPIRED";

  const conflict = input.competing.find((row) => {
    if (row.id === input.reservationId) return false;
    const rowExpired = row.status === "reserved" && row.expiresAt < input.now;
    if (rowExpired) return false;
    return row.numbers.some((n) => input.reservationNumbers.includes(n));
  });
  return conflict ? "NUMBER_ALREADY_ASSIGNED" : null;
}
