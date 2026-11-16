import { timingSafeEqual } from "crypto";

export const SHOPEE_ROUTE_PRODUCT_URL_KEY = "shopee_route_product_url";
export const SHOPEE_ROUTE_MESSAGE_KEY = "shopee_route_message";
export const SHOPEE_ROUTE_SECRET_HEADER = "x-n8n-shopee-secret";
export const SHOPEE_ROUTE_MESSAGE_MAX = 2000;
export const SHOPEE_ROUTE_URL_MAX = 500;

export const DEFAULT_SHOPEE_ROUTE_MESSAGE =
  "Seguimos com o seu pedido e vimos que a rota de envio com menos risco, mais rápida e mais segura, é pela Shopee. Pedimos que você faça a compra deste produto nela para darmos sequência ao seu pedido: {link_shopee}. Quando finalizar a compra, mande aqui o ID da compra para embalarmos o seu pedido. Seu pedido real: {resumo_pedido}. O valor pago na Shopee será devolvido como saldo na sua carteira do nosso site, para usar na próxima compra.";

const ORDER_SN = /^[0-9]{6}[A-Z0-9]{6,12}$/;
const NUMERIC_ID = /^[0-9]{14,20}$/;

export type ShopeeIdMotivo = "id_invalido" | "id_ambiguo";

export type ShopeeInboundMotivo = ShopeeIdMotivo | "nenhum_pedido" | "varios_pedidos" | "payload_invalido" | "nao_autorizado" | "nao_configurado";

export type ShopeeRouteTemplateData = {
  nome: string;
  pedido: string;
  resumoPedido: string;
  linkShopee: string;
  valor: string;
};

export type ShopeeRouteOrderRef = {
  id: string;
  shopeeOrderId: string | null;
};

export type ShopeeInboundDecision =
  | { ok: true; orderId: string; shopeeOrderId: string; jaProcessado: boolean }
  | { ok: false; motivo: "nenhum_pedido" | "varios_pedidos" | ShopeeIdMotivo; revisarIds: string[] };

export function sharedSecretMatches(expected: unknown, provided: unknown): boolean {
  const left = Buffer.from(String(expected || ""));
  const right = Buffer.from(String(provided || ""));
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function normalizeShopeeProductUrl(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value || value.length > SHOPEE_ROUTE_URL_MAX) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseShopeeRouteMessage(raw: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  const value = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!value) return { ok: true, value: null };
  if (value.length > SHOPEE_ROUTE_MESSAGE_MAX) {
    return { ok: false, message: "A mensagem da Rota Shopee passa de 2000 caracteres." };
  }
  return { ok: true, value };
}

export function effectiveShopeeRouteMessage(stored: unknown): string {
  const parsed = parseShopeeRouteMessage(stored);
  if (!parsed.ok || !parsed.value) return DEFAULT_SHOPEE_ROUTE_MESSAGE;
  return parsed.value;
}

export function firstClientName(name: unknown): string {
  const token = String(name ?? "").trim().split(/\s+/).filter(Boolean)[0] || "";
  return token || "cliente";
}

export function formatBrl(value: unknown): string {
  const amount = Math.round((Number(value) || 0) * 100) / 100;
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function summarizeOrderProducts(products: unknown): {
  itens: Array<{ nome: string; quantidade: number }>;
  texto: string;
} {
  const rows = Array.isArray(products) ? products : [];
  const itens: Array<{ nome: string; quantidade: number }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as { name?: unknown; productName?: unknown; quantity?: unknown };
    const nome = String(record.name || record.productName || "Produto").trim() || "Produto";
    const quantidade = Math.max(0, Math.round(Number(record.quantity) || 0));
    if (quantidade <= 0) continue;
    itens.push({ nome, quantidade });
  }
  const texto = itens.length > 0
    ? itens.map((item) => `${item.quantidade}x ${item.nome}`).join(", ")
    : "Sem itens";
  return { itens, texto };
}

export function renderShopeeRouteMessage(template: string, data: ShopeeRouteTemplateData): string {
  const map: Record<string, string> = {
    nome: data.nome,
    pedido: data.pedido,
    resumo_pedido: data.resumoPedido,
    link_shopee: data.linkShopee,
    valor: data.valor,
  };
  return String(template || "").replace(/\{(nome|pedido|resumo_pedido|link_shopee|valor)\}/g, (_match, key: string) => map[key] ?? "");
}

export function shopeeRouteCustomerReply(input: { pedido: string; shopeeOrderId: string }): string {
  return `Recebemos o ID ${input.shopeeOrderId} da compra. Vamos embalar o pedido ${input.pedido}. O valor pago na Shopee entra como saldo na sua carteira do site.`;
}

export function normalizeShopeeOrderId(raw: unknown): string | null {
  const value = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!value) return null;
  if (ORDER_SN.test(value) && /[A-Z]/.test(value)) return value;
  if (NUMERIC_ID.test(value)) return value;
  return null;
}

