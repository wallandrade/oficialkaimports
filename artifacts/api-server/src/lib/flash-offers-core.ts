const SAO_PAULO_OFFSET = "-03:00";

export type SaoPauloClock = {
  hour: number;
  dayKey: string;
};

export function saoPauloClock(date: Date): SaoPauloClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const hour = Number(read("hour"));
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    dayKey: `${read("year")}-${read("month")}-${read("day")}`,
  };
}

export function saoPauloDayStart(date: Date): Date {
  const { dayKey } = saoPauloClock(date);
  return new Date(`${dayKey}T00:00:00${SAO_PAULO_OFFSET}`);
}

export function isCampaignHourOpen(
  activeFromHour: number | null | undefined,
  activeUntilHour: number | null | undefined,
  hour: number,
): boolean {
  const hasFrom = activeFromHour != null && Number.isFinite(activeFromHour);
  const hasUntil = activeUntilHour != null && Number.isFinite(activeUntilHour);
  if (!hasFrom && !hasUntil) return true;
  const start = hasFrom ? Number(activeFromHour) : 0;
  if (!hasUntil) return hour >= start;
  const end = Number(activeUntilHour);
  if (end < start) return hour >= start || hour <= end;
  return hour >= start && hour <= end;
}

export function rollDraw(percent: number, random: number): boolean {
  const chance = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  if (chance <= 0) return false;
  if (chance >= 100) return true;
  return random * 100 < chance;
}

export function normalizeVisitorKey(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(value)) return "";
  return value;
}

export function normalizeHour(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

export type FlashPriceHit = {
  productId: string;
  unitPrice: number;
};

export function unitPriceWithFlash(input: {
  catalogUnitPrice: number;
  flash: FlashPriceHit | null;
  productId: string;
  isBump: boolean;
}): number {
  if (!input.flash || input.isBump) return input.catalogUnitPrice;
  if (input.productId !== input.flash.productId) return input.catalogUnitPrice;
  return input.flash.unitPrice;
}

export function flashLineQuantityError(input: {
  flashProductId: string | null;
  lines: Array<{ id?: string; quantity?: number; isBump?: boolean }>;
}): string | null {
  if (!input.flashProductId) return null;
  const line = input.lines.find((item) => {
    if (item.isBump === true) return false;
    return String(item.id || "").trim() === input.flashProductId;
  });
  if (!line) return null;
  const quantity = Number(line.quantity) || 0;
  if (quantity !== 1) return "A promoção relâmpago vale para 1 unidade.";
  return null;
}
