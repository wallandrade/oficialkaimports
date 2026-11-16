import { inboundTypeShouldIgnore, normalizeWhatsappPhone } from "./whatsapp-notices";
import {
  decideShopeeInbound,
  extractShopeeOrderId,
  phonesMatch,
  reviewSummary,
  shopeeRouteCustomerReply,
  type ShopeeInboundMotivo,
} from "./shopee-route-core";

export type ShopeeRouteInboundOrder = {
  id: string;
  tenantId: string | null;
  orderNumber: number | null;
  clientPhone: string;
  shopeeRouteRequestedAt: Date | null;
  shopeeOrderId: string | null;
  shopeeRouteReviewReason: string | null;
  shopeeWalletCreditedAt: Date | null;
  enviado: boolean | null;
};

export type ShopeeRouteInboundStore = {
  listAwaiting(): Promise<ShopeeRouteInboundOrder[]>;
  listByShopeeOrderId(id: string): Promise<ShopeeRouteInboundOrder[]>;
  reload(id: string): Promise<ShopeeRouteInboundOrder | null>;
  assignShopeeOrderId(id: string, shopeeOrderId: string): Promise<void>;
  markReview(id: string, motivo: string): Promise<{ changed: boolean; tenantId: string | null }>;
  markEnviado(id: string, tenantId: string): Promise<{ already: boolean }>;
  addEvent(event: {
    orderId: string;
    tenantId: string | null;
    action: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
};

export type ShopeeRouteInboundResult =
  | {
    ok: true;
    ja_processado: boolean;
    mensagem_para_cliente: string;
    order: ShopeeRouteInboundOrder;
  }
  | { ok: false; motivo: ShopeeInboundMotivo };

type SupportDeps = {
  hasAwaiting: (phone: string) => Promise<boolean>;
  receive: (input: { telefone: string; texto: string }) => Promise<
    | { ok: true; ja_processado: boolean; mensagem_para_cliente: string }
    | { ok: false; motivo: string }
  >;
  send: (message: string) => Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function readText(body: Record<string, unknown>): string {
  const text = asRecord(body.text);
  const nested = text.message;
  if (typeof nested === "string") return nested.trim();
  if (typeof body.message === "string") return body.message.trim();
  return "";
}

function readChoice(body: Record<string, unknown>): string {
  const list = asRecord(body.listResponseMessage);
  const buttons = asRecord(body.buttonsResponseMessage);
  return String(list.selectedRowId || buttons.buttonId || "").trim();
}

function orderLabel(order: { orderNumber: number | null; id: string }): string {
  return order.orderNumber != null ? String(order.orderNumber) : order.id;
}

export function orderMatchesTenant(rowTenantId: unknown, tenantId: string, defaultTenantId = "tenant_loja1"): boolean {
  const row = String(rowTenantId ?? "").trim();
  if (tenantId === defaultTenantId) return row === "" || row === defaultTenantId;
  return row === tenantId;
}

function customerText(body: Record<string, unknown>): { phone: string; text: string } | null {
  if (truthy(body.fromMe) || truthy(body.isGroup) || truthy(body.isNewsletter)) return null;
  if (truthy(body.isStatusReply) || inboundTypeShouldIgnore(body.type)) return null;
  const type = String(body.type ?? "").toLowerCase();
  if (type.includes("status")) return null;
  if (readChoice(body)) return null;
  const text = readText(body);
  if (!text) return null;
  const phone = normalizeWhatsappPhone(body.phone);
  if (!phone) return null;
  return { phone, text };
}

export async function executeShopeeRouteInbound(
  input: { telefone: string; texto: string },
  store: ShopeeRouteInboundStore,
  options: { defaultTenantId?: string; scopeTenantId?: string } = {},
): Promise<ShopeeRouteInboundResult> {
  const defaultTenantId = options.defaultTenantId || "tenant_loja1";
  const scopeTenantId = String(options.scopeTenantId || "").trim();
  const inScope = (row: { tenantId: string | null }) => !scopeTenantId || orderMatchesTenant(row.tenantId, scopeTenantId, defaultTenantId);
  const telefone = String(input.telefone || "").trim();
  if (!telefone || !phonesMatch(telefone, telefone)) {
    return { ok: false, motivo: "payload_invalido" };
  }
  const extracted = extractShopeeOrderId(input.texto);
  const awaitingRows = (await store.listAwaiting()).filter(inScope);
  const awaiting = awaitingRows
    .filter((row) => phonesMatch(row.clientPhone, telefone))
    .map((row) => ({ id: row.id, shopeeOrderId: row.shopeeOrderId }));
  const sameIdRows = extracted.id ? (await store.listByShopeeOrderId(extracted.id)).filter(inScope) : [];
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
    for (const id of decision.revisarIds) {
      const review = await store.markReview(id, decision.motivo);
      if (!review.changed) continue;
      await store.addEvent({
        orderId: id,
        tenantId: review.tenantId,
        action: "shopee_route_review",
        payload: { motivo: decision.motivo, summary: reviewSummary(decision.motivo) },
      });
    }
    return { ok: false, motivo: decision.motivo };
  }

  const current = await store.reload(decision.orderId);
  if (!current || !inScope(current) || !phonesMatch(current.clientPhone, telefone)) {
    return { ok: false, motivo: "nenhum_pedido" };
  }
  const tenantId = current.tenantId || defaultTenantId;
  const alreadySame = String(current.shopeeOrderId || "") === decision.shopeeOrderId;
  if (!alreadySame || current.shopeeRouteReviewReason) {
    await store.assignShopeeOrderId(current.id, decision.shopeeOrderId);
  }
  if (!alreadySame) {
    await store.addEvent({
      orderId: current.id,
      tenantId,
      action: "shopee_route_id",
      payload: { shopeeOrderId: decision.shopeeOrderId, summary: `ID ${decision.shopeeOrderId}` },
    });
  }
  const marked = await store.markEnviado(current.id, tenantId);
  if (!marked.already) {
    await store.addEvent({
      orderId: current.id,
      tenantId,
      action: "enviado",
      payload: { from: false, to: true, via: "shopee_route", summary: "Rota Shopee, sem baixa de estoque" },
    });
  }
  const saved = (await store.reload(current.id)) || {
    ...current,
    shopeeOrderId: decision.shopeeOrderId,
    shopeeRouteReviewReason: null,
    enviado: true,
  };
  return {
    ok: true,
    ja_processado: decision.jaProcessado || alreadySame,
    order: saved,
    mensagem_para_cliente: shopeeRouteCustomerReply({
      pedido: orderLabel(saved),
      shopeeOrderId: decision.shopeeOrderId,
    }),
  };
}

async function handleShopeeOnSupportMessageInner(
  body: Record<string, unknown>,
  deps: SupportDeps,
): Promise<"stop" | "continue"> {
  const customer = customerText(body);
  if (!customer) return "continue";
  if (!await deps.hasAwaiting(customer.phone)) return "continue";
  const result = await deps.receive({ telefone: customer.phone, texto: customer.text.slice(0, 2000) });
  if (!result.ok) return "continue";
  if (result.ja_processado) return "stop";
  await deps.send(result.mensagem_para_cliente);
  return "stop";
}

export async function handleShopeeOnSupportMessage(
  body: unknown,
  deps: SupportDeps,
): Promise<"stop" | "continue"> {
  try {
    return await handleShopeeOnSupportMessageInner(asRecord(body), deps);
  } catch {
    console.warn("[WHATSAPP_SUPPORT] Rota Shopee seguiu o atendimento");
    return "continue";
  }
}