export function extractShopeeOrderId(text: unknown): { id: string | null; motivo: ShopeeIdMotivo | null } {
  const raw = String(text ?? "").trim().slice(0, SHOPEE_ROUTE_MESSAGE_MAX);
  if (!raw) return { id: null, motivo: "id_invalido" };

  const compact = raw.replace(/[^A-Za-z0-9]/g, "");
  const direct = normalizeShopeeOrderId(compact);
  if (direct && compact.toUpperCase() === direct && raw.length <= direct.length + 8) {
    return { id: direct, motivo: null };
  }

  const found = new Set<string>();
  const tokens = raw.match(/[A-Za-z0-9][A-Za-z0-9-]{5,30}/g) || [];
  for (const token of tokens) {
    const id = normalizeShopeeOrderId(token);
    if (id) found.add(id);
  }
  const digitRuns = raw.match(/\d{14,20}/g) || [];
  for (const run of digitRuns) {
    const id = normalizeShopeeOrderId(run);
    if (id) found.add(id);
  }
  if (found.size === 1) return { id: [...found][0] || null, motivo: null };
  if (found.size > 1) return { id: null, motivo: "id_ambiguo" };
  return { id: null, motivo: "id_invalido" };
}

export function parseAdminShopeeOrderId(raw: unknown): { ok: true; id: string | null } | { ok: false; message: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, id: null };
  const extracted = extractShopeeOrderId(text);
  if (!extracted.id) {
    return {
      ok: false,
      message: extracted.motivo === "id_ambiguo"
        ? "Informe só um ID da Shopee."
        : "ID da Shopee inválido. Use o código da compra ou o número de 14 a 20 dígitos.",
    };
  }
  return { ok: true, id: extracted.id };
}

export function phoneMatchKeys(value: unknown): string[] {
  let digits = String(value ?? "").replace(/\D/g, "");
  while (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits) return [];
  let local = digits;
  if (local.startsWith("55") && local.length >= 12) local = local.slice(2);
  const keys = new Set<string>();
  if (local.length === 10 || local.length === 11) {
    keys.add(local);
    if (local.length === 11 && local[2] === "9") keys.add(local.slice(0, 2) + local.slice(3));
    if (local.length === 10) keys.add(`${local.slice(0, 2)}9${local.slice(2)}`);
  }
  return [...keys];
}

export function phonesMatch(left: unknown, right: unknown): boolean {
  const keys = new Set(phoneMatchKeys(left));
  if (keys.size === 0) return false;
  return phoneMatchKeys(right).some((key) => keys.has(key));
}

export function decideShopeeInbound(input: {
  motivoId: ShopeeIdMotivo | null;
  shopeeOrderId: string | null;
  awaiting: ShopeeRouteOrderRef[];
  sameId: ShopeeRouteOrderRef[];
}): ShopeeInboundDecision {
  const awaiting = input.awaiting.filter((row) => !String(row.shopeeOrderId || "").trim());
  const awaitingIds = new Set(awaiting.map((row) => row.id));
  const sameId = input.sameId.filter((row) => !awaitingIds.has(row.id) && row.shopeeOrderId === input.shopeeOrderId);

  if (input.motivoId || !input.shopeeOrderId) {
    return {
      ok: false,
      motivo: input.motivoId || "id_invalido",
      revisarIds: awaiting.map((row) => row.id),
    };
  }
  if (awaiting.length === 1) {
    const order = awaiting[0];
    if (!order) return { ok: false, motivo: "nenhum_pedido", revisarIds: [] };
    return { ok: true, orderId: order.id, shopeeOrderId: input.shopeeOrderId, jaProcessado: false };
  }
  if (awaiting.length > 1) {
    return { ok: false, motivo: "varios_pedidos", revisarIds: awaiting.map((row) => row.id) };
  }
  if (sameId.length === 1) {
    const order = sameId[0];
    if (!order) return { ok: false, motivo: "nenhum_pedido", revisarIds: [] };
    return { ok: true, orderId: order.id, shopeeOrderId: input.shopeeOrderId, jaProcessado: true };
  }
  if (sameId.length > 1) {
    return { ok: false, motivo: "varios_pedidos", revisarIds: sameId.map((row) => row.id) };
  }
  return { ok: false, motivo: "nenhum_pedido", revisarIds: [] };
}

export function shopeeCreditAmount(total: unknown, paidAmount: unknown): number {
  const primary = Math.round((Number(total) || 0) * 100) / 100;
  if (primary > 0) return primary;
  const paid = Math.round((Number(paidAmount) || 0) * 100) / 100;
  return paid > 0 ? paid : 0;
}

export function reviewSummary(motivo: string): string {
  if (motivo === "id_invalido") return "ID inválido";
  if (motivo === "id_ambiguo") return "Mais de um ID na mensagem";
  if (motivo === "varios_pedidos") return "Mais de um pedido aguardando";
  return "Revisão manual";
}
