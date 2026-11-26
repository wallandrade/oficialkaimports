export type RafflePaymentBlockReason = "RESERVATION_EXPIRED" | "NUMBER_ALREADY_ASSIGNED";

export function canUndoManualRafflePayment(input: {
  status: string;
  paidSource: string | null | undefined;
}): boolean {
  return input.status === "paid" && input.paidSource === "manual";
}

type CompetingReservation = {
  id: string;
  numbers: number[];
  status: string;
  expiresAt: Date;
};

export function reservationCountsAsExpired(status: string, expiresAt: Date, now: Date): boolean {
  return status === "expired" || (status === "reserved" && expiresAt < now);
}

/** Número ainda ocupado: pago, ou reservado dentro do prazo. Expirado não segura o número. */
export function activeConflictingNumbers(input: {
  reservationId: string;
  reservationNumbers: number[];
  now: Date;
  competing: CompetingReservation[];
}): number[] {
  const wanted = new Set(input.reservationNumbers);
  const conflicts = new Set<number>();
  for (const row of input.competing) {
    if (row.id === input.reservationId) continue;
    const holdsNumber = row.status === "paid"
      || (row.status === "reserved" && row.expiresAt >= input.now);
    if (!holdsNumber) continue;
    for (const n of row.numbers) {
      if (wanted.has(n)) conflicts.add(n);
    }
  }
  return [...conflicts].sort((a, b) => a - b);
}

export function raffleNumberConflictMessage(numbers: number[]): string {
  if (numbers.length === 1) {
    return `O número ${numbers[0]} já está em outra reserva ativa ou paga.`;
  }
  const listed = numbers.length === 2
    ? `${numbers[0]} e ${numbers[1]}`
    : `${numbers.slice(0, -1).join(", ")} e ${numbers[numbers.length - 1]}`;
  return `Os números ${listed} já estão em outra reserva ativa ou paga.`;
}

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

export type ManualRafflePaymentDecision =
  | { ok: true }
  | {
      ok: false;
      httpStatus: 400 | 409;
      error: "RESERVATION_EXPIRED" | "NUMBER_ALREADY_ASSIGNED" | "RAFFLE_ALREADY_DRAWN";
      message: string;
      conflictNumbers?: number[];
    };

const GENERIC_NUMBER_CONFLICT = "Algum número desta reserva já está em outra reserva ativa ou paga.";

/**
 * Sem force, a reserva expirada continua recusada.
 * Com force, expirada entra se os números ainda estiverem livres e a rifa não foi sorteada.
 */
export function decideManualRafflePayment(input: {
  force: boolean;
  reservationId: string;
  reservationStatus: string;
  reservationExpiresAt: Date;
  reservationNumbers: number[];
  now: Date;
  competing: CompetingReservation[];
  raffleDrawn: boolean;
}): ManualRafflePaymentDecision {
  const expired = reservationCountsAsExpired(
    input.reservationStatus,
    input.reservationExpiresAt,
    input.now,
  );
  if (!input.force && expired) {
    return {
      ok: false,
      httpStatus: 400,
      error: "RESERVATION_EXPIRED",
      message: "A reserva expirou. Não é possível aprovar o pagamento.",
    };
  }

  if (input.force && input.raffleDrawn) {
    return {
      ok: false,
      httpStatus: 409,
      error: "RAFFLE_ALREADY_DRAWN",
      message: "A rifa já foi sorteada. Não é possível forçar o pagamento.",
    };
  }

  const conflictNumbers = activeConflictingNumbers(input);
  if (conflictNumbers.length > 0) {
    if (!input.force) {
      return {
        ok: false,
        httpStatus: 409,
        error: "NUMBER_ALREADY_ASSIGNED",
        message: GENERIC_NUMBER_CONFLICT,
      };
    }
    return {
      ok: false,
      httpStatus: 409,
      error: "NUMBER_ALREADY_ASSIGNED",
      message: raffleNumberConflictMessage(conflictNumbers),
      conflictNumbers,
    };
  }

  return { ok: true };
}
