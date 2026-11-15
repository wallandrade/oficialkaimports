import crypto from "crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import {
  customerUsersTable,
  db,
  orderDeliveryCorrectionsTable,
  orderShipmentsTable,
  ordersTable,
  pool,
  siteSettingsTable,
  tenantSettingsTable,
} from "@workspace/db";
import { isLabelBlockedStatus } from "./envioecom-status";
import {
  classifyFreightDataError,
  deliveryCorrectionMessage,
  deliveryCorrectionWhatsappPayload,
  freightFieldLabel,
  isValidCnpj,
  isValidCpf,
  maskDocument,
  postDeliveryCorrectionWhatsapp,
  shouldAutoSendDeliveryCorrection,
  type DeliveryCorrectionWhatsappPayload,
  type FreightDataField,
} from "./freight-data-error";
import { addOrderEvent } from "./order-events";
import { isStandardShipping } from "./order-logistics-calendar";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { isMainStoreTenant, whatsappServerEnv } from "./tenant-store-scope";
import { isHttpsWebhookUrl } from "./whatsapp-notices";

export const N8N_DELIVERY_CORRECTION_WEBHOOK_SETTING = "n8n_delivery_correction_webhook_url";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAIN_STORE_PUBLIC_URL = "https://www.ka-imports.com";

export type DeliveryCorrectionNotice = {
  fields: FreightDataField[];
  fieldLabel: string;
  message: string;
  link: string;
  whatsappSent: boolean;
  whatsappError: string | null;
};

type OrderRow = typeof ordersTable.$inferSelect;

function mysqlAffectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  if (!header || typeof header !== "object") return 0;
  return Number((header as { affectedRows?: unknown }).affectedRows || 0);
}

function shipmentAlreadyIssued(row: {
  envioecomLabelUrl?: string | null;
  trackingLabelUrl?: string | null;
  envioecomShipmentId?: number | null;
  envioecomStatus?: string | null;
}): boolean {
  if (String(row.envioecomLabelUrl || row.trackingLabelUrl || "").trim()) return true;
  const shipmentId = Number(row.envioecomShipmentId || 0);
  return shipmentId > 0 && !isLabelBlockedStatus(row.envioecomStatus);
}

async function orderHasIssuedLabel(order: OrderRow): Promise<boolean> {
  if (shipmentAlreadyIssued(order)) return true;
  const packages = await db
    .select({
      envioecomLabelUrl: orderShipmentsTable.envioecomLabelUrl,
      envioecomShipmentId: orderShipmentsTable.envioecomShipmentId,
      envioecomStatus: orderShipmentsTable.envioecomStatus,
    })
    .from(orderShipmentsTable)
    .where(eq(orderShipmentsTable.orderId, order.id));
  return packages.some((row) => shipmentAlreadyIssued(row));
}

export function mainStorePublicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [env.STOREFRONT_URL, env.FRONTEND_URL, env.PUBLIC_SITE_URL, MAIN_STORE_PUBLIC_URL];
  for (const raw of candidates) {
    const value = String(raw || "").trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== "https:") continue;
      if (host.includes("yury-imports.com") || host.includes("yuri-imports")) continue;
      return parsed.origin;
    } catch {
      continue;
    }
  }
  return MAIN_STORE_PUBLIC_URL;
}

