import crypto from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  customerUsersTable,
  db,
  orderDeliveryCorrectionsTable,
  orderShipmentsTable,
  ordersTable,
} from "@workspace/db";
import { addOrderEvent } from "./order-events";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { resolveWhatsappWebhookUrl } from "./whatsapp-n8n";
import {
  classifyFreightDataError,
  deliveryCorrectionLink,
  deliveryCorrectionMessage,
  deliveryCorrectionWhatsappPayload,
  freightFieldLabel,
  isMainStoreDeliveryCorrectionTenant,
  isValidCnpj,
  isValidCpf,
  maskCpf,
  postDeliveryCorrectionWhatsapp,
  shipmentBlocksDeliveryCorrection,
  shouldAutoSendDeliveryCorrection,
  type DeliveryCorrectionWhatsappPayload,
  type FreightDataField,
} from "./freight-data-error";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DeliveryCorrectionNotice = {
  fields: FreightDataField[];
  fieldLabel: string;
  message: string;
  link: string;
  whatsappSent: boolean;
  whatsappError: string | null;
};

type OrderRow = typeof ordersTable.$inferSelect;

function affectedRows(result: unknown): number {
  const row = result as { affectedRows?: number } | undefined;
  if (typeof row?.affectedRows === "number") return row.affectedRows;
  const nested = (result as [{ affectedRows?: number }] | undefined)?.[0]?.affectedRows;
  return typeof nested === "number" ? nested : 0;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
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

async function orderHasIssuedLabel(order: OrderRow): Promise<boolean> {
  if (shipmentBlocksDeliveryCorrection({
    labelUrl: order.envioecomLabelUrl || order.trackingLabelUrl,
    shipmentId: order.envioecomShipmentId,
    status: order.envioecomStatus,
  })) return true;
  const packages = await db
    .select({
      envioecomLabelUrl: orderShipmentsTable.envioecomLabelUrl,
      envioecomShipmentId: orderShipmentsTable.envioecomShipmentId,
      envioecomStatus: orderShipmentsTable.envioecomStatus,
    })
    .from(orderShipmentsTable)
    .where(eq(orderShipmentsTable.orderId, order.id));
  return packages.some((pkg: {
    envioecomLabelUrl: string | null;
    envioecomShipmentId: number | null;
    envioecomStatus: string | null;
  }) => shipmentBlocksDeliveryCorrection({
    labelUrl: pkg.envioecomLabelUrl,
    shipmentId: pkg.envioecomShipmentId,
    status: pkg.envioecomStatus,
  }));
}

async function webhookUrl(): Promise<string> {
  return resolveWhatsappWebhookUrl({
    event: "delivery_correction",
    tenantId: DEFAULT_TENANT_ID,
    secondInstance: false,
  });
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
      .where(and(
        eq(orderDeliveryCorrectionsTable.id, input.rowId),
        isNull(orderDeliveryCorrectionsTable.whatsappAttemptedAt),
      ));
    if (affectedRows(claimed) !== 1) {
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
  const detail = freightFieldLabel(input.payload?.fields || []);
  if (result.ok) {
    await db.update(orderDeliveryCorrectionsTable).set({ whatsappSentAt: new Date(), whatsappError: null }).where(eq(orderDeliveryCorrectionsTable.id, input.rowId));
    await addOrderEvent({
      orderId: input.order.id,
      tenantId: input.order.tenantId,
      action: input.automatic ? "delivery_correction_sent" : "delivery_correction_resent",
      actorType: "system",
      payload: { summary: detail },
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
    if (!order || !isMainStoreDeliveryCorrectionTenant(order.tenantId)) return body;
    const deliveryCorrection = await ensureDeliveryCorrectionNotice(order, fields);
    if (!deliveryCorrection) return body;
    return { ...body, deliveryCorrection };
  } catch (err) {
    console.warn("[DeliveryCorrection]", err instanceof Error ? err.message.slice(0, 160) : "falha");
    return body;
  }
}

export async function ensureDeliveryCorrectionNotice(
  order: OrderRow,
  fields: FreightDataField[],
  fetchImpl?: typeof fetch,
): Promise<DeliveryCorrectionNotice | null> {
  if (!fields.length || !isMainStoreDeliveryCorrectionTenant(order.tenantId)) return null;
  if (await orderHasIssuedLabel(order)) return null;
  const now = new Date();
  const [open] = await db
    .select()
    .from(orderDeliveryCorrectionsTable)
    .where(and(
      eq(orderDeliveryCorrectionsTable.orderId, order.id),
      isNull(orderDeliveryCorrectionsTable.correctedAt),
    ))
    .orderBy(desc(orderDeliveryCorrectionsTable.createdAt))
    .limit(1);
  const reusable = open && (asDate(open.expiresAt)?.getTime() || 0) > now.getTime() ? open : null;
  const token = reusable?.token || crypto.randomBytes(32).toString("hex");
  const link = deliveryCorrectionLink(token);
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

export async function resendDeliveryCorrection(orderId: string, tenantId: string, fetchImpl?: typeof fetch): Promise<DeliveryCorrectionNotice | null> {
  if (!isMainStoreDeliveryCorrectionTenant(tenantId)) return null;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (!order || !isMainStoreDeliveryCorrectionTenant(order.tenantId)) return null;
  if (await orderHasIssuedLabel(order)) return null;
  const [open] = await db
    .select()
    .from(orderDeliveryCorrectionsTable)
    .where(and(eq(orderDeliveryCorrectionsTable.orderId, order.id), isNull(orderDeliveryCorrectionsTable.correctedAt)))
    .orderBy(desc(orderDeliveryCorrectionsTable.createdAt))
    .limit(1);
  const expiresAt = asDate(open?.expiresAt);
  if (!open || !expiresAt || expiresAt.getTime() <= Date.now()) return null;
  const fields = open.fields.split(",").filter((field: string): field is FreightDataField => field === "cpf" || field === "cep" || field === "endereco");
  const link = deliveryCorrectionLink(open.token);
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
    documentMasked: maskCpf(order.clientDocument),
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
  const [row] = await db.select().from(orderDeliveryCorrectionsTable).where(eq(orderDeliveryCorrectionsTable.token, value)).limit(1);
  if (!row) return { ok: false, status: 404, message: "Link inválido. Peça um novo para a loja." };
  if (row.correctedAt) return { ok: false, status: 410, message: "Estes dados já foram atualizados." };
  const expiresAt = asDate(row.expiresAt);
  if (!expiresAt || expiresAt.getTime() <= Date.now()) return { ok: false, status: 410, message: "Este link expirou. Peça um novo para a loja." };
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, row.orderId)).limit(1);
  if (!order || !isMainStoreDeliveryCorrectionTenant(order.tenantId)) {
    return { ok: false, status: 404, message: "Link inválido. Peça um novo para a loja." };
  }
  if (await orderHasIssuedLabel(order)) return { ok: false, status: 410, message: "Este link não vale mais. A etiqueta já foi emitida." };
  const fields = row.fields.split(",").filter((field: string): field is FreightDataField => field === "cpf" || field === "cep" || field === "endereco");
  return { ok: true, order, fields };
}

export async function readDeliveryCorrection(token: string) {
  const loaded = await loadOpenCorrection(token);
  if (!loaded.ok) return loaded;
  return { ok: true as const, correction: publicCorrectionView(loaded.order, loaded.fields) };
}

export async function saveDeliveryCorrection(
  token: string,
  body: Parameters<typeof validateDeliveryCorrectionInput>[0],
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
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
    await db.update(customerUsersTable).set({
      document: parsed.document.slice(0, 32),
      updatedAt: now,
    }).where(eq(customerUsersTable.id, order.userId));
  }
  await db.update(orderDeliveryCorrectionsTable).set({ correctedAt: now }).where(eq(orderDeliveryCorrectionsTable.orderId, order.id));
  await addOrderEvent({
    orderId: order.id,
    tenantId: order.tenantId,
    action: "delivery_correction_saved",
    actorType: "customer",
    actorUsername: String(order.clientName || "").trim().slice(0, 80) || "cliente",
    payload: { summary: "CPF, CEP e endereço" },
  });
  return { ok: true };
}
