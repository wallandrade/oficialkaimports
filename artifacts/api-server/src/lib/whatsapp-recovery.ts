import { db, ordersTable, pool, sellersTable, tenantSettingsTable, whatsappRecoverySendsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { ResultSetHeader } from "mysql2";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { normalizeWhatsappPhone } from "./whatsapp-notices";
import { postWhatsappWebhook, resolveWhatsappWebhookUrl } from "./whatsapp-n8n";

export const RECOVERY_DEFAULT_DAYS = 40;
export const RECOVERY_DEFAULT_DAILY_LIMIT = 40;
export const RECOVERY_DEFAULT_START_HOUR = 10;
export const RECOVERY_DEFAULT_END_HOUR = 19;
export const RECOVERY_REPLY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const RECOVERY_OLD_MESSAGE = [
  "Oi, {nome}. Aqui é da KA Imports.",
  "",
  "Faz um tempo que você não compra com a gente. Posso te perguntar o que te levou a não comprar mais?",
  "",
  "Pode responder por aqui, do seu jeito. Quero entender para melhorar.",
].join("\n");

export const RECOVERY_DEFAULT_MESSAGE = [
  "Oi, {nome}. Aqui é da KA Imports.",
  "",
  "Faz um tempo que você não compra com a gente. Posso te perguntar o que te levou a não comprar mais?",
  "",
  "Pode responder nossa pesquisa e escolher uma das opções.",
].join("\n");

export const RECOVERY_THANKS = "Obrigado por responder. Isso ajuda a gente a melhorar.";

export const RECOVERY_PRICE_ASK = [
  "Valeu por contar.",
  "",
  "Me manda o print ou a tabela de preço do fornecedor novo. A gente analisa e vê o que consegue fazer para chegar nesse valor, para você voltar a comprar com a gente.",
].join("\n");

export function recoveryReplyMessage(answerId: RecoveryAnswerId): string {
  return answerId === "preco" ? RECOVERY_PRICE_ASK : RECOVERY_THANKS;
}

export const RECOVERY_SURVEY = [
  { id: "preco", title: "Achei preço melhor", description: "Preço em outro lugar" },
  { id: "objetivo", title: "Já atingi meu objetivo", description: "Já comprei o que precisava" },
  { id: "condicoes", title: "Estou sem condições", description: "No momento não dá" },
  { id: "vendas", title: "As vendas caíram", description: "O movimento diminuiu" },
] as const;

export type RecoveryAnswerId = (typeof RECOVERY_SURVEY)[number]["id"];

export type RecoveryCustomer = {
  phone: string;
  name: string;
  lastAt: Date;
};

export type RecoverySent = {
  phone: string;
  lastOrderAt: Date | null;
};

export function recoveryFirstName(name: string): string {
  const word = String(name || "").trim().split(/\s+/).filter(Boolean)[0];
  return word || "Cliente";
}

export function recoveryMessage(template: string, name: string): string {
  const raw = String(template || "").trim();
  const text = !raw || raw === RECOVERY_OLD_MESSAGE ? RECOVERY_DEFAULT_MESSAGE : raw;
  return text.replaceAll("{nome}", recoveryFirstName(name));
}

export function recoveryAnswerId(raw: string): RecoveryAnswerId | null {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return null;
  const byId = RECOVERY_SURVEY.find((option) => option.id === value);
  if (byId) return byId.id;
  const number = Number(value);
  if (Number.isInteger(number) && number >= 1 && number <= RECOVERY_SURVEY.length) {
    return RECOVERY_SURVEY[number - 1].id;
  }
  return RECOVERY_SURVEY.find((option) => option.title.toLowerCase() === value)?.id ?? null;
}

export function recoveryOptionList() {
  return {
    title: "Por que parou",
    buttonLabel: "Escolher",
    options: RECOVERY_SURVEY.map((option) => ({
      id: option.id,
      title: option.title,
      description: option.description,
    })),
  };
}

export function recoverySurveyStats(counts: Map<string, number>) {
  const options = RECOVERY_SURVEY.map((option) => ({
    id: option.id,
    title: option.title,
    count: counts.get(option.id) || 0,
  }));
  const answered = options.reduce((sum, option) => sum + option.count, 0);
  return {
    answered,
    unanswered: counts.get("") || 0,
    options: options.map((option) => ({
      ...option,
      percent: answered > 0 ? Math.round((option.count * 1000) / answered) / 10 : 0,
    })),
  };
}

export function recoveryAnswerTitle(answer: string | null | undefined): string {
  return RECOVERY_SURVEY.find((option) => option.id === answer)?.title || "";
}

/** Venda paga criada depois do envio da mensagem. Compra anterior não conta. */
export function recoverySaleAfterMessage(sentAt: Date | null | undefined, paidTimes: readonly Date[]): boolean {
  if (!sentAt) return false;
  const sent = sentAt.getTime();
  if (!Number.isFinite(sent)) return false;
  return paidTimes.some((time) => {
    const ms = time.getTime();
    return Number.isFinite(ms) && ms > sent;
  });
}

export function paidTimesForRecoveryPhone(index: ReadonlyMap<string, readonly Date[]>, phone: string): Date[] {
  const seen = new Set<number>();
  const times: Date[] = [];
  for (const key of recoveryPhoneKeys(phone)) {
    for (const time of index.get(key) || []) {
      const ms = time.getTime();
      if (!Number.isFinite(ms) || seen.has(ms)) continue;
      seen.add(ms);
      times.push(time);
    }
  }
  return times;
}

export function recoveryRecoveredPercent(recovered: number, total: number): number {
  if (total <= 0 || recovered <= 0) return 0;
  return Math.round((recovered * 1000) / total) / 10;
}

export type RecoveryPaidSale = { id: string; at: Date; cents: number };

export function salesForRecoveryPhone(index: ReadonlyMap<string, readonly RecoveryPaidSale[]>, phone: string): RecoveryPaidSale[] {
  const seen = new Set<string>();
  const sales: RecoveryPaidSale[] = [];
  for (const key of recoveryPhoneKeys(phone)) {
    for (const sale of index.get(key) || []) {
      if (!sale.id || seen.has(sale.id)) continue;
      seen.add(sale.id);
      sales.push(sale);
    }
  }
  return sales;
}

/** Soma, em reais, só as vendas pagas criadas depois do envio. */
export function recoveryAmountAfterMessage(sentAt: Date | null | undefined, sales: readonly RecoveryPaidSale[]): number {
  if (!sentAt) return 0;
  const sent = sentAt.getTime();
  if (!Number.isFinite(sent)) return 0;
  let cents = 0;
  for (const sale of sales) {
    const ms = sale.at.getTime();
    if (!Number.isFinite(ms) || ms <= sent) continue;
    cents += Math.round(sale.cents);
  }
  return cents / 100;
}

export function recoveryPhoneKeys(phone: string): string[] {
  const keys = new Set<string>();
  const normalized = normalizeWhatsappPhone(phone);
  if (normalized) keys.add(normalized);
  const canonical = canonicalRecoveryPhone(phone);
  if (canonical) keys.add(canonical);
  if (canonical && canonical.length === 13) {
    const national = canonical.slice(2);
    if (national[2] === "9") keys.add(`55${national.slice(0, 2)}${national.slice(3)}`);
  }
  return [...keys];
}

const RECOVERY_RESEND_GAP_MS = 24 * 60 * 60 * 1000;

/** Telefone já marcado fica de fora. Uma compra pelo menos 1 dia mais nova pode entrar de novo. */
export function recoveryAlreadySent(sentForOrderAt: number | undefined, lastAtMs: number): boolean {
  if (sentForOrderAt == null) return false;
  if (!Number.isFinite(sentForOrderAt) || sentForOrderAt <= 0) return true;
  return lastAtMs < sentForOrderAt + RECOVERY_RESEND_GAP_MS;
}

export function pickRecoveryCandidate(input: {
  customers: RecoveryCustomer[];
  sent: RecoverySent[];
  ignored: Set<string>;
  now: Date;
  days: number;
}): RecoveryCustomer | null {
  const cutoff = input.now.getTime() - Math.max(1, input.days) * RECOVERY_RESEND_GAP_MS;
  const sentByPhone = new Map(input.sent.map((row) => [row.phone, row.lastOrderAt?.getTime() || 0]));
  const ordered = [...input.customers].sort((a, b) => a.lastAt.getTime() - b.lastAt.getTime());
  for (const customer of ordered) {
    if (input.ignored.has(customer.phone)) continue;
    if (customer.lastAt.getTime() > cutoff) continue;
    if (recoveryAlreadySent(sentByPhone.get(customer.phone), customer.lastAt.getTime())) continue;
    return customer;
  }
  return null;
}

export function countRecoveryWaiting(input: {
  customers: RecoveryCustomer[];
  sent: RecoverySent[];
  ignored: Set<string>;
  now: Date;
  days: number;
}): number {
  const cutoff = input.now.getTime() - Math.max(1, input.days) * RECOVERY_RESEND_GAP_MS;
  const sentByPhone = new Map(input.sent.map((row) => [row.phone, row.lastOrderAt?.getTime() || 0]));
  let count = 0;
  for (const customer of input.customers) {
    if (input.ignored.has(customer.phone)) continue;
    if (customer.lastAt.getTime() > cutoff) continue;
    if (recoveryAlreadySent(sentByPhone.get(customer.phone), customer.lastAt.getTime())) continue;
    count += 1;
  }
  return count;
}

function saoPauloParts(now = new Date()): { ymd: string; hour: number } {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now));
  return { ymd, hour };
}

