import { db, ordersTable, pool, sellersTable, tenantSettingsTable, whatsappRecoverySendsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { ResultSetHeader } from "mysql2";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { normalizeWhatsappPhone } from "./whatsapp-notices";
import { postWhatsappWebhook, resolveWhatsappWebhookUrl } from "./whatsapp-n8n";

export const RECOVERY_DEFAULT_DAYS = 40;
export const RECOVERY_DEFAULT_DAILY_LIMIT = 40;
export const RECOVERY_REPLY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export const RECOVERY_DEFAULT_MESSAGE = [
  "Oi, {nome}. Aqui é da KA Imports.",
  "",
  "Faz um tempo que você não compra com a gente. Posso te perguntar o que te levou a não comprar mais?",
  "",
  "Pode responder por aqui, do seu jeito. Quero entender para melhorar.",
].join("\n");

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
  const text = String(template || "").trim() || RECOVERY_DEFAULT_MESSAGE;
  return text.replaceAll("{nome}", recoveryFirstName(name));
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

export function recoveryQuietHours(now = new Date()): boolean {
  const { hour } = saoPauloParts(now);
  return hour < 10 || hour >= 19;
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
  const [enabledRaw, daysRaw, limitRaw, message, webhook] = await Promise.all([
    settingValue(tenantId, "n8n_recovery_enabled"),
    settingValue(tenantId, "n8n_recovery_days"),
    settingValue(tenantId, "n8n_recovery_daily_limit"),
    settingValue(tenantId, "n8n_recovery_message"),
    resolveWhatsappWebhookUrl({ event: "recovery", tenantId, secondInstance: false }),
  ]);
  const days = Math.min(365, Math.max(1, Number(daysRaw) || RECOVERY_DEFAULT_DAYS));
  const dailyLimit = Math.min(200, Math.max(1, Number(limitRaw) || RECOVERY_DEFAULT_DAILY_LIMIT));
  return {
    enabled: enabledRaw === "1",
    days,
    dailyLimit,
    message: message || RECOVERY_DEFAULT_MESSAGE,
    webhookConfigured: Boolean(webhook),
  };
}

const RECOVERY_IGNORED_PHONES = ["11992790531", "35991490820", "35991738862"];

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

async function loadCustomers(): Promise<RecoveryCustomer[]> {
  const rows = await db
    .select({
      phone: ordersTable.clientPhone,
      name: ordersTable.clientName,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(inArray(ordersTable.status, ["paid", "completed"]));
  const byPhone = new Map<string, RecoveryCustomer>();
  for (const row of rows) {
    const phone = normalizeWhatsappPhone(row.phone);
    if (!phone || !row.createdAt) continue;
    const current = byPhone.get(phone);
    if (!current || row.createdAt.getTime() > current.lastAt.getTime()) {
      byPhone.set(phone, { phone, name: String(row.name || ""), lastAt: row.createdAt });
    }
  }
  return [...byPhone.values()];
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
  const [customers, sent, ignored] = await Promise.all([loadCustomers(), loadSends(), ignoredPhones()]);
  const now = new Date();
  const waiting = countRecoveryWaiting({ customers, sent, ignored, now, days: settings.days });
  const sentTodayRows = await db
    .select({ phone: whatsappRecoverySendsTable.phone })
    .from(whatsappRecoverySendsTable)
    .where(gte(whatsappRecoverySendsTable.sentAt, saoPauloDayStart(now)));
  const recent = await db
    .select()
    .from(whatsappRecoverySendsTable)
    .orderBy(desc(whatsappRecoverySendsTable.sentAt))
    .limit(30);
  return {
    ...settings,
    waiting,
    sentToday: sentTodayRows.length,
    recent: recent.map((row) => ({
      phone: row.phone,
      name: row.customerName || "",
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
  if (!input.ignoreHours && recoveryQuietHours()) return { sent: false, reason: "fora_do_horario" };
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
  const url = await resolveWhatsappWebhookUrl({ event: "recovery", tenantId, secondInstance: false });
  const ok = url ? await postWhatsappWebhook(url, {
    phone: customer.phone,
    message: recoveryMessage(settings.message, customer.name),
  }) : false;
  if (!ok) {
    await releaseSend(customer.phone);
    return { sent: false, reason: "n8n_falhou", phone: customer.phone };
  }
  return { sent: true, reason: "enviado", phone: customer.phone };
}

export async function phoneHasRecentRecovery(phone: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .select({ sentAt: whatsappRecoverySendsTable.sentAt })
    .from(whatsappRecoverySendsTable)
    .where(eq(whatsappRecoverySendsTable.phone, phone))
    .limit(1);
  const sentAt = rows[0]?.sentAt;
  if (!sentAt) return false;
  return now.getTime() - new Date(sentAt).getTime() <= RECOVERY_REPLY_WINDOW_MS;
}
