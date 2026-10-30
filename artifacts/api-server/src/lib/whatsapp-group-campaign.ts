export const GROUP_SETTING_KEYS = {
  campaignEnabled: "whatsapp_group_campaign_enabled",
  productIds: "whatsapp_group_product_ids",
  chats: "whatsapp_group_chats",
  peptideEnabled: "whatsapp_group_peptide_enabled",
} as const;

export const PRODUCT_HOURS = [9, 13, 17, 21] as const;
export const MAX_GROUPS = 6;
export const MAX_PRODUCT_IDS = 200;
export const MAX_CAPTION = 1000;
export const MAX_LINK = 500;
export const MAX_TIMES = 12;
export const GROUP_WINDOW_MINUTES = 2;
export const GROUP_OFFSET_MINUTES = 3;

const SAO_PAULO = "America/Sao_Paulo";
const SAO_PAULO_OFFSET_HOURS = 3;
const GROUP_PHONE_RE = /^(\d{8,20})(?:-(\d{1,20}|group))?$/;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type GroupChat = { name: string; phone: string };
export type ScheduleMode = "once" | "times" | "interval";

export type ScheduleInput = {
  scheduledAt: string;
  scheduleMode: ScheduleMode;
  scheduleTimes: string[];
  intervalHours: number | null;
  durationDays: number | null;
};

export type CampaignProduct = { id: string; name: string; image: string };

export type SpClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateKey: string;
};

type ParseOk<T> = { ok: true; value: T };
type ParseFail = { ok: false; message: string };

export function saoPauloClock(date: Date): SpClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const year = Number(bag.year);
  const month = Number(bag.month);
  const day = Number(bag.day);
  const minute = Number(bag.minute);
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, hour, minute, dateKey };
}

export function spLocalToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + SAO_PAULO_OFFSET_HOURS, minute, 0, 0));
}

export function parseSpLocal(value: string): Date | null {
  const match = LOCAL_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = spLocalToUtc(year, month, day, hour, minute);
  const clock = saoPauloClock(date);
  if (clock.year !== year || clock.month !== month || clock.day !== day || clock.hour !== hour || clock.minute !== minute) {
    return null;
  }
  return date;
}