export function normalizeRecoveryHours(startRaw: unknown, endRaw: unknown): { startHour: number; endHour: number } | null {
  const start = Math.trunc(Number(startRaw));
  const end = Math.trunc(Number(endRaw));
  if (!Number.isInteger(start) || start < 0 || start > 23) return null;
  if (!Number.isInteger(end) || end < 1 || end > 24) return null;
  if (end <= start) return null;
  return { startHour: start, endHour: end };
}

export function recoveryQuietHours(now = new Date(), startHour = RECOVERY_DEFAULT_START_HOUR, endHour = RECOVERY_DEFAULT_END_HOUR): boolean {
  const hours = normalizeRecoveryHours(startHour, endHour) || {
    startHour: RECOVERY_DEFAULT_START_HOUR,
    endHour: RECOVERY_DEFAULT_END_HOUR,
  };
  const { hour } = saoPauloParts(now);
  return hour < hours.startHour || hour >= hours.endHour;
}

function saoPauloDayStart(now = new Date()): Date {
  const { ymd } = saoPauloParts(now);
  return new Date(`${ymd}T00:00:00-03:00`);
}

async function settingValue(tenantId: string, key: string): Promise<string> {
  const rows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);
  return String(rows[0]?.value || "").trim();
}

export async function recoverySettings(tenantId = DEFAULT_TENANT_ID) {
  const [enabledRaw, daysRaw, limitRaw, startRaw, endRaw, message, webhook] = await Promise.all([
    settingValue(tenantId, "n8n_recovery_enabled"),
    settingValue(tenantId, "n8n_recovery_days"),
    settingValue(tenantId, "n8n_recovery_daily_limit"),
    settingValue(tenantId, "n8n_recovery_start_hour"),
    settingValue(tenantId, "n8n_recovery_end_hour"),
    settingValue(tenantId, "n8n_recovery_message"),
    resolveWhatsappWebhookUrl({ event: "recovery", tenantId, secondInstance: false }),
  ]);
  const days = Math.min(365, Math.max(1, Number(daysRaw) || RECOVERY_DEFAULT_DAYS));
  const dailyLimit = Math.min(200, Math.max(1, Number(limitRaw) || RECOVERY_DEFAULT_DAILY_LIMIT));
  const hours = normalizeRecoveryHours(startRaw || RECOVERY_DEFAULT_START_HOUR, endRaw || RECOVERY_DEFAULT_END_HOUR) || {
    startHour: RECOVERY_DEFAULT_START_HOUR,
    endHour: RECOVERY_DEFAULT_END_HOUR,
  };
  return {
    enabled: enabledRaw === "1",
    days,
    dailyLimit,
    startHour: hours.startHour,
    endHour: hours.endHour,
    message: !message || message === RECOVERY_OLD_MESSAGE ? RECOVERY_DEFAULT_MESSAGE : message,
    webhookConfigured: Boolean(webhook),
  };
}

