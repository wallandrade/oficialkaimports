export const META_ADS_SPEND_PATH = "/api/integrations/meta-ads/spend";
export const META_ADS_CHANNEL = "Facebook";
export const META_ADS_NOTE = "Importado da Yury (conta C2)";
export const META_ADS_ID_PREFIX = "yury-meta-ads:";
const MAX_WINDOW_DAYS = 31;

export type MetaAdsDayAction =
  | { action: "delete"; id: string; date: string }
  | { action: "upsert"; id: string; date: string; amount: string; start: Date; end: Date };

export type MetaAdsSpendPlan = {
  since: string;
  until: string;
  actions: MetaAdsDayAction[];
};

export function getYuryMetaAdsSyncToken(): string {
  return String(process.env.YURY_META_ADS_SYNC_TOKEN || "").trim();
}

export function isYuryMetaAdsSyncConfigured(): boolean {
  return Boolean(getYuryMetaAdsSyncToken());
}

export function yuryMetaAdsSpendUrl(base: string): string {
  const root = String(base || "").trim().replace(/\/$/, "");
  return `${root}${META_ADS_SPEND_PATH}`;
}

export function metaAdsExpenseId(date: string): string {
  return `${META_ADS_ID_PREFIX}${date}`;
}

/** 404 e 503 só geram log. 200 entra no parser. O resto preserva o que já está salvo. */
export function metaAdsHttpDisposition(status: number): "log" | "parse" | "keep" {
  if (status === 404 || status === 503) return "log";
  if (status === 200) return "parse";
  return "keep";
}

export function planMetaAdsSpend(body: unknown): MetaAdsSpendPlan | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as {
    source?: unknown;
    currency?: unknown;
    since?: unknown;
    until?: unknown;
    days?: unknown;
  };
  if (payload.source !== "yury-imports" || payload.currency !== "BRL") return null;
  if (typeof payload.since !== "string" || typeof payload.until !== "string") return null;
  if (!Array.isArray(payload.days)) return null;

  const window = datesInWindow(payload.since, payload.until);
  if (!window) return null;

  const amounts = new Map<string, number>();
  for (const day of payload.days) {
    if (!day || typeof day !== "object") return null;
    const row = day as { date?: unknown; amount?: unknown };
    if (typeof row.date !== "string" || !isIsoDate(row.date)) return null;
    if (typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount < 0) return null;
    if (amounts.has(row.date)) return null;
    amounts.set(row.date, row.amount);
  }

  for (const date of window) {
    if (!amounts.has(date)) return null;
  }

  const actions: MetaAdsDayAction[] = [];
  for (const date of window) {
    const amount = toMoney(amounts.get(date)!);
    if (!amount) return null;
    const id = metaAdsExpenseId(date);
    if (amount === "0.00") {
      actions.push({ action: "delete", id, date });
      continue;
    }
    const bounds = saoPauloDayBounds(date);
    actions.push({ action: "upsert", id, date, amount, start: bounds.start, end: bounds.end });
  }
  return { since: payload.since, until: payload.until, actions };
}

export function isOwnedMetaAdsExpenseId(id: string): boolean {
  const date = id.startsWith(META_ADS_ID_PREFIX) ? id.slice(META_ADS_ID_PREFIX.length) : "";
  return isIsoDate(date) && id === metaAdsExpenseId(date);
}

function datesInWindow(since: string, until: string): string[] | null {
  if (!isIsoDate(since) || !isIsoDate(until) || since > until) return null;
  const dates: string[] = [];
  let cursor = since;
  for (let i = 0; i < MAX_WINDOW_DAYS; i += 1) {
    dates.push(cursor);
    if (cursor === until) return dates;
    cursor = addIsoDays(cursor, 1);
  }
  return null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = utc.getUTCFullYear();
  const nextMonth = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(utc.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function toMoney(amount: number): string | null {
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(cents) || cents < 0) return null;
  return (cents / 100).toFixed(2);
}

export function saoPauloDayBounds(date: string): { start: Date; end: Date } {
  return {
    start: new Date(`${date}T00:00:00.000-03:00`),
    end: new Date(`${date}T23:59:59.000-03:00`),
  };
}
