import crypto from "crypto";
import { and, eq, gte, lte } from "drizzle-orm";
import {
  db,
  motoboyCepRangesTable,
  motoboyDeliveryReservationsTable,
  motoboyNeighborhoodsTable,
  siteSettingsTable,
  tenantSettingsTable,
} from "@workspace/db";
import { isMotoboyDistanceSlotId, MOTOBOY_DISTANCE_SLOT_ID } from "./motoboy-distance";
import {
  addDaysYmd,
  findPeriodByStartTime,
  formatMotoboyHour,
  intervalOverlapsPeriod,
  isSundayYmd,
  listAvailableSlotOptions,
  MOTOBOY_SLOT_HORIZON_DAYS,
  MOTOBOY_SLOT_HOURS_KEY,
  occupiedIntervalsFromReservations,
  resolveMotoboySlotPeriods,
  type MotoboySlotPeriod,
} from "./motoboy-slot-hours";

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

function parseDeliveryTarget(input: MotoboyScheduleInput): {
  neighborhoodId: string;
  deliveryAreaType: "neighborhood" | "cepRange";
  date: string;
} {
  const neighborhoodId = String(input?.neighborhoodId || "").trim();
  const deliveryAreaType = input?.deliveryAreaType === "cepRange" ? "cepRange" : "neighborhood";
  const date = String(input?.date || "").trim();

  if (!neighborhoodId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Selecione uma data e um período válidos para o motoboy.");
  }
  if (date < getSaoPauloNow().date) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "A data de entrega não pode estar no passado.");
  }

  return { neighborhoodId, deliveryAreaType, date };
}

function parseBookedTime(timeRaw: unknown): { hour: number; time: string } {
  const time = String(timeRaw || "").trim();
  const match = /^(\d{2}):00$/.exec(time);
  const hour = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(hour)) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Selecione um período de entrega válido.");
  }
  return { hour, time: formatMotoboyHour(hour) };
}

function distanceDeliveryArea() {
  return {
    id: MOTOBOY_DISTANCE_SLOT_ID,
    name: "Motoboy por km",
    city: null as string | null,
  };
}

async function getSettingValue(tenantId: string, key: string): Promise<string | null> {
  const tenantRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);

  if (tenantRows[0]?.value != null) return tenantRows[0].value;

  const legacyRows = await db
    .select({ value: siteSettingsTable.value })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.key, key))
    .limit(1);

  return legacyRows[0]?.value ?? null;
}

async function loadSlotPeriods(tenantId: string): Promise<MotoboySlotPeriod[]> {
  const raw = await getSettingValue(tenantId, MOTOBOY_SLOT_HOURS_KEY);
  return resolveMotoboySlotPeriods(raw);
}

async function resolveDeliveryArea(
  tenantId: string,
  neighborhoodId: string,
  deliveryAreaType: "neighborhood" | "cepRange",
) {
  if (isMotoboyDistanceSlotId(neighborhoodId)) {
    return distanceDeliveryArea();
  }

  const [deliveryArea] = deliveryAreaType === "cepRange"
    ? await db.select({
        id: motoboyCepRangesTable.id,
        name: motoboyCepRangesTable.label,
        city: motoboyCepRangesTable.city,
      }).from(motoboyCepRangesTable).where(and(
        eq(motoboyCepRangesTable.id, neighborhoodId),
        eq(motoboyCepRangesTable.tenantId, tenantId),
        eq(motoboyCepRangesTable.isActive, true),
      )).limit(1)
    : await db.select({
        id: motoboyNeighborhoodsTable.id,
        name: motoboyNeighborhoodsTable.neighborhoodName,
        city: motoboyNeighborhoodsTable.city,
      }).from(motoboyNeighborhoodsTable).where(and(
        eq(motoboyNeighborhoodsTable.id, neighborhoodId),
        eq(motoboyNeighborhoodsTable.tenantId, tenantId),
        eq(motoboyNeighborhoodsTable.isActive, true),
      )).limit(1);

  return deliveryArea ?? null;
}

async function loadOccupiedIntervals(tenantId: string, date: string, tx?: DbTransaction) {
  const queryDb = tx ?? db;
  const reservations = await queryDb
    .select({
      orderId: motoboyDeliveryReservationsTable.orderId,
      slotHour: motoboyDeliveryReservationsTable.slotHour,
      startTime: motoboyDeliveryReservationsTable.startTime,
      durationHours: motoboyDeliveryReservationsTable.durationHours,
    })
    .from(motoboyDeliveryReservationsTable)
    .where(and(
      eq(motoboyDeliveryReservationsTable.tenantId, tenantId),
      eq(motoboyDeliveryReservationsTable.deliveryDate, date),
    ));
  return occupiedIntervalsFromReservations(reservations);
}

