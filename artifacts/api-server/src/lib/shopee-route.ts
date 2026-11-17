import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db, orderShipmentsTable, ordersTable, tenantSettingsTable } from "@workspace/db";
import { creditWallet, getWalletBalance, WalletIdempotencyConflict } from "./customer-wallet";
import { ensureGuestCustomerAccount, findCustomerInTenantById } from "./customer-guest-account";
import { addOrderEvent, type AddOrderEventInput } from "./order-events";
import { markOrderEnviadoWithoutInventory } from "./order-enviado";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { isHttpsWebhookUrl, normalizeWhatsappPhone } from "./whatsapp-notices";
import { zapiMainCredentials } from "./whatsapp-group-campaign";
import {
  effectiveShopeeRouteMessage,
  firstClientName,
  formatBrl,
  normalizeShopeeProductUrl,
  phonesMatch,
  renderShopeeRouteMessage,
  SHOPEE_ROUTE_MESSAGE_KEY,
  SHOPEE_ROUTE_PRODUCT_URL_KEY,
  SHOPEE_ROUTE_SECRET_HEADER,
  shopeeCreditAmount,
  summarizeOrderProducts,
  type ShopeeInboundMotivo,
} from "./shopee-route-core";
import {
  executeShopeeRouteInbound,
  type ShopeeRouteInboundOrder,
  type ShopeeRouteInboundStore,
} from "./shopee-route-support";

export { SHOPEE_ROUTE_SECRET_HEADER };

type Actor = Pick<AddOrderEventInput, "actorType" | "actorUsername" | "actorAdminUserId">;

export type ShopeeRouteOrderRow = {
  id: string;
  tenantId: string | null;
  orderNumber: number | null;
  userId: string | null;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  products: unknown;
  total: string | number | null;
  paidAmount: string | number | null;
  enviado: boolean | null;
  status: string;
  shopeeRouteRequestedAt: Date | null;
  shopeeOrderId: string | null;
  shopeeRouteReviewReason: string | null;
  shopeeWalletCreditedAt: Date | null;
};

type AdminScope = {
  hasGlobalAccess: boolean;
  sellerCode: string | null;
  tenantId: string;
};

const orderColumns = {
  id: ordersTable.id,
  tenantId: ordersTable.tenantId,
  orderNumber: ordersTable.orderNumber,
  userId: ordersTable.userId,
  clientName: ordersTable.clientName,
  clientEmail: ordersTable.clientEmail,
  clientPhone: ordersTable.clientPhone,
  products: ordersTable.products,
  total: ordersTable.total,
  paidAmount: ordersTable.paidAmount,
  enviado: ordersTable.enviado,
  status: ordersTable.status,
  shopeeRouteRequestedAt: ordersTable.shopeeRouteRequestedAt,
  shopeeOrderId: ordersTable.shopeeOrderId,
  shopeeRouteReviewReason: ordersTable.shopeeRouteReviewReason,
  shopeeWalletCreditedAt: ordersTable.shopeeWalletCreditedAt,
};

function orderTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

function adminOrderWhere(orderId: string, scope: AdminScope) {
  const tenant = and(eq(ordersTable.id, orderId), orderTenantWhere(scope.tenantId));
  if (scope.hasGlobalAccess) return tenant;
  return and(tenant, eq(ordersTable.sellerCode, scope.sellerCode || ""));
}

function isoTimestamp(value: Date | null | undefined): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value : new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

export function shopeeRouteAdminFields(order: {
  id: string;
  shopeeRouteRequestedAt?: Date | null;
  shopeeOrderId?: string | null;
  shopeeRouteReviewReason?: string | null;
  shopeeWalletCreditedAt?: Date | null;
  enviado?: boolean | null;
}) {
  return {
    id: order.id,
    shopeeRouteRequestedAt: isoTimestamp(order.shopeeRouteRequestedAt),
    shopeeOrderId: String(order.shopeeOrderId || "").trim() || null,
    shopeeRouteReviewReason: String(order.shopeeRouteReviewReason || "").trim() || null,
    shopeeWalletCreditedAt: isoTimestamp(order.shopeeWalletCreditedAt),
    enviado: Boolean(order.enviado),
  };
}

export function shopeeRoutePhone(value: unknown): string | null {
  return normalizeWhatsappPhone(value);
}