export function formatSpLocal(date: Date): string {
  const clock = saoPauloClock(date);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${clock.dateKey}T${pad(clock.hour)}:${pad(clock.minute)}`;
}

export function minuteInGroupWindow(minute: number, groupIndex: number): boolean {
  if (groupIndex < 0 || groupIndex >= MAX_GROUPS) return false;
  const start = groupIndex * GROUP_OFFSET_MINUTES;
  return minute >= start && minute <= start + GROUP_WINDOW_MINUTES - 1;
}

export function groupWindowContains(now: Date, anchor: Date, groupIndex: number): boolean {
  if (groupIndex < 0 || groupIndex >= MAX_GROUPS) return false;
  const start = anchor.getTime() + groupIndex * GROUP_OFFSET_MINUTES * 60 * 1000;
  const end = start + GROUP_WINDOW_MINUTES * 60 * 1000;
  const time = now.getTime();
  return time >= start && time < end;
}

export function zapiMainCredentials(env: NodeJS.ProcessEnv = process.env): { instanceId: string; token: string; clientToken: string } | null {
  const instanceId = String(env.ZAPI_MAIN_INSTANCE_ID || "").trim();
  const token = String(env.ZAPI_MAIN_TOKEN || "").trim();
  const clientToken = String(env.ZAPI_CLIENT_TOKEN || "").trim();
  if (!instanceId || !token || !clientToken) return null;
  if (instanceId.includes("/") || token.includes("/")) return null;
  return { instanceId, token, clientToken };
}

export function parseGroupChats(raw: unknown): { ok: true; chats: GroupChat[] } | ParseFail {
  if (raw == null) return { ok: true, chats: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "A lista de grupos é inválida." };
  if (raw.length > MAX_GROUPS) return { ok: false, message: "No máximo 6 grupos." };
  const chats: GroupChat[] = [];
  for (const item of raw) {
    const record = item && typeof item === "object" ? item as { name?: unknown; phone?: unknown } : {};
    const phone = String(record.phone ?? "").trim();
    const name = String(record.name ?? "").trim().slice(0, 80);
    if (!phone && !name) continue;
    if (!GROUP_PHONE_RE.test(phone)) {
      return { ok: false, message: "Identificador de grupo inválido. Use o número do grupo, com sufixo -números ou -group." };
    }
    chats.push({ name, phone });
  }
  return { ok: true, chats };
}

export function parseProductIds(raw: unknown): { ok: true; ids: string[] } | ParseFail {
  if (raw == null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "A lista de produtos é inválida." };
  if (raw.length > MAX_PRODUCT_IDS) return { ok: false, message: "No máximo 200 produtos." };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item ?? "").trim();
    if (!id || seen.has(id)) continue;
    if (id.length > 255) return { ok: false, message: "Há um produto com identificador inválido." };
    seen.add(id);
    ids.push(id);
  }
  return { ok: true, ids };
}

export function pickCampaignProduct(products: CampaignProduct[], dayOfMonth: number, hour: number): CampaignProduct | null {
  const hourIndex = PRODUCT_HOURS.indexOf(hour as (typeof PRODUCT_HOURS)[number]);
  if (hourIndex < 0 || products.length === 0) return null;
  const eligible = [...products].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = (dayOfMonth + hourIndex) % eligible.length;
  return eligible[index] ?? null;
}

export function storeProductUrl(productId: string, siteBase?: string): string {
  const configured = (siteBase ?? process.env.PUBLIC_SITE_URL ?? "https://www.ka-imports.com").trim().replace(/\/$/, "");
  const base = configured || "https://www.ka-imports.com";
  return `${base}/produto/${encodeURIComponent(productId)}`;
}

export function productCaption(name: string, productId: string, siteBase?: string): string {
  const safeName = name.replace(/\s+/g, " ").trim();
  return `${safeName}\n${storeProductUrl(productId, siteBase)}`;
}

export function productSendKey(dateKey: string, hour: number, phone: string): string {
  return `p:${dateKey}:${hour}:${phone}`.slice(0, 191);
}

export function customSendKey(postId: string, mode: ScheduleMode, phone: string, slotKey?: string): string {
  if (mode === "once") return `c:${postId}:${phone}`.slice(0, 191);
  return `c:${postId}:${mode}:${slotKey}:${phone}`.slice(0, 191);
}

export function buildCustomCaption(caption: string, linkUrl: string, imageUrl: string): string {
  const image = imageUrl.trim();
  let body = caption.replace(/\r\n/g, "\n");
  if (image) body = body.split(image).join("");
  body = body.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const link = linkUrl.trim();
  const usableLink = link.startsWith("https://") && link !== image ? link : "";
  if (usableLink && !body.includes(usableLink)) {
    body = body ? `${body}\n${usableLink}` : usableLink;
  }
  return body;
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function campaignEnd(start: Date, durationDays: number): Date {
  const clock = saoPauloClock(start);
  const endDay = addDays(clock.year, clock.month, clock.day, Math.max(0, durationDays - 1));
  return spLocalToUtc(endDay.year, endDay.month, endDay.day, 23, 59);
}

export function customSlots(input: ScheduleInput): Date[] {
  if (input.scheduleMode === "once") {
    const slot = parseSpLocal(input.scheduledAt);
    return slot ? [slot] : [];
  }
  const duration = input.durationDays ?? 0;
  if (duration < 1 || duration > 30) return [];
  if (input.scheduleMode === "times") {
    const date = input.scheduledAt.slice(0, 10);
    const origin = parseSpLocal(`${date}T00:00`);
    if (!origin || input.scheduleTimes.length === 0) return [];
    const clock = saoPauloClock(origin);
    const slots: Date[] = [];
    for (let offset = 0; offset < duration; offset += 1) {
      const day = addDays(clock.year, clock.month, clock.day, offset);
      for (const time of input.scheduleTimes) {
        const [hour, minute] = time.split(":");
        const slot = parseSpLocal(`${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}T${hour}:${minute}`);
        if (slot) slots.push(slot);
      }
    }
    return slots;
  }
  const start = parseSpLocal(input.scheduledAt);
  const hours = input.intervalHours ?? 0;
  if (!start || hours < 1 || hours > 12) return [];
  const end = campaignEnd(start, duration);
  const step = hours * 60 * 60 * 1000;
  const slots: Date[] = [];
  for (let time = start.getTime(); time <= end.getTime() && slots.length < 800; time += step) {
    slots.push(new Date(time));
  }
  return slots;
}

export function scheduleSignature(input: ScheduleInput): string {
  const clock = input.scheduleMode === "times" ? input.scheduledAt.slice(0, 10) : input.scheduledAt;
  const times = [...input.scheduleTimes].sort().join(",");
  return [input.scheduleMode, clock, times, input.intervalHours ?? "", input.durationDays ?? ""].join("|");
}

export function scheduleIsOpen(input: ScheduleInput, now: Date): boolean {
  const nowKey = formatSpLocal(now);
  return customSlots(input).some((slot) => formatSpLocal(slot) >= nowKey);
}

function parseTimes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const times: string[] = [];
  for (const item of raw) {
    const value = String(item ?? "").trim();
    if (!TIME_RE.test(value)) return null;
    if (!times.includes(value)) times.push(value);
    if (times.length > MAX_TIMES) return null;
  }
  return times;
}

function integerInRange(raw: unknown, min: number, max: number): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

export function parseCustomSchedule(
  input: {
    scheduledAt?: unknown;
    scheduleMode?: unknown;
    scheduleTimes?: unknown;
    intervalHours?: unknown;
    durationDays?: unknown;
  },
  now: Date,
  previous: ScheduleInput | null,
): ParseOk<ScheduleInput> | ParseFail {
  const mode = input.scheduleMode;
  if (mode !== "once" && mode !== "times" && mode !== "interval") {
    return { ok: false, message: "Escolha uma vez, vários horários ou um intervalo." };
  }
  let scheduledAt = String(input.scheduledAt ?? "").trim();
  let scheduleTimes: string[] = [];
  let intervalHours: number | null = null;
  let durationDays: number | null = null;

  if (mode === "times") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledAt)) scheduledAt = `${scheduledAt}T00:00`;
    if (!parseSpLocal(scheduledAt)) return { ok: false, message: "Informe a data." };
    scheduledAt = `${scheduledAt.slice(0, 10)}T00:00`;
    const times = parseTimes(input.scheduleTimes);
    if (!times) return { ok: false, message: "Use horários HH:MM, no máximo 12." };
    if (times.length === 0) return { ok: false, message: "Informe pelo menos um horário." };
    const duration = integerInRange(input.durationDays, 1, 30);
    if (duration == null) return { ok: false, message: "A duração fica entre 1 e 30 dias." };
    scheduleTimes = times;
    durationDays = duration;
  } else if (mode === "interval") {
    if (!parseSpLocal(scheduledAt)) return { ok: false, message: "Informe data e hora." };
    const hours = integerInRange(input.intervalHours, 1, 12);
    if (hours == null) return { ok: false, message: "O intervalo fica entre 1 e 12 horas." };
    const duration = integerInRange(input.durationDays, 1, 30);
    if (duration == null) return { ok: false, message: "A duração fica entre 1 e 30 dias." };
    intervalHours = hours;
    durationDays = duration;
  } else if (!parseSpLocal(scheduledAt)) {
    return { ok: false, message: "Informe data e hora." };
  }

  const value: ScheduleInput = { scheduledAt, scheduleMode: mode, scheduleTimes, intervalHours, durationDays };
  const unchanged = previous != null && scheduleSignature(previous) === scheduleSignature(value);
  if (!unchanged && !scheduleIsOpen(value, now)) {
    return { ok: false, message: "Esse horário já passou." };
  }
  return { ok: true, value };
}

export function productAnchor(now: Date): Date | null {
  const clock = saoPauloClock(now);
  if (!PRODUCT_HOURS.includes(clock.hour as (typeof PRODUCT_HOURS)[number])) return null;
  return spLocalToUtc(clock.year, clock.month, clock.day, clock.hour, 0);
}