const RECOVERY_IGNORED_PHONES = ["11992790531", "35991490820", "35991738862", "19997349772", "35997190899"];

async function ignoredPhones(): Promise<Set<string>> {
  const phones = new Set<string>();
  const sellers = await db.select({ whatsapp: sellersTable.whatsapp }).from(sellersTable);
  const rows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(inArray(tenantSettingsTable.key, ["n8n_support_ignore_phones", "n8n_support_attendant_phone", "support_whatsapp"]));
  const chunks = [RECOVERY_IGNORED_PHONES.join("\n"), ...sellers.map((row) => row.whatsapp), ...rows.map((row) => row.value)];
  for (const chunk of chunks) {
    for (const part of String(chunk || "").split(/[^0-9]+/)) {
      const phone = normalizeWhatsappPhone(part);
      if (phone) phones.add(phone);
    }
  }
  return phones;
}

export function parseRecoveryMoney(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

/** Celular antigo sem o 9 e o número atual caem na mesma chave. */
export function canonicalRecoveryPhone(value: unknown): string | null {
  const normalized = normalizeWhatsappPhone(value);
  if (!normalized) return null;
  const national = normalized.startsWith("55") ? normalized.slice(2) : normalized;
  if (national.length === 10 && /^[6-9]/.test(national.slice(2))) {
    return `55${national.slice(0, 2)}9${national.slice(2)}`;
  }
  if (national.length === 11) return `55${national}`;
  return normalized;
}

export function recoveryOrderAmount(input: {
  total: unknown;
  paidAmount?: unknown;
  products?: unknown;
  shippingCost?: unknown;
  discountAmount?: unknown;
}): number {
  const total = parseRecoveryMoney(input.total);
  if (total > 0) return total;
  const paid = parseRecoveryMoney(input.paidAmount);
  if (paid > 0) return paid;
  const products = Array.isArray(input.products) ? input.products : [];
  let lines = 0;
  for (const item of products) {
    if (!item || typeof item !== "object") continue;
    const row = item as { quantity?: unknown; price?: unknown; lineDiscount?: unknown };
    const quantity = Math.max(0, parseRecoveryMoney(row.quantity));
    if (quantity <= 0) continue;
    const gross = quantity * Math.max(0, parseRecoveryMoney(row.price));
    const discount = Math.min(gross, Math.max(0, parseRecoveryMoney(row.lineDiscount)));
    lines += gross - discount;
  }
  return Math.max(0, lines + parseRecoveryMoney(input.shippingCost) - parseRecoveryMoney(input.discountAmount));
}

export function addRecoverySpend(spentCents: Map<string, number>, phone: string, total: unknown): void {
  const key = canonicalRecoveryPhone(phone);
  if (!key) return;
  const amount = typeof total === "number" ? total : parseRecoveryMoney(total);
  if (!Number.isFinite(amount) || amount === 0) return;
  spentCents.set(key, (spentCents.get(key) || 0) + Math.round(amount * 100));
}

async function loadPaidOrders(): Promise<{ customers: RecoveryCustomer[]; spentCents: Map<string, number>; paidAt: Map<string, Date[]>; paidSales: Map<string, RecoveryPaidSale[]> }> {
  const rows = await db
    .select({
      id: ordersTable.id,
      phone: ordersTable.clientPhone,
      name: ordersTable.clientName,
      createdAt: ordersTable.createdAt,
      total: ordersTable.total,
      paidAmount: ordersTable.paidAmount,
      products: ordersTable.products,
      shippingCost: ordersTable.shippingCost,
      discountAmount: ordersTable.discountAmount,
    })
    .from(ordersTable)
    .where(inArray(ordersTable.status, ["paid", "completed"]));
  const byPhone = new Map<string, RecoveryCustomer>();
  const spentCents = new Map<string, number>();
  const paidAt = new Map<string, Date[]>();
  const paidSales = new Map<string, RecoveryPaidSale[]>();
  for (const row of rows) {
    const phone = normalizeWhatsappPhone(row.phone);
    if (!phone) continue;
    const amount = recoveryOrderAmount(row);
    addRecoverySpend(spentCents, phone, amount);
    if (!row.createdAt) continue;
    const sale: RecoveryPaidSale = { id: row.id, at: row.createdAt, cents: Math.round(amount * 100) };
    for (const key of recoveryPhoneKeys(phone)) {
      const times = paidAt.get(key);
      if (times) times.push(row.createdAt);
      else paidAt.set(key, [row.createdAt]);
      const sales = paidSales.get(key);
      if (sales) sales.push(sale);
      else paidSales.set(key, [sale]);
    }
    const current = byPhone.get(phone);
    if (!current || row.createdAt.getTime() > current.lastAt.getTime()) {
      byPhone.set(phone, { phone, name: String(row.name || ""), lastAt: row.createdAt });
    }
  }
  return { customers: [...byPhone.values()], spentCents, paidAt, paidSales };
}

async function loadCustomers(): Promise<RecoveryCustomer[]> {
  return (await loadPaidOrders()).customers;
}

async function loadSends(): Promise<RecoverySent[]> {
  const rows = await db.select({
    phone: whatsappRecoverySendsTable.phone,
    lastOrderAt: whatsappRecoverySendsTable.lastOrderAt,
  }).from(whatsappRecoverySendsTable);
  return rows.map((row) => ({ phone: row.phone, lastOrderAt: row.lastOrderAt }));
}

export async function recoverySnapshot(tenantId = DEFAULT_TENANT_ID) {
  const settings = await recoverySettings(tenantId);
  const [paid, sent, ignored] = await Promise.all([loadPaidOrders(), loadSends(), ignoredPhones()]);
  const customers = paid.customers;
  const now = new Date();
  const waiting = countRecoveryWaiting({ customers, sent, ignored, now, days: settings.days });
  const sentTodayRows = await db
    .select({ phone: whatsappRecoverySendsTable.phone })
    .from(whatsappRecoverySendsTable)
    .where(gte(whatsappRecoverySendsTable.sentAt, saoPauloDayStart(now)));
  const allSends = await db
    .select({
      phone: whatsappRecoverySendsTable.phone,
      sentAt: whatsappRecoverySendsTable.sentAt,
      customerName: whatsappRecoverySendsTable.customerName,
    })
    .from(whatsappRecoverySendsTable);
  let recoveredCount = 0;
  let recoveredCents = 0;
  const recoveredPhones = new Set<string>();
  const recoveredCustomers: Array<{ phone: string; name: string; amount: number }> = [];
  for (const row of allSends) {
    const sales = salesForRecoveryPhone(paid.paidSales, row.phone);
    if (!recoverySaleAfterMessage(row.sentAt, sales.map((sale) => sale.at))) continue;
    const amount = recoveryAmountAfterMessage(row.sentAt, sales);
    recoveredCount += 1;
    recoveredCents += Math.round(amount * 100);
    recoveredCustomers.push({
      phone: row.phone,
      name: row.customerName || "",
      amount,
    });
    for (const key of recoveryPhoneKeys(row.phone)) recoveredPhones.add(key);
  }
  recoveredCustomers.sort((left, right) => right.amount - left.amount || left.name.localeCompare(right.name, "pt-BR"));
  const recent = await db
    .select()
    .from(whatsappRecoverySendsTable)
    .orderBy(desc(whatsappRecoverySendsTable.sentAt))
    .limit(30);
  const answerRows = await db
    .select({
      answer: whatsappRecoverySendsTable.answer,
      count: sql<number>`count(*)`,
    })
    .from(whatsappRecoverySendsTable)
    .groupBy(whatsappRecoverySendsTable.answer);
  const counts = new Map<string, number>();
  for (const row of answerRows) counts.set(String(row.answer || ""), Number(row.count) || 0);
  return {
    ...settings,
    waiting,
    sentToday: sentTodayRows.length,
    survey: recoverySurveyStats(counts),
    recovered: {
      count: recoveredCount,
      total: allSends.length,
      percent: recoveryRecoveredPercent(recoveredCount, allSends.length),
      amount: recoveredCents / 100,
      customers: recoveredCustomers,
    },
    recent: recent.map((row) => ({
      phone: row.phone,
      name: row.customerName || "",
      spent: (paid.spentCents.get(canonicalRecoveryPhone(row.phone) || "") || 0) / 100,
      answer: recoveryAnswerTitle(row.answer),
      recovered: recoveryPhoneKeys(row.phone).some((key) => recoveredPhones.has(key)),
      sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
      lastOrderAt: row.lastOrderAt ? new Date(row.lastOrderAt).toISOString() : null,
    })),
  };
}

async function claimSend(customer: RecoveryCustomer, tenantId: string): Promise<boolean> {
  const name = customer.name.slice(0, 255);
  const [inserted] = await pool.query(
    `INSERT IGNORE INTO whatsapp_recovery_sends (phone, tenant_id, customer_name, last_order_at, sent_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [customer.phone, tenantId, name, customer.lastAt],
  ) as unknown as [ResultSetHeader, unknown];
  if (inserted.affectedRows === 1) return true;

  const [updated] = await pool.query(
    `UPDATE whatsapp_recovery_sends
     SET tenant_id = ?, customer_name = ?, last_order_at = ?, sent_at = NOW()
     WHERE phone = ?
       AND last_order_at IS NOT NULL
       AND ? >= DATE_ADD(last_order_at, INTERVAL 1 DAY)`,
    [tenantId, name, customer.lastAt, customer.phone, customer.lastAt],
  ) as unknown as [ResultSetHeader, unknown];
  return updated.affectedRows === 1;
}

async function releaseSend(phone: string): Promise<void> {
  await pool.query("DELETE FROM whatsapp_recovery_sends WHERE phone = ?", [phone]);
}

export async function sendNextRecovery(input: { tenantId?: string; ignoreHours?: boolean } = {}): Promise<{ sent: boolean; reason: string; phone?: string }> {
  const tenantId = input.tenantId || DEFAULT_TENANT_ID;
  const settings = await recoverySettings(tenantId);
  if (!settings.enabled) return { sent: false, reason: "desligada" };
  if (!settings.webhookConfigured) return { sent: false, reason: "sem_url" };
  if (!input.ignoreHours && recoveryQuietHours(new Date(), settings.startHour, settings.endHour)) return { sent: false, reason: "fora_do_horario" };
  const sentToday = await db
    .select({ phone: whatsappRecoverySendsTable.phone })
    .from(whatsappRecoverySendsTable)
    .where(gte(whatsappRecoverySendsTable.sentAt, saoPauloDayStart()));
  if (sentToday.length >= settings.dailyLimit) return { sent: false, reason: "limite_do_dia" };

  const [customers, sent, ignored] = await Promise.all([loadCustomers(), loadSends(), ignoredPhones()]);
  const customer = pickRecoveryCandidate({
    customers,
    sent,
    ignored,
    now: new Date(),
    days: settings.days,
  });
  if (!customer) return { sent: false, reason: "ninguem" };

  const claimed = await claimSend(customer, tenantId);
  if (!claimed) return { sent: false, reason: "ja_marcado" };
  const message = recoveryMessage(settings.message, customer.name);
  const optionList = recoveryOptionList();
  const menuUrl = await resolveWhatsappWebhookUrl({ event: "support_menu", tenantId, secondInstance: false });
  const recoveryUrl = await resolveWhatsappWebhookUrl({ event: "recovery", tenantId, secondInstance: false });
  const ok = menuUrl
    ? await postWhatsappWebhook(menuUrl, { phone: customer.phone, message, optionList })
    : recoveryUrl
      ? await postWhatsappWebhook(recoveryUrl, { phone: customer.phone, message, optionList })
      : false;
  if (!ok) {
    await releaseSend(customer.phone);
    return { sent: false, reason: "n8n_falhou", phone: customer.phone };
  }
  return { sent: true, reason: "enviado", phone: customer.phone };
}

export async function recordRecoveryAnswer(phone: string, answerId: string): Promise<boolean> {
  const answer = recoveryAnswerId(answerId);
  const keys = recoveryPhoneKeys(phone);
  if (!answer || keys.length === 0) return false;
  const [result] = await pool.query(
    `UPDATE whatsapp_recovery_sends
     SET answer = ?
     WHERE phone IN (${keys.map(() => "?").join(",")})
       AND (answer IS NULL OR answer = '')`,
    [answer, ...keys],
  ) as unknown as [ResultSetHeader, unknown];
  return result.affectedRows > 0;
}

export async function phoneHasRecentRecovery(phone: string, now = new Date()): Promise<boolean> {
  const keys = recoveryPhoneKeys(phone);
  if (keys.length === 0) return false;
  const rows = await db
    .select({ sentAt: whatsappRecoverySendsTable.sentAt })
    .from(whatsappRecoverySendsTable)
    .where(inArray(whatsappRecoverySendsTable.phone, keys))
    .limit(1);
  const sentAt = rows[0]?.sentAt;
  if (!sentAt) return false;
  return now.getTime() - new Date(sentAt).getTime() <= RECOVERY_REPLY_WINDOW_MS;
}