export function readShopeeWebhookConfig(): { url: string; secret: string } | null {
  const url = String(process.env.N8N_SHOPEE_WEBHOOK_URL || "").trim();
  const secret = String(process.env.N8N_SHOPEE_SECRET || "").trim();
  if (!isHttpsWebhookUrl(url) || !secret) return null;
  return { url, secret };
}

async function readTenantSetting(tenantId: string, key: string): Promise<string> {
  const rows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);
  return String(rows[0]?.value || "").trim();
}

export async function loadShopeeRouteOrder(orderId: string, scope: AdminScope): Promise<ShopeeRouteOrderRow | null> {
  const rows = await db
    .select(orderColumns)
    .from(ordersTable)
    .where(adminOrderWhere(orderId, scope))
    .limit(1);
  return rows[0] || null;
}

async function reloadOrder(orderId: string): Promise<ShopeeRouteOrderRow | null> {
  const rows = await db.select(orderColumns).from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  return rows[0] || null;
}

function orderLabel(order: { orderNumber: number | null; id: string }): string {
  return order.orderNumber != null ? String(order.orderNumber) : order.id;
}

export function buildShopeeRoutePayload(
  order: ShopeeRouteOrderRow,
  phone: string,
  link: string,
  message: string,
  products: unknown = order.products,
  packageId: string | null = null,
) {
  const summary = summarizeOrderProducts(products);
  const total = shopeeCreditAmount(order.total, order.paidAmount);
  return {
    event: "rota_shopee" as const,
    pedido: {
      id: order.id,
      numero: order.orderNumber ?? null,
    },
    cliente: {
      nome: String(order.clientName || "").trim(),
      telefone: phone,
    },
    resumo_pedido: {
      itens: summary.itens,
      total,
    },
    link_shopee: link,
    mensagem: message,
    ...(packageId ? { pacote: { id: packageId } } : {}),
  };
}

export async function composeShopeeRouteMessage(
  order: ShopeeRouteOrderRow,
  products: unknown = order.products,
): Promise<{ link: string; message: string; summary: string } | { error: string }> {
  const tenantId = order.tenantId || DEFAULT_TENANT_ID;
  const link = normalizeShopeeProductUrl(await readTenantSetting(tenantId, SHOPEE_ROUTE_PRODUCT_URL_KEY));
  if (!link) return { error: "Salve o link do produto da Shopee em Configurações." };
  const template = effectiveShopeeRouteMessage(await readTenantSetting(tenantId, SHOPEE_ROUTE_MESSAGE_KEY));
  const summary = summarizeOrderProducts(products);
  const total = shopeeCreditAmount(order.total, order.paidAmount);
  const message = renderShopeeRouteMessage(template, {
    nome: firstClientName(order.clientName),
    pedido: orderLabel(order),
    resumoPedido: summary.texto,
    linkShopee: link,
    valor: formatBrl(total),
  });
  return { link, message, summary: summary.texto };
}

export async function sendShopeeRouteWhatsapp(phone: string, message: string): Promise<{ ok: true } | { ok: false; status: number }> {
  const creds = zapiMainCredentials();
  if (!creds) return { ok: false, status: 0 };
  const url = `https://api.z-api.io/instances/${encodeURIComponent(creds.instanceId)}/token/${encodeURIComponent(creds.token)}/send-text`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Client-Token": creds.clientToken,
    },
    body: JSON.stringify({ phone, message }),
    signal: AbortSignal.timeout(8000),
  });
  await response.arrayBuffer().catch(() => undefined);
  if (response.status < 200 || response.status >= 300) return { ok: false, status: response.status };
  return { ok: true };
}

export async function postShopeeRouteWebhook(url: string, secret: string, payload: unknown): Promise<{ ok: true } | { ok: false; status: number }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SHOPEE_ROUTE_SECRET_HEADER]: secret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true };
}