function correctionLink(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/corrigir-entrega?token=${encodeURIComponent(token)}`;
}

async function readMainStoreSetting(key: string): Promise<string> {
  const tenantRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, DEFAULT_TENANT_ID), eq(tenantSettingsTable.key, key)))
    .limit(1);
  if (tenantRows[0]?.value != null) return String(tenantRows[0].value || "").trim();
  const legacyRows = await db
    .select({ value: siteSettingsTable.value })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.key, key))
    .limit(1);
  return String(legacyRows[0]?.value || "").trim();
}

async function webhookUrl(): Promise<string> {
  const fromEnv = whatsappServerEnv(DEFAULT_TENANT_ID, process.env.N8N_DELIVERY_CORRECTION_WEBHOOK_URL, DEFAULT_TENANT_ID);
  if (isHttpsWebhookUrl(fromEnv)) return fromEnv;
  const fromSetting = await readMainStoreSetting(N8N_DELIVERY_CORRECTION_WEBHOOK_SETTING);
  if (isHttpsWebhookUrl(fromSetting)) return fromSetting;
  return "";
}

function noticeFrom(input: {
  fields: FreightDataField[];
  message: string;
  link: string;
  whatsappSent: boolean;
  whatsappError: string | null;
}): DeliveryCorrectionNotice {
  return {
    fields: input.fields,
    fieldLabel: freightFieldLabel(input.fields),
    message: input.message,
    link: input.link,
    whatsappSent: input.whatsappSent,
    whatsappError: input.whatsappError,
  };
}

async function sendOnce(input: {
  rowId: string;
  order: OrderRow;
  payload: DeliveryCorrectionWhatsappPayload | null;
  automatic: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ sent: boolean; error: string | null }> {
  if (input.automatic) {
    const claimed = await db
      .update(orderDeliveryCorrectionsTable)
      .set({ whatsappAttemptedAt: new Date() })
      .where(and(eq(orderDeliveryCorrectionsTable.id, input.rowId), isNull(orderDeliveryCorrectionsTable.whatsappAttemptedAt)));
    if (mysqlAffectedRows(claimed) !== 1) {
      const [current] = await db.select().from(orderDeliveryCorrectionsTable).where(eq(orderDeliveryCorrectionsTable.id, input.rowId)).limit(1);
      return { sent: Boolean(current?.whatsappSentAt), error: current?.whatsappError || null };
    }
  } else {
    await db.update(orderDeliveryCorrectionsTable).set({ whatsappAttemptedAt: new Date() }).where(eq(orderDeliveryCorrectionsTable.id, input.rowId));
  }

  const url = await webhookUrl();
  const result = input.payload
    ? await postDeliveryCorrectionWhatsapp({ url, payload: input.payload, fetchImpl: input.fetchImpl })
    : { ok: false, error: "Pedido sem telefone para o WhatsApp." };
  const fieldLabel = freightFieldLabel(input.payload?.fields || []);
  if (result.ok) {
    await db.update(orderDeliveryCorrectionsTable).set({ whatsappSentAt: new Date(), whatsappError: null }).where(eq(orderDeliveryCorrectionsTable.id, input.rowId));
    await addOrderEvent({
      orderId: input.order.id,
      tenantId: input.order.tenantId,
      action: "delivery_correction_sent",
      actorType: "system",
      payload: { summary: input.automatic ? fieldLabel : `Reenvio · ${fieldLabel}` },
    });
    return { sent: true, error: null };
  }
  const error = result.error || "Falha no WhatsApp.";
  await db.update(orderDeliveryCorrectionsTable).set({ whatsappError: error.slice(0, 255) }).where(eq(orderDeliveryCorrectionsTable.id, input.rowId));
  await addOrderEvent({
    orderId: input.order.id,
    tenantId: input.order.tenantId,
    action: "delivery_correction_failed",
    actorType: "system",
    payload: { summary: error.slice(0, 240) },
  });
  return { sent: false, error };
}

export async function withDeliveryCorrection<T extends { error?: unknown; message?: unknown; details?: unknown }>(
  orderId: string,
  body: T,
): Promise<T & { deliveryCorrection?: DeliveryCorrectionNotice }> {
  try {
    const fields = classifyFreightDataError({
      code: typeof body.error === "string" ? body.error : null,
      message: typeof body.message === "string" ? body.message : null,
      details: body.details,
    });
    if (!fields.length) return body;
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (!order) return body;
    const deliveryCorrection = await ensureDeliveryCorrectionNotice(order, fields);
    if (!deliveryCorrection) return body;
    return { ...body, deliveryCorrection };
  } catch {
    console.warn("[DeliveryCorrection] falha ao preparar o aviso");
    return body;
  }
}

function correctionLockName(orderId: string): string {
  return `dc:${crypto.createHash("sha256").update(String(orderId)).digest("hex").slice(0, 48)}`;
}

async function withDeliveryCorrectionLock<T>(orderId: string, run: () => Promise<T>): Promise<T | null> {
  const lockName = correctionLockName(orderId);
  const connection = await pool.getConnection();
  let got = 0;
  try {
    try {
      const [rows] = await connection.query("SELECT GET_LOCK(?, 12) AS got", [lockName]);
      const header = Array.isArray(rows) ? rows[0] as { got?: number | string | null } : null;
      got = Number(header?.got || 0);
    } catch {
      console.warn("[DeliveryCorrection] falha ao reservar o envio");
      return null;
    }
    if (got !== 1) return null;
    return await run();
  } finally {
    if (got === 1) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
      } catch {
        console.warn("[DeliveryCorrection] falha ao soltar a reserva");
      }
    }
    connection.release();
  }
}

export async function ensureDeliveryCorrectionNotice(order: OrderRow, fields: FreightDataField[], fetchImpl?: typeof fetch): Promise<DeliveryCorrectionNotice | null> {
  if (!fields.length || !isMainStoreTenant(order.tenantId) || !isStandardShipping(order.shippingType)) return null;
  if (await orderHasIssuedLabel(order)) return null;
  return withDeliveryCorrectionLock(order.id, () => createOrReuseDeliveryCorrection(order, fields, fetchImpl));
}

async function createOrReuseDeliveryCorrection(order: OrderRow, fields: FreightDataField[], fetchImpl?: typeof fetch): Promise<DeliveryCorrectionNotice | null> {
  const now = new Date();
  const openRows = await db
    .select()
    .from(orderDeliveryCorrectionsTable)
    .where(and(
      eq(orderDeliveryCorrectionsTable.orderId, order.id),
      isNull(orderDeliveryCorrectionsTable.correctedAt),
    ))
    .orderBy(desc(orderDeliveryCorrectionsTable.createdAt));
  const open = openRows.find((row) => row.expiresAt.getTime() > now.getTime()) || openRows[0] || null;
  for (const extra of openRows) {
    if (!open || extra.id === open.id) continue;
    await db.update(orderDeliveryCorrectionsTable).set({ expiresAt: now }).where(eq(orderDeliveryCorrectionsTable.id, extra.id));
  }
  const base = mainStorePublicBaseUrl();
  const reusable = open && open.expiresAt.getTime() > now.getTime() ? open : null;
  const token = reusable?.token || crypto.randomBytes(32).toString("hex");
  const link = correctionLink(base, token);
  const message = deliveryCorrectionMessage({
    name: order.clientName,
    orderNumber: String(order.orderNumber || ""),
    fields,
    link,
  });
  let rowId = reusable?.id || "";
  if (!reusable) {
    if (open) {
      await db.update(orderDeliveryCorrectionsTable).set({ expiresAt: now }).where(eq(orderDeliveryCorrectionsTable.id, open.id));
    }
    rowId = crypto.randomBytes(16).toString("hex");
    await db.insert(orderDeliveryCorrectionsTable).values({
      id: rowId,
      orderId: order.id,
      token,
      fields: fields.join(","),
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    });
  } else if (reusable.fields !== fields.join(",")) {
    await db.update(orderDeliveryCorrectionsTable).set({ fields: fields.join(",") }).where(eq(orderDeliveryCorrectionsTable.id, reusable.id));
  }

  const payload = deliveryCorrectionWhatsappPayload({
    phone: order.clientPhone,
    name: order.clientName,
    orderNumber: String(order.orderNumber || ""),
    fields,
    message,
    link,
  });
  const auto = shouldAutoSendDeliveryCorrection(reusable);
  const sent = auto
    ? await sendOnce({ rowId, order, payload, automatic: true, fetchImpl })
    : { sent: Boolean(reusable?.whatsappSentAt), error: reusable?.whatsappError || null };
  return noticeFrom({ fields, message, link, whatsappSent: sent.sent, whatsappError: sent.error });
}

export async function resendDeliveryCorrection(orderId: string, fetchImpl?: typeof fetch): Promise<DeliveryCorrectionNotice | null> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (!order || !isMainStoreTenant(order.tenantId) || await orderHasIssuedLabel(order)) return null;
  const [open] = await db
    .select()
    .from(orderDeliveryCorrectionsTable)
    .where(and(eq(orderDeliveryCorrectionsTable.orderId, order.id), isNull(orderDeliveryCorrectionsTable.correctedAt)))
    .orderBy(desc(orderDeliveryCorrectionsTable.createdAt))
    .limit(1);
  if (!open || open.expiresAt.getTime() <= Date.now()) return null;
  const fields = open.fields.split(",").filter((field: string): field is FreightDataField => field === "cpf" || field === "cep" || field === "endereco");
  const base = mainStorePublicBaseUrl();
  const link = correctionLink(base, open.token);
  const message = deliveryCorrectionMessage({
    name: order.clientName,
    orderNumber: String(order.orderNumber || ""),
    fields,
    link,
  });
  const payload = deliveryCorrectionWhatsappPayload({
    phone: order.clientPhone,
    name: order.clientName,
    orderNumber: String(order.orderNumber || ""),
    fields,
    message,
    link,
  });
  const sent = await sendOnce({ rowId: open.id, order, payload, automatic: false, fetchImpl });
  return noticeFrom({ fields, message, link, whatsappSent: sent.sent, whatsappError: sent.error });
}

export function publicCorrectionView(order: OrderRow, fields: FreightDataField[]) {
  return {
    orderNumber: order.orderNumber,
    clientName: String(order.clientName || "").trim().split(/\s+/)[0] || "cliente",
    fields,
    documentMasked: maskDocument(order.clientDocument),
    address: {
      cep: String(order.addressCep || ""),
      street: String(order.addressStreet || ""),
      number: String(order.addressNumber || ""),
      complement: String(order.addressComplement || ""),
      neighborhood: String(order.addressNeighborhood || ""),
      city: String(order.addressCity || ""),
      state: String(order.addressState || ""),
    },
  };
}

export function validateDeliveryCorrectionInput(body: {
  document?: unknown;
  cep?: unknown;
  street?: unknown;
  number?: unknown;
  complement?: unknown;
  neighborhood?: unknown;
  city?: unknown;
  state?: unknown;
}): { ok: true; document: string; cep: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string } | { ok: false; message: string } {
  const document = String(body.document || "").replace(/\D/g, "");
  const cep = String(body.cep || "").replace(/\D/g, "");
  const street = String(body.street || "").trim();
  const number = String(body.number || "").trim();
  const complement = String(body.complement || "").trim();
  const neighborhood = String(body.neighborhood || "").trim();
  const city = String(body.city || "").trim();
  const state = String(body.state || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  if (!isValidCpf(document) && !isValidCnpj(document)) return { ok: false, message: "CPF ou CNPJ inválido. Confira os números." };
  if (cep.length !== 8) return { ok: false, message: "CEP precisa ter 8 dígitos." };
  if (!street || !number || !neighborhood || !city || state.length !== 2) {
    return { ok: false, message: "Preencha rua, número, bairro, cidade e UF." };
  }
  return { ok: true, document, cep, street, number, complement, neighborhood, city, state };
}

async function loadOpenCorrection(token: string): Promise<{ ok: true; order: OrderRow; fields: FreightDataField[] } | { ok: false; status: number; message: string }> {
  const value = String(token || "").trim();
  if (!value) return { ok: false, status: 404, message: "Link inválido. Peça um novo para a loja." };
  const [row] = await db.select().from(orderDeliveryCorrectionsTable).where(eq(orderDeliveryCorrectionsTable.token, value)).limit(1);
  if (!row) return { ok: false, status: 404, message: "Link inválido. Peça um novo para a loja." };
  if (row.correctedAt) return { ok: false, status: 410, message: "Estes dados já foram atualizados." };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, status: 410, message: "Este link expirou. Peça um novo para a loja." };
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, row.orderId)).limit(1);
  if (!order || !isMainStoreTenant(order.tenantId)) return { ok: false, status: 404, message: "Pedido não encontrado." };
  if (await orderHasIssuedLabel(order)) return { ok: false, status: 410, message: "Este link não vale mais. A etiqueta já foi emitida." };
  const fields = row.fields.split(",").filter((field: string): field is FreightDataField => field === "cpf" || field === "cep" || field === "endereco");
  return { ok: true, order, fields };
}

export async function readDeliveryCorrection(token: string) {
  const loaded = await loadOpenCorrection(token);
  if (!loaded.ok) return loaded;
  return { ok: true as const, correction: publicCorrectionView(loaded.order, loaded.fields) };
}

export async function saveDeliveryCorrection(token: string, body: Parameters<typeof validateDeliveryCorrectionInput>[0]): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const loaded = await loadOpenCorrection(token);
  if (!loaded.ok) return loaded;
  const { order } = loaded;
  const parsed = validateDeliveryCorrectionInput(body);
  if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
  const now = new Date();
  await db.update(ordersTable).set({
    clientDocument: parsed.document,
    addressCep: parsed.cep,
    addressStreet: parsed.street.slice(0, 255),
    addressNumber: parsed.number.slice(0, 255),
    addressComplement: parsed.complement.slice(0, 255) || null,
    addressNeighborhood: parsed.neighborhood.slice(0, 255),
    addressCity: parsed.city.slice(0, 255),
    addressState: parsed.state,
    clientDataCorrectedAt: now,
    updatedAt: now,
  }).where(eq(ordersTable.id, order.id));
  if (order.userId) {
    await db.update(customerUsersTable).set({ document: parsed.document, updatedAt: now }).where(eq(customerUsersTable.id, order.userId));
  }
  await db.update(orderDeliveryCorrectionsTable).set({ correctedAt: now }).where(eq(orderDeliveryCorrectionsTable.orderId, order.id));
  const firstName = String(order.clientName || "").trim().split(/\s+/)[0]?.slice(0, 80) || "cliente";
  await addOrderEvent({
    orderId: order.id,
    tenantId: order.tenantId,
    action: "delivery_correction_saved",
    actorType: "customer",
    actorUsername: firstName,
    payload: { summary: "CPF, CEP e endereço" },
  });
  return { ok: true };
}

export function orderTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}
