import { db, orderLogisticsAllocationsTable, ordersTable, pool, siteSettingsTable, tenantSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import type { ResultSetHeader } from "mysql2";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { buildOrderPaidWhatsappMessage } from "./post-payment-message";
import {
  currentStatusWhatsappNotices,
  filmagemShouldMark,
  isHttpsWebhookUrl,
  normalizeWhatsappPhone,
  planShipmentWhatsappNotices,
  SINGLE_SHIPMENT_WHATSAPP_KEY,
  toWhatsappText,
  type ShipmentWhatsappNotice,
} from "./whatsapp-notices";
import { isProvisionalBarcode, isUsableLabelBarcode } from "./envioecom-status";

export { SINGLE_SHIPMENT_WHATSAPP_KEY };

const TIMEOUT_MS = 8000;
const ATTEMPTS = 2;

const EVENTS = {
  paid: { env: "N8N_ORDER_PAID_WEBHOOK_URL", setting: "n8n_order_paid_webhook_url" },
  filmagem: { env: "N8N_FILMAGEM_WEBHOOK_URL", setting: "n8n_filmagem_webhook_url" },
  tracking: { env: "N8N_TRACKING_WEBHOOK_URL", setting: "n8n_tracking_webhook_url" },
  posted: { env: "N8N_POSTED_WEBHOOK_URL", setting: "n8n_posted_webhook_url" },
  out_for_delivery: { env: "N8N_OUT_FOR_DELIVERY_WEBHOOK_URL", setting: "n8n_out_for_delivery_webhook_url" },
  delivered: { env: "N8N_DELIVERED_WEBHOOK_URL", setting: "n8n_delivered_webhook_url" },
  support: { env: "N8N_SUPPORT_WEBHOOK_URL", setting: "n8n_support_webhook_url" },
  support_menu: { env: "N8N_SUPPORT_MENU_WEBHOOK_URL", setting: "n8n_support_menu_webhook_url" },
} as const;

export type WhatsappWebhookEvent = keyof typeof EVENTS;

type TimestampColumn = "paid_whatsapp_sent_at" | "filmagem_whatsapp_sent_at" | "filmagem_delivery_whatsapp_sent_at";

const KEY_COLUMNS: Record<ShipmentWhatsappNotice, string> = {
  tracking: "tracking_whatsapp_codes",
  posted: "posted_whatsapp_keys",
  out_for_delivery: "out_for_delivery_whatsapp_keys",
  delivered: "delivered_whatsapp_keys",
};

export type WhatsappOrderRef = {
  id: string;
  tenantId?: string | null;
  sellerCode?: string | null;
  clientPhone?: string | null;
  orderNumber?: number | null;
};

async function getSettingValue(key: string, tenantId = DEFAULT_TENANT_ID): Promise<string> {
  const tenantRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);
  if (tenantRows[0]?.value != null) return String(tenantRows[0].value || "").trim();

  if (tenantId !== DEFAULT_TENANT_ID) return "";
  const legacyRows = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  return String(legacyRows[0]?.value || "").trim();
}