export async function getMotoboyAvailability(tenantId: string, input: MotoboyScheduleInput) {
  const { neighborhoodId, deliveryAreaType, date } = parseDeliveryTarget(input);
  const deliveryArea = await resolveDeliveryArea(tenantId, neighborhoodId, deliveryAreaType);

  if (!deliveryArea) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Área não disponível para entrega por motoboy.");
  }

  const periods = await loadSlotPeriods(tenantId);
  const slots = listAvailableSlotOptions({
    periods,
    date,
    now: getSaoPauloNow(),
    occupied: await loadOccupiedIntervals(tenantId, date),
    isSunday: isSundayYmd(date),
  });

  return { slots };
}

export async function reserveMotoboySchedule(
  tx: DbTransaction,
  tenantId: string,
  orderId: string,
  input: MotoboyScheduleInput,
) {
  const { neighborhoodId, deliveryAreaType, date } = parseDeliveryTarget(input);
  const { time } = parseBookedTime(input.time);
  const deliveryCepDigits = String(input.deliveryCep || "").replace(/\D/g, "");
  const deliveryCep = deliveryCepDigits.length === 8 ? Number(deliveryCepDigits) : null;
  const deliveryCity = normalizeCity(input.deliveryCity);
  const isDistanceSlot = isMotoboyDistanceSlotId(neighborhoodId);

  if (!isDistanceSlot && deliveryAreaType === "cepRange" && (deliveryCep == null || !deliveryCity)) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "CEP ou cidade inválidos para a faixa de entrega selecionada.");
  }

  const deliveryArea = isDistanceSlot
    ? distanceDeliveryArea()
    : deliveryAreaType === "cepRange"
      ? (await tx.select({
          id: motoboyCepRangesTable.id,
          name: motoboyCepRangesTable.label,
          city: motoboyCepRangesTable.city,
        }).from(motoboyCepRangesTable).where(and(
          eq(motoboyCepRangesTable.id, neighborhoodId),
          eq(motoboyCepRangesTable.tenantId, tenantId),
          eq(motoboyCepRangesTable.isActive, true),
          lte(motoboyCepRangesTable.cepStart, deliveryCep!),
          gte(motoboyCepRangesTable.cepEnd, deliveryCep!),
        )).limit(1))[0]
      : (await tx.select({
          id: motoboyNeighborhoodsTable.id,
          name: motoboyNeighborhoodsTable.neighborhoodName,
          city: motoboyNeighborhoodsTable.city,
        }).from(motoboyNeighborhoodsTable).where(and(
          eq(motoboyNeighborhoodsTable.id, neighborhoodId),
          eq(motoboyNeighborhoodsTable.tenantId, tenantId),
          eq(motoboyNeighborhoodsTable.isActive, true),
        )).limit(1))[0];

  if (!deliveryArea) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Área não disponível para entrega por motoboy.");
  }
  if (!isDistanceSlot && deliveryAreaType === "cepRange" && normalizeCity(deliveryArea.city) !== deliveryCity) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "A faixa de CEP não pertence à cidade informada.");
  }

  const periods = await loadSlotPeriods(tenantId);
  const period = findPeriodByStartTime(periods, time);
  if (!period) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "Esse período não está disponível.");
  }

  const saoPauloNow = getSaoPauloNow();
  if (isSundayYmd(date)) {
    throw new MotoboyScheduleError("DELIVERY_SLOT_UNAVAILABLE", "Não realizamos entregas por motoboy aos domingos.");
  }
  if (date > addDaysYmd(saoPauloNow.date, MOTOBOY_SLOT_HORIZON_DAYS)) {
    throw new MotoboyScheduleError("INVALID_MOTOBOY_SCHEDULE", "A entrega por motoboy pode ser marcada em até 14 dias.");
  }
  if (date === saoPauloNow.date && period.endHour <= saoPauloNow.hour) {
    throw new MotoboyScheduleError("DELIVERY_SLOT_UNAVAILABLE", "Esse período já encerrou. Escolha outro período.");
  }

  const occupied = await loadOccupiedIntervals(tenantId, date, tx);
  if (occupied.some((interval) => intervalOverlapsPeriod(period, interval))) {
    throw new MotoboyScheduleError("DELIVERY_SLOT_UNAVAILABLE", "Esse período acabou de ser ocupado. Escolha outro período.");
  }

  const durationHours = period.endHour - period.startHour;
  try {
    await tx.insert(motoboyDeliveryReservationsTable).values({
      id: crypto.randomBytes(8).toString("hex"),
      tenantId,
      orderId,
      neighborhoodId: isDistanceSlot ? MOTOBOY_DISTANCE_SLOT_ID : neighborhoodId,
      neighborhoodName: deliveryArea.name,
      city: deliveryArea.city,
      deliveryDate: date,
      slotHour: period.startHour,
      startTime: formatMotoboyHour(period.startHour),
      durationHours,
    });
  } catch (error) {
    const databaseError = error as { code?: string; cause?: { code?: string } };
    if (databaseError.code === "ER_DUP_ENTRY" || databaseError.cause?.code === "ER_DUP_ENTRY") {
      throw new MotoboyScheduleError("DELIVERY_SLOT_UNAVAILABLE", "Esse período acabou de ser ocupado. Escolha outro período.");
    }
    throw error;
  }

  return { date, time: formatMotoboyHour(period.startHour), durationHours };
}
