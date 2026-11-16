import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db, ordersTable, tenantSettingsTable } from "@workspace/db";
import { creditWallet, getWalletBalance, WalletIdempotencyConflict } from "./customer-wallet";
import { ensureGuestCustomerAccount, findCustomerInTenantById } from "./customer-guest-account";
import { addOrderEvent, type AddOrderEventInput } from "./order-events";
import { markOrderEnviadoWithoutInventory } from "./order-enviado";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { isHttpsWebhookUrl, normalizeWhatsappPhone } from "./whatsapp-notices";
import {
  decideShopeeInbound,
  effectiveShopeeRouteMessage,
  extractShopeeOrderId,
  firstClientName,
  formatBrl,
  normalizeShopeeProductUrl,
  phonesMatch,
  renderShopeeRouteMessage,
  reviewSummary,
  SHOPEE_ROUTE_MESSAGE_KEY,
  SHOPEE_ROUTE_PRODUCT_URL_KEY,
  SHOPEE_ROUTE_SECRET_HEADER,
  shopeeCreditAmount,
  shopeeRouteCustomerReply,
  summarizeOrderProducts,
  type ShopeeInboundMotivo,
} from "./shopee-route-core";

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

export function buildShopeeRoutePayload(order: ShopeeRouteOrderRow, phone: string, link: string, message: string) {
  const summary = summarizeOrderProducts(order.products);
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
  };
}

export async function composeShopeeRouteMessage(order: ShopeeRouteOrderRow): Promise<{ link: string; message: string } | { error: string }> {
  const tenantId = order.tenantId || DEFAULT_TENANT_ID;
  const link = normalizeShopeeProductUrl(await readTenantSetting(tenantId, SHOPEE_ROUTE_PRODUCT_URL_KEY));
  if (!link) return { error: "Salve o link do produto da Shopee em Configurações." };
  const template = effectiveShopeeRouteMessage(await readTenantSetting(tenantId, SHOPEE_ROUTE_MESSAGE_KEY));
  const summary = summarizeOrderProducts(order.products);
  const total = shopeeCreditAmount(order.total, order.paidAmount);
  const message = renderShopeeRouteMessage(template, {
    nome: firstClientName(order.clientName),
    pedido: orderLabel(order),
    resumoPedido: summary.texto,
    linkShopee: link,
    valor: formatBrl(total),
  });
  return { link, message };
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

export async function markShopeeRouteRequested(order: ShopeeRouteOrderRow, actor: Actor): Promise<ShopeeRouteOrderRow> {
  const now = new Date();
  await db.update(ordersTable).set({
    shopeeRouteRequestedAt: now,
    shopeeRouteReviewReason: null,
    updatedAt: now,
  }).where(eq(ordersTable.id, order.id));
  await addOrderEvent({
    orderId: order.id,
    tenantId: order.tenantId,
    action: "shopee_route_sent",
    ...actor,
    payload: { summary: "Aguardando ID Shopee" },
  });
  return (await reloadOrder(order.id)) || { ...order, shopeeRouteRequestedAt: now, shopeeRouteReviewReason: null };
}

async function markOrdersForReview(orderIds: string[], motivo: string): Promise<void> {
  const ids = [...new Set(orderIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (ids.length === 0) return;
  const summary = reviewSummary(motivo);
  for (const id of ids) {
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
    if (!row || row.shopeeRouteReviewReason === motivo) continue;
    await db.update(ordersTable).set({
      shopeeRouteReviewReason: motivo,
      updatedAt: new Date(),
    }).where(eq(ordersTable.id, id));
    await addOrderEvent({
      orderId: id,
      tenantId: row.tenantId,
      action: "shopee_route_review",
      actorType: "webhook",
      actorUsername: "n8n",
      payload: { motivo, summary },
    });
  }
}

export async function receiveShopeeRouteInbound(input: { telefone: string; texto: string }): Promise<
  | { ok: true; ja_processado: boolean; pedido: ReturnType<typeof shopeeRouteAdminFields> & { numero: number | null }; mensagem_para_cliente: string }
  | { ok: false; motivo: ShopeeInboundMotivo }
> {
  const telefone = String(input.telefone || "").trim();
  if (!telefone || !phonesMatch(telefone, telefone)) {
    return { ok: false, motivo: "payload_invalido" };
  }
  const extracted = extractShopeeOrderId(input.texto);
  const awaitingRows = await db
    .select(orderColumns)
    .from(ordersTable)
    .where(and(
      isNotNull(ordersTable.shopeeRouteRequestedAt),
      or(isNull(ordersTable.shopeeOrderId), eq(ordersTable.shopeeOrderId, "")),
    ));
  const awaiting = awaitingRows
    .filter((row) => phonesMatch(row.clientPhone, telefone))
    .map((row) => ({ id: row.id, shopeeOrderId: row.shopeeOrderId }));
  const sameIdRows = extracted.id
    ? await db.select(orderColumns).from(ordersTable).where(eq(ordersTable.shopeeOrderId, extracted.id))
    : [];
  const sameId = sameIdRows
    .filter((row) => phonesMatch(row.clientPhone, telefone))
    .map((row) => ({ id: row.id, shopeeOrderId: row.shopeeOrderId }));
  const decision = decideShopeeInbound({
    motivoId: extracted.motivo,
    shopeeOrderId: extracted.id,
    awaiting,
    sameId,
  });
  if (!decision.ok) {
    await markOrdersForReview(decision.revisarIds, decision.motivo);
    return { ok: false, motivo: decision.motivo };
  }

  const current = await reloadOrder(decision.orderId);
  if (!current || !phonesMatch(current.clientPhone, telefone)) {
    return { ok: false, motivo: "nenhum_pedido" };
  }
  const tenantId = current.tenantId || DEFAULT_TENANT_ID;
  const alreadySame = String(current.shopeeOrderId || "") === decision.shopeeOrderId;
  if (!alreadySame || current.shopeeRouteReviewReason) {
    await db.update(ordersTable).set({
      shopeeOrderId: decision.shopeeOrderId,
      shopeeRouteReviewReason: null,
      updatedAt: new Date(),
    }).where(eq(ordersTable.id, current.id));
  }
  if (!alreadySame) {
    await addOrderEvent({
      orderId: current.id,
      tenantId,
      action: "shopee_route_id",
      actorType: "webhook",
      actorUsername: "n8n",
      payload: { shopeeOrderId: decision.shopeeOrderId, summary: `ID ${decision.shopeeOrderId}` },
    });
  }
  const marked = await markOrderEnviadoWithoutInventory(current.id, tenantId);
  if (!marked.already) {
    await addOrderEvent({
      orderId: current.id,
      tenantId,
      action: "enviado",
      actorType: "webhook",
      actorUsername: "n8n",
      payload: { from: false, to: true, via: "shopee_route", summary: "Rota Shopee, sem baixa de estoque" },
    });
  }
  const saved = (await reloadOrder(current.id)) || current;
  return {
    ok: true,
    ja_processado: decision.jaProcessado || alreadySame,
    pedido: {
      ...shopeeRouteAdminFields(saved),
      numero: saved.orderNumber ?? null,
    },
    mensagem_para_cliente: shopeeRouteCustomerReply({
      pedido: orderLabel(saved),
      shopeeOrderId: decision.shopeeOrderId,
    }),
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
