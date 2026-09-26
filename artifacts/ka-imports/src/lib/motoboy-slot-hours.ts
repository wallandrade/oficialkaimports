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

export const DEFAULT_MOTOBOY_SLOT_PERIODS: MotoboySlotPeriod[] = [
  { startHour: 10, endHour: 20 },
];

export type SlotHoursParseResult =
  | { ok: true; periods: MotoboySlotPeriod[] }
  | { ok: false; message: string };

export function formatMotoboyHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
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
    return DEFAULT_MOTOBOY_SLOT_PERIODS.map((period) => ({ ...period }));
  }
  const parsed = validateMotoboySlotHours(raw);
  return parsed.ok
    ? parsed.periods
    : DEFAULT_MOTOBOY_SLOT_PERIODS.map((period) => ({ ...period }));
}

export function serializeMotoboySlotHours(periods: MotoboySlotPeriod[]): string {
  const parsed = validateMotoboySlotHours({ periods });
  const stored = parsed.ok ? parsed.periods : DEFAULT_MOTOBOY_SLOT_PERIODS;
  return JSON.stringify({ periods: stored });
}

export function nextDraftPeriod(periods: MotoboySlotPeriod[]): MotoboySlotPeriod | null {
  const last = [...periods].sort((left, right) => left.startHour - right.startHour).at(-1);
  const startHour = last ? last.endHour : DEFAULT_MOTOBOY_SLOT_PERIODS[0].startHour;
  if (startHour > 23) return null;
  const endHour = Math.min(24, startHour + 3);
  if (endHour <= startHour) return null;
  return { startHour, endHour };
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

export function getSaoPauloNowParts(): { date: string; hour: number } {
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

export function getMotoboyCalendarBounds(now = getSaoPauloNowParts()): { min: string; max: string; dates: string[] } {
  let min = now.hour >= 18 ? addDaysYmd(now.date, 1) : now.date;
  if (isSundayYmd(min)) min = addDaysYmd(min, 1);
  const max = addDaysYmd(now.date, MOTOBOY_SLOT_HORIZON_DAYS);
  const dates: string[] = [];
  if (min <= max) {
    let cursor = min;
    while (cursor <= max) {
      if (!isSundayYmd(cursor)) dates.push(cursor);
      cursor = addDaysYmd(cursor, 1);
    }
  }
  return { min, max, dates };
}

export function formatMotoboyDayChip(date: string): { weekday: string; day: string } {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" })
    .format(utc)
    .replace(".", "");
  return {
    weekday,
    day: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`,
  };
}

export function motoboyDurationHours(start: string, end: string): number | null {
  const startMatch = /^(\d{2}):00$/.exec(start);
  const endMatch = /^(\d{2}):00$/.exec(end);
  if (!startMatch || !endMatch) return null;
  const startHour = Number(startMatch[1]);
  const endHour = Number(endMatch[1]);
  if (endHour <= startHour || endHour > 24) return null;
  return endHour - startHour;
}

export function formatMotoboyHomePeriod(startTime?: string | null, durationHours?: number | null): string | null {
  const match = /^(\d{2}):00$/.exec(String(startTime || "").trim());
  const startHour = match ? Number(match[1]) : Number.NaN;
  const duration = Number(durationHours);
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) return null;
  if (!Number.isInteger(duration) || duration < 1 || startHour + duration > 24) return null;
  return `das ${formatMotoboyHour(startHour)} às ${formatMotoboyHour(startHour + duration)}`;
}

export function normalizeMotoboySlotOptions(raw: unknown): MotoboySlotOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const start = String((item as { start?: unknown }).start || "");
    const end = String((item as { end?: unknown }).end || "");
    const label = String((item as { label?: unknown }).label || "");
    if (!/^\d{2}:00$/.test(start) || !/^\d{2}:00$/.test(end)) return [];
    return [{ start, end, label: label || `Entrega das ${start} às ${end}` }];
  });
}
