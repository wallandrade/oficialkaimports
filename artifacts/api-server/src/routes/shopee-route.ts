import { Router, type IRouter } from "express";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { actorFromAdminRequest } from "../lib/order-events";
import { OrderEnviadoError } from "../lib/order-enviado";
import {
  composeShopeeRouteMessage,
  creditShopeeRouteWallet,
  loadShopeeRouteOrder,
  markAdminShopeeBoardSent,
  markShopeeRouteRequested,
  sendShopeeRouteWhatsapp,
  receiveShopeeRouteInbound,
  saveAdminShopeeOrderId,
  shopeeRouteAdminFields,
  shopeeRoutePhone,
} from "../lib/shopee-route";
import { parseAdminShopeeOrderId, selectShopeeRouteProducts, sharedSecretMatches, SHOPEE_ROUTE_SECRET_HEADER } from "../lib/shopee-route-core";
import { listOrderShipments } from "../lib/order-shipments";
import { isSplitShipments } from "../lib/order-shipments-logic";

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
    const packages = await listOrderShipments(order.id);
    const selected = selectShopeeRouteProducts({
      split: isSplitShipments(packages),
      packageId: req.body?.packageId,
      orderProducts: order.products,
      packages: packages.map((row) => ({ id: row.id, items: row.items })),
    });
    if (!selected.ok) {
      res.status(selected.status).json({ error: selected.error, message: selected.message });
      return;
    }
    const composed = await composeShopeeRouteMessage(order, selected.products);
    if ("error" in composed) {
      res.status(400).json({ error: "SHOPEE_LINK_REQUIRED", message: composed.error });
      return;
    }
    let posted: { ok: true; queued: boolean } | { ok: false; error: string };
    try {
      posted = await sendShopeeRouteWhatsapp({
        order,
        phone,
        message: composed.message,
        link: composed.link,
        products: selected.products,
        packageId: selected.packageId,
      });
    } catch {
      console.error("[ShopeeRoute] WhatsApp não respondeu", { orderId: order.id });
      res.status(502).json({ error: "WHATSAPP_FAILED", message: "O WhatsApp não confirmou o envio." });
      return;
    }
    if (!posted.ok) {
      const missing = posted.error === "zapi_not_configured" || posted.error === "not_configured";
      console.warn("[ShopeeRoute] WhatsApp recusou", { orderId: order.id, error: posted.error });
      res.status(missing ? 503 : 502).json({
        error: missing ? "NOT_CONFIGURED" : "WHATSAPP_FAILED",
        message: posted.error === "not_configured"
          ? "Rota Shopee sem a URL do n8n."
          : posted.error === "zapi_not_configured"
            ? "Rota Shopee sem a instância do WhatsApp no servidor."
            : "O WhatsApp não confirmou o envio.",
      });
      return;
    }
    const saved = await markShopeeRouteRequested(order, actorFromAdminRequest(req), {
      packageId: selected.packageId,
      summary: composed.summary,
    });
    res.json({
      ok: true,
      queued: posted.queued,
      order: shopeeRouteAdminFields(saved),
      packageId: selected.packageId,
      shopeeRouteSentAt: saved.shopeeRouteRequestedAt ? saved.shopeeRouteRequestedAt.toISOString() : null,
    });
  } catch (err) {
    console.error("[ShopeeRoute] disparo falhou", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao enviar a Rota Shopee." });
  }
});

router.patch("/admin/orders/:id/shopee-board-sent", requireAdminAuth, async (req, res) => {
  const scope = getAdminScope(req);
  if (!scope) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return;
  }
  if (!scope.hasGlobalAccess && !scope.sellerCode) {
    res.status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
    return;
  }
  const orderId = String(req.params.id || "").trim();
  try {
    const order = await loadShopeeRouteOrder(orderId, scope);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    const result = await markAdminShopeeBoardSent(order, actorFromAdminRequest(req));
    res.json({
      ok: true,
      id: order.id,
      enviado: true,
      already: result.already,
      order: shopeeRouteAdminFields(result.order),
    });
  } catch (err) {
    const code = err instanceof OrderEnviadoError ? err.code : "INTERNAL";
    console.error("[ShopeeRoute] quadro enviado falhou", { orderId, code });
    if (err instanceof OrderEnviadoError) {
      res.status(err.code === "NOT_FOUND" ? 404 : 400).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao marcar o pedido como enviado." });
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