function tokensMatch(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export async function readSecondInstanceSlugs(tenantId: string): Promise<string[]> {
  const fromEnv = String(process.env.N8N_SECOND_INSTANCE_SELLER_SLUGS || "").trim();
  const raw = fromEnv || await getSettingValue("n8n_second_instance_seller_slugs", tenantId);
  return raw.split(/[,;\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export async function sellerUsesSecondInstance(sellerCode: unknown, tenantId: string): Promise<boolean> {
  const code = String(sellerCode || "").trim().toLowerCase();
  if (!code) return false;
  const slugs = await readSecondInstanceSlugs(tenantId);
  return slugs.includes(code);
}

export async function readPolyInstanceId(tenantId: string): Promise<string> {
  const fromEnv = String(process.env.N8N_POLY_INSTANCE_ID || "").trim();
  const raw = fromEnv || await getSettingValue("n8n_poly_instance_id", tenantId);
  if (!raw || /\/token\/|https?:/i.test(raw)) return "";
  return raw;
}

export function instanceMatchesPoly(instanceId: unknown, polyInstanceId: string): boolean {
  const incoming = String(instanceId || "").trim();
  return !!polyInstanceId && incoming === polyInstanceId;
}

export async function resolveWhatsappWebhookUrl(input: {
  event: WhatsappWebhookEvent;
  tenantId: string;
  secondInstance: boolean;
  fallbackToMain?: boolean;
}): Promise<string> {
  const spec = EVENTS[input.event];
  const envName = input.secondInstance ? `${spec.env}_POLY` : spec.env;
  const settingName = input.secondInstance ? `${spec.setting}_poly` : spec.setting;
  const fromEnv = String(process.env[envName] || "").trim();
  if (isHttpsWebhookUrl(fromEnv)) return fromEnv;
  const fromSetting = await getSettingValue(settingName, input.tenantId);
  if (isHttpsWebhookUrl(fromSetting)) return fromSetting;
  if (input.secondInstance && input.fallbackToMain !== false) {
    return resolveWhatsappWebhookUrl({ ...input, secondInstance: false });
  }
  return "";
}

async function postN8n(url: string, payload: Record<string, unknown>): Promise<boolean> {
  if (!isHttpsWebhookUrl(url)) return false;
  const body = JSON.stringify(payload);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (response.ok) return true;
    } catch (err) {
      console.warn("[WHATSAPP_N8N] POST falhou", {
        attempt,
        error: err instanceof Error ? err.message : "request_failed",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  return false;
}

export async function postWhatsappWebhook(url: string, payload: {
  phone: string;
  message?: string;
  caption?: string;
  optionList?: unknown;
}): Promise<boolean> {
  const body: Record<string, unknown> = { phone: payload.phone };
  if (payload.message != null) body.message = toWhatsappText(payload.message);
  if (payload.caption != null) body.caption = toWhatsappText(payload.caption);
  if (payload.optionList != null) body.optionList = payload.optionList;
  return postN8n(url, body);
}

function orderLabel(order: WhatsappOrderRef): string {
  const numeric = Number(order.orderNumber);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  return order.id;
}

function noticeMessage(kind: ShipmentWhatsappNotice, order: WhatsappOrderRef, code: string): string {
  const label = orderLabel(order);
  if (kind === "tracking") {
    return [
      `📦 *Rastreio do pedido #${label}*`,
      "",
      `Código: ${code}`,
      `https://envioecomrastreio.com.br/${code}`,
    ].join("\n");
  }
  if (kind === "posted") {
    return [
      `📦 *Pedido #${label} postado*`,
      "",
      "A transportadora informou que o pedido foi postado.",
    ].join("\n");
  }
  if (kind === "out_for_delivery") {
    return [
      `🚚 *Pedido #${label} saiu para entrega*`,
      "",
      "A transportadora informou que o pedido saiu para entrega.",
    ].join("\n");
  }
  return [
    `✅ *Pedido #${label} entregue*`,
    "",
    "A transportadora informou que o pedido foi entregue.",
  ].join("\n");
}

function filmagemCaption(order: WhatsappOrderRef, moment: "paid" | "delivery"): string {
  const label = orderLabel(order);
  const line = moment === "paid"
    ? `Pedido #${label} confirmado. A filmagem da separação segue nesta mensagem.`
    : `Pedido #${label} saiu para entrega. A filmagem da separação segue nesta mensagem.`;
  return `🚨🚨 *COMUNICADO OFICIAL*\n\n${line}`;
}

async function claimTimestamp(orderId: string, column: TimestampColumn): Promise<boolean> {
  const [result] = await pool.query(
    `UPDATE orders SET ${column} = NOW() WHERE id = ? AND ${column} IS NULL`,
    [orderId],
  ) as unknown as [ResultSetHeader, unknown];
  return result.affectedRows > 0;
}

async function releaseTimestamp(orderId: string, column: TimestampColumn): Promise<void> {
  await pool.query(`UPDATE orders SET ${column} = NULL WHERE id = ?`, [orderId]);
}

function parseKeyList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      return parseKeyList(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

async function readStoredKeys(orderId: string, column: string): Promise<{ present: boolean; keys: string[] }> {
  const [rows] = await pool.query(
    `SELECT ${column} AS value FROM orders WHERE id = ? LIMIT 1`,
    [orderId],
  ) as unknown as [Array<{ value: unknown }>, unknown];
  if (!rows[0] || rows[0].value == null) return { present: false, keys: [] };
  return { present: true, keys: parseKeyList(rows[0].value) };
}

async function claimKey(orderId: string, column: string, key: string): Promise<string[] | null> {
  const stored = await readStoredKeys(orderId, column);
  if (stored.keys.includes(key)) return null;
  const next = [...stored.keys, key];
  const [result] = await pool.query(
    `UPDATE orders SET ${column} = CAST(? AS JSON) WHERE id = ? AND (${column} IS NULL OR JSON_LENGTH(${column}) = ?)`,
    [JSON.stringify(next), orderId, stored.keys.length],
  ) as unknown as [ResultSetHeader, unknown];
  if (result.affectedRows < 1) return null;
  return stored.keys;
}

async function restoreKeys(orderId: string, column: string, previous: string[]): Promise<void> {
  await pool.query(
    `UPDATE orders SET ${column} = CAST(? AS JSON) WHERE id = ?`,
    [JSON.stringify(previous), orderId],
  );
}

async function sendMarkedNotice(input: {
  order: WhatsappOrderRef;
  phone: string;
  tenantId: string;
  secondInstance: boolean;
  kind: ShipmentWhatsappNotice;
  packageKey: string;
  code: string;
}): Promise<void> {
  if (!input.phone) return;
  const url = await resolveWhatsappWebhookUrl({
    event: input.kind,
    tenantId: input.tenantId,
    secondInstance: input.secondInstance,
  });
  if (!url) return;
  const column = KEY_COLUMNS[input.kind];
  const previous = await claimKey(input.order.id, column, input.packageKey);
  if (!previous) return;
  const ok = await postWhatsappWebhook(url, {
    phone: input.phone,
    message: noticeMessage(input.kind, input.order, input.code),
  });
  if (!ok) await restoreKeys(input.order.id, column, previous);
}

async function sendFilmagem(input: {
  order: WhatsappOrderRef;
  phone: string;
  tenantId: string;
  secondInstance: boolean;
  column: TimestampColumn;
  moment: "paid" | "delivery";
}): Promise<void> {
  const url = await resolveWhatsappWebhookUrl({
    event: "filmagem",
    tenantId: input.tenantId,
    secondInstance: input.secondInstance,
  });
  if (!filmagemShouldMark(url)) return;
  const claimed = await claimTimestamp(input.order.id, input.column);
  if (!claimed) return;
  const ok = await postWhatsappWebhook(url, {
    phone: input.phone,
    caption: filmagemCaption(input.order, input.moment),
  });
  if (!ok) await releaseTimestamp(input.order.id, input.column);
}

export function dispatchShipmentWhatsapp(input: {
  order: WhatsappOrderRef;
  packageKey: string;
  previousStatus?: unknown;
  nextStatus?: unknown;
  previousCode?: unknown;
  nextCode?: unknown;
  skipTracking?: boolean;
}): void {
  const notices = planShipmentWhatsappNotices(input);
  const code = String(input.nextCode || "").trim();
  const retryStatus = !code || !isProvisionalBarcode(code)
    ? currentStatusWhatsappNotices(input.nextStatus).length > 0
    : false;
  if (!notices.length && !retryStatus) return;
  void deliverShipmentNotices(input, notices).catch((err) => {
    console.warn("[WHATSAPP_N8N] Falha ao avisar frete", input.order.id, err);
  });
}

async function deliverShipmentNotices(
  input: {
    order: WhatsappOrderRef;
    packageKey: string;
    nextStatus?: unknown;
    nextCode?: unknown;
    skipTracking?: boolean;
  },
  planned: ShipmentWhatsappNotice[],
): Promise<void> {
  const phone = normalizeWhatsappPhone(input.order.clientPhone);
  if (!phone) return;
  const code = String(input.nextCode || "").trim();
  const packageKey = input.packageKey || SINGLE_SHIPMENT_WHATSAPP_KEY;
  const notices = new Set<ShipmentWhatsappNotice>(planned);
  if (!code || !isProvisionalBarcode(code)) {
    for (const kind of currentStatusWhatsappNotices(input.nextStatus)) {
      if (notices.has(kind)) continue;
      const stored = await readStoredKeys(input.order.id, KEY_COLUMNS[kind]);
      if (stored.present && !stored.keys.includes(packageKey)) notices.add(kind);
    }
  }
  if (!input.skipTracking && isUsableLabelBarcode(code) && !notices.has("tracking")) {
    const stored = await readStoredKeys(input.order.id, KEY_COLUMNS.tracking);
    if (stored.present && !stored.keys.includes(packageKey)) notices.add("tracking");
  }
  if (!notices.size) return;
  const tenantId = String(input.order.tenantId || "").trim() || DEFAULT_TENANT_ID;
  const secondInstance = await sellerUsesSecondInstance(input.order.sellerCode, tenantId);
  for (const kind of notices) {
    await sendMarkedNotice({
      order: input.order,
      phone,
      tenantId,
      secondInstance,
      kind,
      packageKey,
      code,
    });
    if (kind === "out_for_delivery") {
      await sendFilmagem({
        order: input.order,
        phone,
        tenantId,
        secondInstance,
        column: "filmagem_delivery_whatsapp_sent_at",
        moment: "delivery",
      });
    }
  }
}

export function notifyOrderTrackingWhatsapp(input: { orderId: string; packageKey?: string | null; code: unknown }): void {
  const code = String(input.code || "").trim();
  if (!isUsableLabelBarcode(code)) return;
  void deliverCreateTracking(input.orderId, input.packageKey || SINGLE_SHIPMENT_WHATSAPP_KEY, code).catch((err) => {
    console.warn("[WHATSAPP_N8N] Falha ao avisar rastreio do create", input.orderId, err);
  });
}

async function deliverCreateTracking(orderId: string, packageKey: string, code: string): Promise<void> {
  const rows = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return;
  const phone = normalizeWhatsappPhone(order.clientPhone);
  if (!phone) return;
  const tenantId = order.tenantId || DEFAULT_TENANT_ID;
  await sendMarkedNotice({
    order,
    phone,
    tenantId,
    secondInstance: await sellerUsesSecondInstance(order.sellerCode, tenantId),
    kind: "tracking",
    packageKey,
    code,
  });
}

export function scheduleOrderPaidWhatsapp(orderId: string): void {
  const id = String(orderId || "").trim();
  if (!id) return;
  void deliverOrderPaid(id).catch((err) => {
    console.warn("[WHATSAPP_N8N] Falha ao avisar pedido pago", id, err);
  });
}

async function deliverOrderPaid(orderId: string): Promise<void> {
  const rows = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return;
  const status = String(order.status || "").trim().toLowerCase();
  if (status !== "paid" && status !== "completed") return;
  const phone = normalizeWhatsappPhone(order.clientPhone);
  if (!phone) return;
  const tenantId = order.tenantId || DEFAULT_TENANT_ID;
  const secondInstance = await sellerUsesSecondInstance(order.sellerCode, tenantId);
  const paidUrl = await resolveWhatsappWebhookUrl({ event: "paid", tenantId, secondInstance });
  if (paidUrl) {
    const claimed = await claimTimestamp(order.id, "paid_whatsapp_sent_at");
    if (claimed) {
      let promisedHours: number | undefined;
      try {
        const allocation = await db
          .select({ promisedHours: orderLogisticsAllocationsTable.promisedHours })
          .from(orderLogisticsAllocationsTable)
          .where(eq(orderLogisticsAllocationsTable.orderId, order.id))
          .limit(1);
        const hours = Number(allocation[0]?.promisedHours);
        if (Number.isFinite(hours) && hours > 0) promisedHours = hours;
      } catch {
        promisedHours = undefined;
      }
      const ok = await postWhatsappWebhook(paidUrl, {
        phone,
        message: buildOrderPaidWhatsappMessage({
          ...order,
          logisticsAllocation: promisedHours ? { promisedHours } : null,
        }),
      });
      if (!ok) await releaseTimestamp(order.id, "paid_whatsapp_sent_at");
    }
  }
  await sendFilmagem({
    order,
    phone,
    tenantId,
    secondInstance,
    column: "filmagem_whatsapp_sent_at",
    moment: "paid",
  });
}

export async function whatsappSupportTokenMatches(provided: unknown): Promise<{ ok: boolean; tenantId: string }> {
  const token = String(provided || "").trim();
  if (token.length < 8) return { ok: false, tenantId: DEFAULT_TENANT_ID };
  const envToken = String(process.env.N8N_WHATSAPP_SUPPORT_TOKEN || "").trim();
  if (envToken.length >= 8 && tokensMatch(envToken, token)) {
    return { ok: true, tenantId: DEFAULT_TENANT_ID };
  }
  const tenantRows = await db
    .select({ tenantId: tenantSettingsTable.tenantId, value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(eq(tenantSettingsTable.key, "n8n_whatsapp_support_token"));
  for (const row of tenantRows) {
    const value = String(row.value || "").trim();
    if (value.length >= 8 && tokensMatch(value, token)) {
      return { ok: true, tenantId: row.tenantId || DEFAULT_TENANT_ID };
    }
  }
  const legacy = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "n8n_whatsapp_support_token")).limit(1);
  const legacyValue = String(legacy[0]?.value || "").trim();
  if (legacyValue.length >= 8 && tokensMatch(legacyValue, token)) {
    return { ok: true, tenantId: DEFAULT_TENANT_ID };
  }
  return { ok: false, tenantId: DEFAULT_TENANT_ID };
}

export async function readSupportAttendantPhone(tenantId: string): Promise<string | null> {
  const fromEnv = String(process.env.N8N_SUPPORT_ATTENDANT_PHONE || "").trim();
  const raw = fromEnv || await getSettingValue("n8n_support_attendant_phone", tenantId);
  return normalizeWhatsappPhone(raw);
}
