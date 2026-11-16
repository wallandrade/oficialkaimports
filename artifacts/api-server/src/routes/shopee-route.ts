import { Router, type IRouter } from "express";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { actorFromAdminRequest } from "../lib/order-events";
import {
  composeShopeeRouteMessage,
  creditShopeeRouteWallet,
  loadShopeeRouteOrder,
  markShopeeRouteRequested,
  postShopeeRouteWebhook,
  buildShopeeRoutePayload,
  readShopeeWebhookConfig,
  receiveShopeeRouteInbound,
  saveAdminShopeeOrderId,
  shopeeRouteAdminFields,
  shopeeRoutePhone,
} from "../lib/shopee-route";
import { parseAdminShopeeOrderId, sharedSecretMatches, SHOPEE_ROUTE_SECRET_HEADER } from "../lib/shopee-route-core";

const router: IRouter = Router();

function inboundSecretOk(header: unknown): boolean {
  const secret = String(process.env.N8N_SHOPEE_SECRET || "").trim();
  return sharedSecretMatches(secret, header);
}

router.post("/integrations/shopee-route/inbound", async (req, res) => {
  try {
    if (!String(process.env.N8N_SHOPEE_SECRET || "").trim()) {
      res.status(503).json({ ok: false, motivo: "nao_configurado" });
      return;
    }
    if (!inboundSecretOk(req.get(SHOPEE_ROUTE_SECRET_HEADER))) {
      res.status(401).json({ ok: false, motivo: "nao_autorizado" });
      return;
    }
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ ok: false, motivo: "payload_invalido" });
      return;
    }
    const record = body as { telefone?: unknown; phone?: unknown; texto?: unknown; text?: unknown; id?: unknown; shopeeId?: unknown };
    const telefone = String(record.telefone ?? record.phone ?? "").slice(0, 40);
    const texto = String(record.texto ?? record.text ?? record.id ?? record.shopeeId ?? "").slice(0, 2000);
    if (!telefone.trim() || !texto.trim()) {
      res.status(400).json({ ok: false, motivo: "payload_invalido" });
      return;
    }
    const result = await receiveShopeeRouteInbound({ telefone, texto });
    res.status(200).json(result);
  } catch (err) {
    console.error("[ShopeeRoute] entrada do n8n falhou", err);
    res.status(500).json({ ok: false, motivo: "erro_interno" });
  }
});

router.post("/admin/orders/:id/shopee-route", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    const order = await loadShopeeRouteOrder(String(req.params.id || ""), scope);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    const alreadySent = Boolean(order.shopeeRouteRequestedAt) || Boolean(String(order.shopeeOrderId || "").trim());
    if (alreadySent && req.body?.confirm !== true) {
      res.status(409).json({
        error: "CONFIRM_REQUIRED",
        message: "Este pedido já entrou na Rota Shopee. Confirme para enviar de novo.",
      });
      return;
    }
    const phone = shopeeRoutePhone(order.clientPhone);
    if (!phone) {
      res.status(400).json({ error: "INVALID_PHONE", message: "Pedido sem telefone válido para o WhatsApp." });
      return;
    }
    const composed = await composeShopeeRouteMessage(order);
    if ("error" in composed) {
      res.status(400).json({ error: "SHOPEE_LINK_REQUIRED", message: composed.error });
      return;
    }
    const webhook = readShopeeWebhookConfig();
    if (!webhook) {
      res.status(503).json({
        error: "NOT_CONFIGURED",
        message: "Rota Shopee sem URL https ou sem segredo no servidor.",
      });
      return;
    }
    const payload = buildShopeeRoutePayload(order, phone, composed.link, composed.message);
    let posted: { ok: true } | { ok: false; status: number };
    try {
      posted = await postShopeeRouteWebhook(webhook.url, webhook.secret, payload);
    } catch {
      console.error("[ShopeeRoute] webhook não respondeu");
      res.status(502).json({ error: "WEBHOOK_FAILED", message: "O n8n não confirmou o envio." });
      return;
    }
    if (!posted.ok) {
      console.warn("[ShopeeRoute] webhook recusou", { orderId: order.id, status: posted.status });
      res.status(502).json({ error: "WEBHOOK_FAILED", message: "O n8n não confirmou o envio." });
      return;
    }
    const saved = await markShopeeRouteRequested(order, actorFromAdminRequest(req));
    res.json({ ok: true, order: shopeeRouteAdminFields(saved) });
  } catch (err) {
    console.error("[ShopeeRoute] disparo falhou", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao enviar a Rota Shopee." });
  }
});

router.patch("/admin/orders/:id/shopee-order-id", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    const order = await loadShopeeRouteOrder(String(req.params.id || ""), scope);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    const parsed = parseAdminShopeeOrderId(req.body?.shopeeOrderId);
    if (!parsed.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: parsed.message });
      return;
    }
    const saved = await saveAdminShopeeOrderId(order, parsed.id, actorFromAdminRequest(req));
    res.json({ ok: true, order: shopeeRouteAdminFields(saved) });
  } catch (err) {
    console.error("[ShopeeRoute] ID manual falhou", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar o ID da Shopee." });
  }
});

router.post("/admin/orders/:id/shopee-wallet-credit", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    if (!scope.hasGlobalAccess) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para lançar crédito na carteira." });
      return;
    }
    const order = await loadShopeeRouteOrder(String(req.params.id || ""), scope);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    const result = await creditShopeeRouteWallet(order, actorFromAdminRequest(req));
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, message: result.message });
      return;
    }
    res.json({
      ok: true,
      already: result.already,
      amount: result.amount,
      userId: result.userId,
      availableCredit: result.availableCredit,
      order: shopeeRouteAdminFields(result.order),
    });
  } catch (err) {
    console.error("[ShopeeRoute] crédito falhou", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao lançar o crédito na carteira." });
  }
});

export default router;