export async function markShopeeRouteRequested(
  order: ShopeeRouteOrderRow,
  actor: Actor,
  notice?: { packageId?: string | null; summary?: string | null },
): Promise<ShopeeRouteOrderRow> {
  const now = new Date();
  await db.update(ordersTable).set({
    shopeeRouteRequestedAt: now,
    shopeeRouteReviewReason: null,
    updatedAt: now,
  }).where(eq(ordersTable.id, order.id));
  const packageId = String(notice?.packageId || "").trim();
  if (packageId) {
    await db.update(orderShipmentsTable).set({
      shopeeRouteSentAt: now,
      updatedAt: now,
    }).where(and(eq(orderShipmentsTable.id, packageId), eq(orderShipmentsTable.orderId, order.id)));
  }
  await addOrderEvent({
    orderId: order.id,
    tenantId: order.tenantId,
    action: "shopee_route_sent",
    ...actor,
    payload: {
      summary: String(notice?.summary || "").trim() || "Aguardando ID Shopee",
      ...(packageId ? { packageId } : {}),
    },
  });
  return (await reloadOrder(order.id)) || { ...order, shopeeRouteRequestedAt: now, shopeeRouteReviewReason: null };
}

function toInboundOrder(row: ShopeeRouteOrderRow): ShopeeRouteInboundOrder {
  return {
    id: row.id,
    tenantId: row.tenantId,
    orderNumber: row.orderNumber,
    clientPhone: row.clientPhone,
    shopeeRouteRequestedAt: row.shopeeRouteRequestedAt,
    shopeeOrderId: row.shopeeOrderId,
    shopeeRouteReviewReason: row.shopeeRouteReviewReason,
    shopeeWalletCreditedAt: row.shopeeWalletCreditedAt,
    enviado: row.enviado,
  };
}

const awaitingShopeeRouteWhere = and(
  isNotNull(ordersTable.shopeeRouteRequestedAt),
  or(isNull(ordersTable.shopeeOrderId), eq(ordersTable.shopeeOrderId, "")),
);

export async function phoneHasAwaitingShopeeRoute(telefone: string, tenantId?: string): Promise<boolean> {
  if (!phonesMatch(telefone, telefone)) return false;
  const scope = String(tenantId || "").trim();
  const rows = await db
    .select({ clientPhone: ordersTable.clientPhone })
    .from(ordersTable)
    .where(scope ? and(awaitingShopeeRouteWhere, orderTenantWhere(scope)) : awaitingShopeeRouteWhere);
  return rows.some((row) => phonesMatch(row.clientPhone, telefone));
}

const shopeeRouteInboundStore: ShopeeRouteInboundStore = {
  async listAwaiting() {
    const rows = await db.select(orderColumns).from(ordersTable).where(awaitingShopeeRouteWhere);
    return rows.map(toInboundOrder);
  },
  async listByShopeeOrderId(id) {
    const rows = await db.select(orderColumns).from(ordersTable).where(eq(ordersTable.shopeeOrderId, id));
    return rows.map(toInboundOrder);
  },
  async reload(id) {
    const row = await reloadOrder(id);
    return row ? toInboundOrder(row) : null;
  },
  async assignShopeeOrderId(id, shopeeOrderId) {
    await db.update(ordersTable).set({
      shopeeOrderId,
      shopeeRouteReviewReason: null,
      updatedAt: new Date(),
    }).where(eq(ordersTable.id, id));
  },
  async markReview(id, motivo) {
    const rows = await db
      .select({
        id: ordersTable.id,
        tenantId: ordersTable.tenantId,
        shopeeRouteReviewReason: ordersTable.shopeeRouteReviewReason,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, id))
      .limit(1);
    const row = rows[0];
    if (!row || row.shopeeRouteReviewReason === motivo) {
      return { changed: false, tenantId: row?.tenantId ?? null };
    }
    await db.update(ordersTable).set({
      shopeeRouteReviewReason: motivo,
      updatedAt: new Date(),
    }).where(eq(ordersTable.id, id));
    return { changed: true, tenantId: row.tenantId };
  },
  async markEnviado(id, tenantId) {
    return markOrderEnviadoWithoutInventory(id, tenantId);
  },
  async addEvent(event) {
    await addOrderEvent({
      orderId: event.orderId,
      tenantId: event.tenantId,
      action: event.action,
      actorType: "webhook",
      actorUsername: "n8n",
      payload: event.payload,
    });
  },
};

export async function receiveShopeeRouteInbound(
  input: { telefone: string; texto: string },
  scope?: { tenantId?: string },
): Promise<
  | { ok: true; ja_processado: boolean; pedido: ReturnType<typeof shopeeRouteAdminFields> & { numero: number | null }; mensagem_para_cliente: string }
  | { ok: false; motivo: ShopeeInboundMotivo }
