import crypto from "crypto";
import { and, eq, gte, lte } from "drizzle-orm";
import {
  db,
  motoboyCepRangesTable,
  motoboyDeliveryReservationsTable,
  motoboyNeighborhoodsTable,
} from "@workspace/db";

const FIRST_SLOT_HOUR = 10;
const END_OF_DAY_HOUR = 20;
const NEARBY_MAX_PRICE = 75;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MotoboyScheduleInput = {
  neighborhoodId?: unknown;
  deliveryAreaType?: unknown;
  deliveryCep?: unknown;
  deliveryCity?: unknown;
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

function normalizeCity(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
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

function isSunday(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

function parseSchedule(input: MotoboyScheduleInput): { neighborhoodId: string; deliveryAreaType: "neighborhood" | "cepRange"; date: string; hour: number; time: string } {
  const neighborhoodId = String(input?.neighborhoodId || "").trim();
  const deliveryAreaType = input?.deliveryAreaType === "cepRange" ? "cepRange" : "neighborhood";
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

  return { neighborhoodId, deliveryAreaType, date, hour, time };
}

export function getMotoboyDurationHours(price: unknown): number {
  return Number(price) <= NEARBY_MAX_PRICE ? 1 : 2;
}

export async function getMotoboyAvailability(tenantId: string, input: MotoboyScheduleInput) {
  const { neighborhoodId, deliveryAreaType, date } = parseSchedule({ ...input, time: input.time || "10:00" });
  const [deliveryArea] = deliveryAreaType === "cepRange"
    ? await db.select({
        id: motoboyCepRangesTable.id,
        name: motoboyCepRangesTable.label,
        city: motoboyCepRangesTable.city,
        durationHours: motoboyCepRangesTable.intervalHours,
      }).from(motoboyCepRangesTable).where(and(
        eq(motoboyCepRangesTable.id, neighborhoodId),
        eq(motoboyCepRangesTable.tenantId, tenantId),
        eq(motoboyCepRangesTable.isActive, true),
      )).limit(1)
    : await db.select({
        id: motoboyNeighborhoodsTable.id,
        name: motoboyNeighborhoodsTable.neighborhoodName,
        city: motoboyNeighborhoodsTable.city,
        price: motoboyNeighborhoodsTable.price,
      }).from(motoboyNeighborhoodsTable).where(and(
        eq(motoboyNeighborhoodsTable.id, neighborhoodId),
        eq(motoboyNeighborhoodsTable.tenantId, tenantId),
        eq(motoboyNeighborhoodsTable.isActive, true),
      )).limit(1);

  if (!deliveryArea) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Área não disponível para entrega por motoboy.");
  }

  const durationHours = "durationHours" in deliveryArea
    ? deliveryArea.durationHours
    : getMotoboyDurationHours(deliveryArea.price);
  if (isSunday(date)) {
    return { slots: [], durationHours, deliveryArea };
  }
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

  return { slots, durationHours, deliveryArea };
}

export async function reserveMotoboySchedule(
  tx: DbTransaction,
  tenantId: string,
  orderId: string,
  input: MotoboyScheduleInput,
) {
  const { neighborhoodId, deliveryAreaType, date, hour, time } = parseSchedule(input);
  const deliveryCepDigits = String(input.deliveryCep || "").replace(/\D/g, "");
  const deliveryCep = deliveryCepDigits.length === 8 ? Number(deliveryCepDigits) : null;
  const deliveryCity = normalizeCity(input.deliveryCity);
  if (deliveryAreaType === "cepRange" && (deliveryCep == null || !deliveryCity)) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "CEP ou cidade inválidos para a faixa de entrega selecionada.");
  }
  const [deliveryArea] = deliveryAreaType === "cepRange"
    ? await tx.select({
        id: motoboyCepRangesTable.id,
        name: motoboyCepRangesTable.label,
        city: motoboyCepRangesTable.city,
        durationHours: motoboyCepRangesTable.intervalHours,
      }).from(motoboyCepRangesTable).where(and(
        eq(motoboyCepRangesTable.id, neighborhoodId),
        eq(motoboyCepRangesTable.tenantId, tenantId),
        eq(motoboyCepRangesTable.isActive, true),
        lte(motoboyCepRangesTable.cepStart, deliveryCep!),
        gte(motoboyCepRangesTable.cepEnd, deliveryCep!),
      )).limit(1)
    : await tx.select({
        id: motoboyNeighborhoodsTable.id,
        name: motoboyNeighborhoodsTable.neighborhoodName,
        city: motoboyNeighborhoodsTable.city,
        price: motoboyNeighborhoodsTable.price,
      }).from(motoboyNeighborhoodsTable).where(and(
        eq(motoboyNeighborhoodsTable.id, neighborhoodId),
        eq(motoboyNeighborhoodsTable.tenantId, tenantId),
        eq(motoboyNeighborhoodsTable.isActive, true),
      )).limit(1);

  if (!deliveryArea) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Área não disponível para entrega por motoboy.");
  }
  if (deliveryAreaType === "cepRange" && normalizeCity(deliveryArea.city) !== deliveryCity) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "A faixa de CEP não pertence à cidade informada.");
  }

  const durationHours = "durationHours" in deliveryArea
    ? deliveryArea.durationHours
    : getMotoboyDurationHours(deliveryArea.price);
  const saoPauloNow = getSaoPauloNow();
  if (isSunday(date)) {
    throw new MotoboyScheduleError("DELIVERY_SLOT_UNAVAILABLE", "Não realizamos entregas por motoboy aos domingos.");
  }
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
        neighborhoodName: deliveryArea.name,
        city: deliveryArea.city,
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
