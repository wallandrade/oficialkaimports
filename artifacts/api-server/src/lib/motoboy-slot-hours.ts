export const MOTOBOY_SLOT_HOURS_KEY = "motoboy_slot_hours";
export const MOTOBOY_SLOT_HORIZON_DAYS = 14;
export const MOTOBOY_HOME_REMINDER = "Alguém precisa estar em casa nesse intervalo.";

export type MotoboySlotPeriod = {
  startHour: number;
  endHour: number;
};

export type MotoboySlotOption = {
  start: string;
  end: string;
  label: string;
};

export type OccupiedInterval = {
  start: number;
  end: number;
};

export const DEFAULT_MOTOBOY_SLOT_PERIODS: MotoboySlotPeriod[] = [
  { startHour: 10, endHour: 20 },
];

export type SlotHoursParseResult =
  | { ok: true; periods: MotoboySlotPeriod[] }
  | { ok: false; message: string };

export function formatMotoboyHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function motoboyPeriodLabel(period: MotoboySlotPeriod): string {
  return `Entrega das ${formatMotoboyHour(period.startHour)} às ${formatMotoboyHour(period.endHour)}`;
}

export function addDaysYmd(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function isSundayYmd(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return false;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

function clonePeriods(periods: MotoboySlotPeriod[]): MotoboySlotPeriod[] {
  return periods.map((period) => ({ startHour: period.startHour, endHour: period.endHour }));
}

function periodsCross(left: MotoboySlotPeriod, right: MotoboySlotPeriod): boolean {
  return left.startHour < right.endHour && right.startHour < left.endHour;
}

export function validateMotoboySlotHours(raw: unknown): SlotHoursParseResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: false, message: "Informe pelo menos um período." };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, message: "O JSON dos períodos do Motoboy é inválido." };
    }
  }

  const periodsRaw = parsed && typeof parsed === "object" && "periods" in parsed
    ? (parsed as { periods?: unknown }).periods
    : null;
  if (!Array.isArray(periodsRaw) || periodsRaw.length === 0) {
    return { ok: false, message: "Informe pelo menos um período." };
  }

  const periods: MotoboySlotPeriod[] = [];
  for (const item of periodsRaw) {
    if (!item || typeof item !== "object") {
      return { ok: false, message: "Cada período precisa de início e fim." };
    }
    const startHour = Number((item as { startHour?: unknown }).startHour);
    const endHour = Number((item as { endHour?: unknown }).endHour);
    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
      return { ok: false, message: "O início do período precisa ser uma hora inteira de 0 a 23." };
    }
    if (!Number.isInteger(endHour) || endHour < 1 || endHour > 24) {
      return { ok: false, message: "O fim do período precisa ser uma hora inteira de 1 a 24." };
    }
    if (endHour <= startHour) {
      return { ok: false, message: "O fim do período precisa ser depois do início." };
    }
    periods.push({ startHour, endHour });
  }

  periods.sort((left, right) => left.startHour - right.startHour);
  for (let index = 1; index < periods.length; index += 1) {
    if (periodsCross(periods[index - 1], periods[index])) {
      return { ok: false, message: "Os períodos não podem se cruzar. Encostar no mesmo horário pode." };
    }
  }

  return { ok: true, periods };
}

export function resolveMotoboySlotPeriods(raw: unknown): MotoboySlotPeriod[] {
  if (raw == null || (typeof raw === "string" && !raw.trim())) {
    return clonePeriods(DEFAULT_MOTOBOY_SLOT_PERIODS);
  }
  const parsed = validateMotoboySlotHours(raw);
  return parsed.ok ? parsed.periods : clonePeriods(DEFAULT_MOTOBOY_SLOT_PERIODS);
}

export function serializeMotoboySlotHours(periods: MotoboySlotPeriod[]): string {
  const parsed = validateMotoboySlotHours({ periods });
  const stored = parsed.ok ? parsed.periods : clonePeriods(DEFAULT_MOTOBOY_SLOT_PERIODS);
  return JSON.stringify({ periods: stored });
}

export function slotOptionFromPeriod(period: MotoboySlotPeriod): MotoboySlotOption {
  return {
    start: formatMotoboyHour(period.startHour),
    end: formatMotoboyHour(period.endHour),
    label: motoboyPeriodLabel(period),
  };
}

export function occupiedIntervalsFromReservations(rows: Array<{
  orderId: string;
  slotHour: number;
  startTime: string;
  durationHours: number;
}>): OccupiedInterval[] {
  const byOrder = new Map<string, OccupiedInterval>();
  for (const row of rows) {
    if (byOrder.has(row.orderId)) continue;
    const match = /^(\d{2}):00$/.exec(String(row.startTime || "").trim());
    const start = match ? Number(match[1]) : row.slotHour;
    const duration = Number.isInteger(row.durationHours) && row.durationHours >= 1 ? row.durationHours : 1;
    if (!Number.isInteger(start)) continue;
    byOrder.set(row.orderId, { start, end: start + duration });
  }
  return [...byOrder.values()];
}

export function intervalOverlapsPeriod(period: MotoboySlotPeriod, interval: OccupiedInterval): boolean {
  return period.startHour < interval.end && interval.start < period.endHour;
}

export function listAvailableSlotOptions(input: {
  periods: MotoboySlotPeriod[];
  date: string;
  now: { date: string; hour: number };
  occupied: OccupiedInterval[];
  isSunday: boolean;
}): MotoboySlotOption[] {
  if (input.isSunday) return [];
  if (input.date < input.now.date) return [];
  if (input.date > addDaysYmd(input.now.date, MOTOBOY_SLOT_HORIZON_DAYS)) return [];

  return input.periods
    .filter((period) => {
      if (input.date === input.now.date && period.endHour <= input.now.hour) return false;
      return !input.occupied.some((interval) => intervalOverlapsPeriod(period, interval));
    })
    .map(slotOptionFromPeriod);
}

export function findPeriodByStartTime(periods: MotoboySlotPeriod[], time: string): MotoboySlotPeriod | null {
  const match = /^(\d{2}):00$/.exec(String(time || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  return periods.find((period) => period.startHour === hour) ?? null;
}

export function nextDraftPeriod(periods: MotoboySlotPeriod[]): MotoboySlotPeriod | null {
  const last = [...periods].sort((left, right) => left.startHour - right.startHour).at(-1);
  const startHour = last ? last.endHour : DEFAULT_MOTOBOY_SLOT_PERIODS[0].startHour;
  if (startHour > 23) return null;
  const endHour = Math.min(24, startHour + 3);
  if (endHour <= startHour) return null;
  return { startHour, endHour };
}
