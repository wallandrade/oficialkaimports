export const LOGISTICS_DAILY_CAPACITY = 20;
export const LOGISTICS_BASE_HOURS = 48;
export const LOGISTICS_CAPACITY_STATUSES = ["allocated", "shipped"] as const;
const LOGISTICS_DEADLINE_HOUR = 18;

export function calculateLogisticsPromisedHours(dayOffset: number, backlogDays: number): number {
  return LOGISTICS_BASE_HOURS + ((Math.max(0, dayOffset) + Math.max(0, backlogDays)) * 24);
}

export function consumesLogisticsCapacity(status: unknown): boolean {
  return LOGISTICS_CAPACITY_STATUSES.includes(String(status || "") as (typeof LOGISTICS_CAPACITY_STATUSES)[number]);
}

export function isStandardShipping(shippingType: unknown): boolean {
  const normalized = String(shippingType || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return !normalized.includes("motoboy") && !normalized.includes("retirada") && !normalized.includes("pickup");
}

export function getSaoPauloDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function addBusinessDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  let remaining = Math.max(0, Math.trunc(amount));
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

export function buildLogisticsDeadline(dispatchDate: string): Date {
  return new Date(`${dispatchDate}T${String(LOGISTICS_DEADLINE_HOUR).padStart(2, "0")}:00:00-03:00`);
}