> {
  const result = await executeShopeeRouteInbound(input, shopeeRouteInboundStore, {
    defaultTenantId: DEFAULT_TENANT_ID,
    scopeTenantId: scope?.tenantId,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    ja_processado: result.ja_processado,
    pedido: {
      ...shopeeRouteAdminFields(result.order),
      numero: result.order.orderNumber ?? null,
    },
    mensagem_para_cliente: result.mensagem_para_cliente,
  };
}

export async function saveAdminShopeeOrderId(order: ShopeeRouteOrderRow, shopeeOrderId: string | null, actor: Actor): Promise<ShopeeRouteOrderRow> {
  const now = new Date();
  await db.update(ordersTable).set({
    shopeeOrderId,
    shopeeRouteReviewReason: shopeeOrderId ? null : order.shopeeRouteReviewReason,
    updatedAt: now,
  }).where(eq(ordersTable.id, order.id));
  await addOrderEvent({
    orderId: order.id,
    tenantId: order.tenantId,
    action: "shopee_order_id",
    ...actor,
    payload: {
      shopeeOrderId,
      summary: shopeeOrderId ? `ID ${shopeeOrderId}` : "ID apagado",
    },
  });
  return (await reloadOrder(order.id)) || { ...order, shopeeOrderId };
}

export async function creditShopeeRouteWallet(order: ShopeeRouteOrderRow, actor: Actor): Promise<
  | { ok: true; already: boolean; amount: number; userId: string; availableCredit: number; order: ShopeeRouteOrderRow }
  | { ok: false; status: number; error: string; message: string }
> {
  const tenantId = order.tenantId || DEFAULT_TENANT_ID;
  let userId = String(order.userId || "").trim();
  if (userId) {
    const existing = await findCustomerInTenantById(tenantId, userId);
    if (!existing) userId = "";
  }
  if (!userId) {
    const email = String(order.clientEmail || "").trim();
    if (!email) {
      return { ok: false, status: 400, error: "NO_CUSTOMER", message: "Pedido sem e-mail para abrir a carteira." };
    }
    const ensured = await ensureGuestCustomerAccount({ tenantId, email });
    if (!ensured.ok) {
      return { ok: false, status: ensured.status, error: ensured.error, message: ensured.message };
    }
    userId = ensured.customer.id;
  }

  const amount = shopeeCreditAmount(order.total, order.paidAmount);
  if (amount <= 0) {
    return { ok: false, status: 400, error: "INVALID_AMOUNT", message: "Este pedido não tem valor para creditar." };
  }
  if (order.shopeeWalletCreditedAt) {
    const availableCredit = await getWalletBalance(userId, tenantId);
    return { ok: true, already: true, amount, userId, availableCredit, order };
  }
  const note = `Crédito da rota Shopee do pedido ${orderLabel(order)}`;
  let credited = 0;
  try {
    credited = await creditWallet({
      tenantId,
      userId,
      amount,
      type: "shopee_route_credit",
      orderId: order.id,
      note,
      idempotencyKey: `shopee-route:${order.id}`,
    });
  } catch (err) {
    if (err instanceof WalletIdempotencyConflict) {
      return {
        ok: false,
        status: 409,
        error: "IDEMPOTENCY_CONFLICT",
        message: "Este pedido já teve crédito com outro valor.",
      };
    }
    throw err;
  }

  const already = credited === 0;
  let saved = order;
  if (!order.shopeeWalletCreditedAt) {
    const now = new Date();
    await db.update(ordersTable).set({
      shopeeWalletCreditedAt: now,
      updatedAt: now,
    }).where(eq(ordersTable.id, order.id));
    saved = (await reloadOrder(order.id)) || { ...order, shopeeWalletCreditedAt: now };
  }
  if (!already) {
    await addOrderEvent({
      orderId: order.id,
      tenantId,
      action: "shopee_wallet_credit",
      ...actor,
      payload: { amount, userId, summary: `Crédito de ${formatBrl(amount)}` },
    });
  }
  const availableCredit = await getWalletBalance(userId, tenantId);
  return { ok: true, already, amount, userId, availableCredit, order: saved };
}
