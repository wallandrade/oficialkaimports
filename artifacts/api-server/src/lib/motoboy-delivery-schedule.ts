import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  motoboyDeliveryReservationsTable,
  motoboyNeighborhoodsTable,
} from "@workspace/db";

const FIRST_SLOT_HOUR = 10;
const END_OF_DAY_HOUR = 20;
const NEARBY_MAX_PRICE = 75;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MotoboyScheduleInput = {
  neighborhoodId?: unknown;
  date?: unknown;
  time?: unknown;
};

export class MotoboyScheduleError extends Error {
  constructor(
    public readonly code: "INVALID_MOTOBOY_SCHEDULE" | "DELIVERY_SLOT_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

function getSaoPauloNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    hour: Number(value.hour),
  };
}

function parseSchedule(input: MotoboyScheduleInput): { neighborhoodId: string; date: string; hour: number; time: string } {
  const neighborhoodId = String(input?.neighborhoodId || "").trim();
  const date = String(input?.date || "").trim();
  const time = String(input?.time || "").trim();
  const match = /^(\d{2}):00$/.exec(time);
  const hour = match ? Number(match[1]) : Number.NaN;

  if (!neighborhoodId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(hour)) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Selecione uma data e um horário válidos para o motoboy.");
  }
  if (date < getSaoPauloNow().date) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "A data de entrega não pode estar no passado.");
  }

  return { neighborhoodId, date, hour, time };
}

export function getMotoboyDurationHours(price: unknown): number {
  return Number(price) <= NEARBY_MAX_PRICE ? 1 : 2;
}

export async function getMotoboyAvailability(tenantId: string, input: MotoboyScheduleInput) {
  const { neighborhoodId, date } = parseSchedule({ ...input, time: input.time || "10:00" });
  const [neighborhood] = await db
    .select()
    .from(motoboyNeighborhoodsTable)
    .where(and(
      eq(motoboyNeighborhoodsTable.id, neighborhoodId),
      eq(motoboyNeighborhoodsTable.tenantId, tenantId),
      eq(motoboyNeighborhoodsTable.isActive, true),
    ))
    .limit(1);

  if (!neighborhood) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Bairro não disponível para entrega por motoboy.");
  }

  const durationHours = getMotoboyDurationHours(neighborhood.price);
  const reservations = await db
    .select({ slotHour: motoboyDeliveryReservationsTable.slotHour })
    .from(motoboyDeliveryReservationsTable)
    .where(and(
      eq(motoboyDeliveryReservationsTable.tenantId, tenantId),
      eq(motoboyDeliveryReservationsTable.deliveryDate, date),
    ));
  const occupiedHours = new Set(reservations.map((reservation) => reservation.slotHour));
  const slots: string[] = [];
  const saoPauloNow = getSaoPauloNow();

  for (let hour = FIRST_SLOT_HOUR; hour + durationHours <= END_OF_DAY_HOUR; hour += 1) {
    if (date === saoPauloNow.date && hour <= saoPauloNow.hour) continue;
    const isAvailable = Array.from({ length: durationHours }, (_, offset) => hour + offset)
      .every((slotHour) => !occupiedHours.has(slotHour));
    if (isAvailable) slots.push(`${String(hour).padStart(2, "0")}:00`);
  }

  return { slots, durationHours, neighborhood };
}

export async function reserveMotoboySchedule(
  tx: DbTransaction,
  tenantId: string,
  orderId: string,
  input: MotoboyScheduleInput,
) {
  const { neighborhoodId, date, hour, time } = parseSchedule(input);
  const [neighborhood] = await tx
    .select()
    .from(motoboyNeighborhoodsTable)
    .where(and(
      eq(motoboyNeighborhoodsTable.id, neighborhoodId),
      eq(motoboyNeighborhoodsTable.tenantId, tenantId),
      eq(motoboyNeighborhoodsTable.isActive, true),
    ))
    .limit(1);

  if (!neighborhood) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Bairro não disponível para entrega por motoboy.");
  }

  const durationHours = getMotoboyDurationHours(neighborhood.price);
  const saoPauloNow = getSaoPauloNow();
  if (hour < FIRST_SLOT_HOUR || hour + durationHours > END_OF_DAY_HOUR) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "O horário selecionado está fora do período de entregas.");
  }
  if (date === saoPauloNow.date && hour <= saoPauloNow.hour) {
    throw new MotoboyScheduleError("DELIVERY_SLOT_UNAVAILABLE", "Esse horário já passou. Escolha outro horário.");
  }

  try {
    await tx.insert(motoboyDeliveryReservationsTable).values(
      Array.from({ length: durationHours }, (_, offset) => ({
        id: crypto.randomBytes(8).toString("hex"),
        tenantId,
        orderId,
        neighborhoodId,
        neighborhoodName: neighborhood.neighborhoodName,
        city: neighborhood.city,
        deliveryDate: date,
        slotHour: hour + offset,
        startTime: time,
        durationHours,
      })),
    );
  } catch (error) {
    const databaseError = error as { code?: string; cause?: { code?: string } };
    if (databaseError.code === "ER_DUP_ENTRY" || databaseError.cause?.code === "ER_DUP_ENTRY") {
      throw new MotoboyScheduleError("DELIVERY_SLOT_UNAVAILABLE", "Esse horário acabou de ser ocupado. Escolha outro horário.");
    }
    throw error;
  }

  return { date, time, durationHours };
}
