import { Router, type IRouter, type Request, type Response } from "express";
import { db, ordersTable } from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { getCustomerSession, requireCustomerAuth } from "../middlewares/customer-auth";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";
import { isStandardShipping } from "../lib/order-logistics-calendar";
import { buildCallbackUrl } from "../gateway";
import { getR2MissingConfig, isR2Configured, uploadShipmentLabelPdfToR2 } from "../lib/r2";
import { loadEnvioEcomConfig, maskSecret, saveEnvioEcomConfig } from "../lib/envioecom-config";
import { createEnvioEcomClient, EnvioEcomApiError, type EnvioEcomClient } from "../lib/envioecom-client";
import {
  buildConsolidatedQuotePackage,
  formatDimension,
  formatMoney,
  formatWeight,
} from "../lib/envioecom-package";
import { isLabelBlockedStatus, isProvisionalBarcode, isUsableLabelBarcode } from "../lib/envioecom-status";
import {
  buildExternalOrderNumber,
  digitsOnly,
  findOrderForEnvioEcomWebhook,
  parseCreatedShipment,
  parseShipmentDetails,
  persistEnvioEcomShipment,
  sanitizeDocument,
  sanitizeUf,
} from "../lib/envioecom-order";

const router: IRouter = Router();

function buildOrderTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

function canManageEnvioEcom(scope: ReturnType<typeof getAdminScope>): boolean {
  return !!scope?.hasGlobalAccess;
}

function requireEnvioEcomAdmin(req: Request, res: Response): { tenantId: string } | null {
  const scope = getAdminScope(req);
  if (!scope) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return null;
  }
  if (!canManageEnvioEcom(scope)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para gerenciar EnvioEcom." });
    return null;
  }
  return { tenantId: scope.tenantId || DEFAULT_TENANT_ID };
}

function sendEnvioEcomError(res: Response, err: unknown) {
  if (err instanceof EnvioEcomApiError) {
    res.status(err.httpStatus >= 400 && err.httpStatus < 600 ? err.httpStatus : 400).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }
  console.error("[EnvioEcom]", err);
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro na integração EnvioEcom." });
}

async function getClientOrReject(tenantId: string, res: Response): Promise<EnvioEcomClient | null> {
  const config = await loadEnvioEcomConfig(tenantId);
  if (!config.configured) {
    res.status(400).json({ error: "ENVIOECOM_NOT_CONFIGURED", message: "EnvioEcom não configurado para esta loja." });
    return null;
  }
  return createEnvioEcomClient({
    tenantId,
    baseUrl: config.baseUrl,
    token: config.token,
    email: config.email,
    password: config.password,
    neverExpires: config.neverExpires,
  });
}

async function loadTenantOrder(orderId: string, tenantId: string) {
  const rows = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), buildOrderTenantWhere(tenantId)))
    .limit(1);
  return rows[0] || null;
}

function publicWebhookUrl(req: Request): string {
  const envBase = String(process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (envBase) return `${envBase}/api/webhook/envioecom`;
  return buildCallbackUrl(req as never, "/webhook/envioecom");
}

function mapEnvioEcomOrder(order: typeof ordersTable.$inferSelect) {
  return {
    id: order.id,
    orderNumber: order.orderNumber ?? null,
    clientName: order.clientName,
    status: order.status,
    enviado: !!order.enviado,
    shippingType: order.shippingType,
    trackingCode: order.trackingCode ?? null,
    trackingLabelUrl: order.trackingLabelUrl ?? null,
    envioecomShipmentId: order.envioecomShipmentId ?? null,
    envioecomBarcode: order.envioecomBarcode ?? null,
    envioecomTrackingKey: order.envioecomTrackingKey ?? null,
    envioecomDeliveryMode: order.envioecomDeliveryMode ?? null,
    envioecomStatus: order.envioecomStatus ?? null,
    envioecomStatusUpdatedAt: order.envioecomStatusUpdatedAt?.toISOString?.() ?? order.envioecomStatusUpdatedAt ?? null,
    envioecomStatusHistory: order.envioecomStatusHistory ?? [],
    envioecomLabelUrl: order.envioecomLabelUrl ?? null,
    envioecomFreightCost: order.envioecomFreightCost != null ? Number(order.envioecomFreightCost) : null,
    envioecomExternalOrderNumber: order.envioecomExternalOrderNumber ?? null,
  };
}

async function refreshShipment(client: EnvioEcomClient, order: typeof ordersTable.$inferSelect) {
  if (order.envioecomShipmentId) {
    const details = await client.getById(order.envioecomShipmentId);
    return persistEnvioEcomShipment(order, parseShipmentDetails(details));
  }
  const identifier = String(order.envioecomBarcode || order.trackingCode || "").trim();
  if (identifier && !isProvisionalBarcode(identifier)) {
    const details = await client.getByIdentifier(identifier);
    return persistEnvioEcomShipment(order, parseShipmentDetails(details));
  }
  return order;
}

router.get("/admin/envioecom/status", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const config = await loadEnvioEcomConfig(admin.tenantId);
    res.json({
      configured: config.configured,
      hasToken: !!config.token,
      tokenMasked: maskSecret(config.token),
      hasEmail: !!config.email,
      originCep: config.originCep || null,
      carriers: config.carriers,
      defaults: config.defaults,
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.get("/admin/envioecom/config", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const config = await loadEnvioEcomConfig(admin.tenantId);
    res.json({
      configured: config.configured,
      tokenMasked: maskSecret(config.token),
      email: config.email || "",
      originCep: config.originCep || "",
      carriers: config.carriers,
      defaults: config.defaults,
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.put("/admin/envioecom/config", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const body = req.body as Record<string, unknown>;
    await saveEnvioEcomConfig(admin.tenantId, {
      token: body.token === undefined ? undefined : String(body.token ?? ""),
      email: body.email === undefined ? undefined : String(body.email ?? ""),
      password: body.password === undefined ? undefined : String(body.password ?? ""),
      originCep: body.originCep === undefined ? undefined : String(body.originCep ?? ""),
      defaultWeight: body.defaultWeight === undefined ? undefined : String(body.defaultWeight ?? ""),
      defaultLength: body.defaultLength === undefined ? undefined : String(body.defaultLength ?? ""),
      defaultHeight: body.defaultHeight === undefined ? undefined : String(body.defaultHeight ?? ""),
      defaultWidth: body.defaultWidth === undefined ? undefined : String(body.defaultWidth ?? ""),
      carriers: body.carriers === undefined ? undefined : (Array.isArray(body.carriers) ? body.carriers.map(String) : String(body.carriers ?? "")),
    });
    const config = await loadEnvioEcomConfig(admin.tenantId);
    res.json({ ok: true, configured: config.configured, originCep: config.originCep });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.get("/admin/envioecom/webhook", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const client = await getClientOrReject(admin.tenantId, res);
    if (!client) return;
    const current = await client.getWebhook();
    res.json({
      url: current.url ?? null,
      enabled: !!current.enabled,
      suggestedUrl: publicWebhookUrl(req),
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/webhook", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const client = await getClientOrReject(admin.tenantId, res);
    if (!client) return;
    const url = String((req.body as { url?: string })?.url || publicWebhookUrl(req)).trim();
    const saved = await client.setWebhook({ url, enabled: true });
    res.json({ ok: true, url: saved.url ?? url, enabled: saved.enabled !== false, message: saved.message });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/orders/:id/quote", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const order = await loadTenantOrder(String(req.params.id), admin.tenantId);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    if (!["paid", "completed"].includes(order.status)) {
      res.status(400).json({ error: "ORDER_NOT_PAID", message: "Só é possível cotar pedidos pagos." });
      return;
    }
    if (!isStandardShipping(order.shippingType)) {
      res.status(400).json({ error: "UNSUPPORTED_SHIPPING", message: "EnvioEcom não se aplica a motoboy ou retirada." });
      return;
    }
    const destination = digitsOnly(order.addressCep);
    if (destination.length !== 8) {
      res.status(400).json({ error: "INVALID_CEP", message: "CEP de destino inválido no pedido." });
      return;
    }
    const config = await loadEnvioEcomConfig(admin.tenantId);
    const client = await getClientOrReject(admin.tenantId, res);
    if (!client) return;
    const packed = buildConsolidatedQuotePackage({ products: order.products, defaults: config.defaults });
    const carriersFilter = Array.isArray((req.body as { carriers?: string[] })?.carriers)
      ? (req.body as { carriers: string[] }).carriers
      : config.carriers;
    const payload: Record<string, unknown> = {
      postal_code_destination: destination,
      aviso_recebimento: false,
      products: [packed.product],
    };
    if (carriersFilter.length) payload.carriers = carriersFilter;
    const quoted = await client.quote(payload);
    res.json({
      originZipcode: quoted.origin_zipcode || quoted.origin_zip || config.originCep,
      destinationZipcode: quoted.destination_zipcode || destination,
      quotes: quoted.quotes || [],
      unavailableCarriers: quoted.unavailable_carriers || [],
      package: packed.product,
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/orders/:id/create", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const order = await loadTenantOrder(String(req.params.id), admin.tenantId);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    if (!["paid", "completed"].includes(order.status)) {
      res.status(400).json({ error: "ORDER_NOT_PAID", message: "Só é possível criar envio de pedidos pagos." });
      return;
    }
    if (!isStandardShipping(order.shippingType)) {
      res.status(400).json({ error: "UNSUPPORTED_SHIPPING", message: "EnvioEcom não se aplica a motoboy ou retirada." });
      return;
    }
    const body = req.body as {
      shippingCompany?: string;
      freightCost?: string | number;
      deliveryTime?: string | number;
      originCep?: string;
      height?: string | number;
      width?: string | number;
      length?: string | number;
      weight?: string | number;
    };
    const shippingCompany = String(body.shippingCompany || "").trim();
    if (!shippingCompany) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe a transportadora exatamente como na cotação." });
      return;
    }
    const config = await loadEnvioEcomConfig(admin.tenantId);
    const originCep = digitsOnly(body.originCep || config.originCep);
    if (originCep.length !== 8) {
      res.status(400).json({ error: "ORIGIN_CEP_REQUIRED", message: "CEP de origem obrigatório. Configure nas settings da loja." });
      return;
    }
    const destination = digitsOnly(order.addressCep);
    if (destination.length !== 8) {
      res.status(400).json({ error: "INVALID_CEP", message: "CEP de destino inválido no pedido." });
      return;
    }
    const packed = buildConsolidatedQuotePackage({ products: order.products, defaults: config.defaults });
    const client = await getClientOrReject(admin.tenantId, res);
    if (!client) return;
    const externalOrderNumber = order.envioecomExternalOrderNumber || buildExternalOrderNumber(order);
    const created = await client.create({
      defer_payment: false,
      shipments: [{
        orderId: externalOrderNumber,
        shipping_company: shippingCompany,
        cep_origem: originCep,
        cep_destino: destination,
        freight_cost: formatMoney(Number(body.freightCost || 0)),
        delivery_time: String(body.deliveryTime || "1"),
        height: formatDimension(Number(body.height || packed.product.height)),
        width: formatDimension(Number(body.width || packed.product.width)),
        length: formatDimension(Number(body.length || packed.product.length)),
        weight: formatWeight(Number(body.weight || packed.product.weight)),
        cost: formatMoney(packed.declaredValue),
        name: String(order.clientName || "Cliente").slice(0, 120),
        document_number: sanitizeDocument(order.clientDocument),
        phone_number: digitsOnly(order.clientPhone).slice(-11),
        email: String(order.clientEmail || "").trim(),
        logradouro: String(order.addressStreet || "").trim() || "Não informado",
        number: String(order.addressNumber || "S/N").trim() || "S/N",
        complemento: String(order.addressComplement || "").trim(),
        bairro: String(order.addressNeighborhood || "").trim() || "Centro",
        localidade: String(order.addressCity || "").trim() || "Cidade",
        uf: sanitizeUf(order.addressState),
        items: packed.items.length ? packed.items : [{ name: "Pedido", quantity: 1, unit_cost: packed.declaredValue }],
      }],
    });

    let persisted = await persistEnvioEcomShipment(order, {
      ...parseCreatedShipment(created),
      deliveryMode: shippingCompany,
      externalOrderNumber,
    });
    try {
      persisted = await refreshShipment(client, persisted);
    } catch (err) {
      console.warn("[EnvioEcom] Sync pós-create falhou:", err);
    }
    res.json({ ok: true, order: mapEnvioEcomOrder(persisted), raw: created });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/orders/:id/bind-id", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const order = await loadTenantOrder(String(req.params.id), admin.tenantId);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    const shipmentId = Number((req.body as { shipmentId?: number })?.shipmentId);
    if (!Number.isFinite(shipmentId) || shipmentId <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe o ID numérico do envio no painel EnvioEcom." });
      return;
    }
    const client = await getClientOrReject(admin.tenantId, res);
    if (!client) return;
    const details = await client.getById(shipmentId);
    const persisted = await persistEnvioEcomShipment(order, parseShipmentDetails(details));
    res.json({ ok: true, order: mapEnvioEcomOrder(persisted) });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/orders/:id/labels", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const order = await loadTenantOrder(String(req.params.id), admin.tenantId);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    const requestedId = Number((req.body as { shipmentId?: number })?.shipmentId);
    const shipmentId = Number.isFinite(requestedId) && requestedId > 0 ? requestedId : order.envioecomShipmentId;
    if (!shipmentId) {
      const barcode = String(order.envioecomBarcode || order.trackingCode || "").trim();
      if (isProvisionalBarcode(barcode) || !barcode) {
        res.status(400).json({
          error: "SHIPMENT_ID_REQUIRED",
          message: "Não use o código EC provisório. Informe o ID numérico do envio no painel EnvioEcom.",
        });
        return;
      }
    }
    if (isLabelBlockedStatus(order.envioecomStatus)) {
      res.status(400).json({
        error: "LABEL_BLOCKED",
        message: `Não é possível gerar etiqueta com status "${order.envioecomStatus}".`,
      });
      return;
    }
    if (!isR2Configured()) {
      res.status(503).json({
        error: "R2_NOT_CONFIGURED",
        message: "Cloudflare R2 não está configurado no servidor.",
        missing: getR2MissingConfig(),
      });
      return;
    }
    const client = await getClientOrReject(admin.tenantId, res);
    if (!client) return;
    const payload = shipmentId
      ? { ids: [Number(shipmentId)] }
      : { barcodes: [String(order.envioecomBarcode || order.trackingCode)] };
    const result = await client.generateLabels(payload);
    if (result.kind !== "pdf") {
      const code = String((result.json as { error?: { code?: string } } | null)?.error?.code || "LABEL_PROCESSING");
      res.status(202).json({
        error: code,
        message: "Etiqueta ainda em processamento. Tente novamente em instantes.",
        details: result.json,
      });
      return;
    }
    const labelUrl = await uploadShipmentLabelPdfToR2({ buffer: result.buffer, orderId: order.id });
    const persisted = await persistEnvioEcomShipment(order, {
      shipmentId: shipmentId || order.envioecomShipmentId,
      barcode: isUsableLabelBarcode(order.envioecomBarcode) ? order.envioecomBarcode : order.trackingCode,
      labelUrl,
      status: order.envioecomStatus || "Etiqueta emitida",
    });
    res.json({ ok: true, labelUrl, order: mapEnvioEcomOrder(persisted) });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/orders/:id/sync", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const order = await loadTenantOrder(String(req.params.id), admin.tenantId);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    const client = await getClientOrReject(admin.tenantId, res);
    if (!client) return;
    const persisted = await refreshShipment(client, order);
    res.json({ ok: true, order: mapEnvioEcomOrder(persisted) });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/orders/:id/cancel", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const order = await loadTenantOrder(String(req.params.id), admin.tenantId);
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }
    const identifier = String(order.envioecomShipmentId || order.envioecomBarcode || order.trackingCode || "").trim();
    if (!identifier) {
      res.status(400).json({ error: "NO_SHIPMENT", message: "Este pedido ainda não tem envio EnvioEcom." });
      return;
    }
    const client = await getClientOrReject(admin.tenantId, res);
    if (!client) return;
    const reason = String((req.body as { reason?: string })?.reason || "").trim();
    const cancelled = await client.cancel(identifier, reason || undefined);
    const persisted = await persistEnvioEcomShipment(order, {
      status: String(cancelled.status || "Cancelado"),
      description: String(cancelled.message || ""),
    });
    res.json({
      ok: true,
      autoCancelled: !!cancelled.auto_cancelled,
      message: cancelled.message,
      order: mapEnvioEcomOrder(persisted),
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.get("/admin/envioecom/tracking-board", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(
        buildOrderTenantWhere(admin.tenantId),
        or(
          isNotNull(ordersTable.envioecomShipmentId),
          isNotNull(ordersTable.envioecomBarcode),
          isNotNull(ordersTable.envioecomStatus),
        ),
      ))
      .orderBy(desc(ordersTable.envioecomStatusUpdatedAt), desc(ordersTable.updatedAt))
      .limit(200);
    res.json({ orders: rows.map(mapEnvioEcomOrder) });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/tracking-board/sync", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const client = await getClientOrReject(admin.tenantId, res);
    if (!client) return;
    const requestedIds = Array.isArray((req.body as { orderIds?: string[] })?.orderIds)
      ? (req.body as { orderIds: string[] }).orderIds.map(String)
      : [];
    const rows = requestedIds.length
      ? await db.select().from(ordersTable).where(and(buildOrderTenantWhere(admin.tenantId), inArray(ordersTable.id, requestedIds.slice(0, 20))))
      : await db
          .select()
          .from(ordersTable)
          .where(and(buildOrderTenantWhere(admin.tenantId), isNotNull(ordersTable.envioecomShipmentId)))
          .orderBy(desc(ordersTable.envioecomStatusUpdatedAt))
          .limit(20);

    const synced = [];
    for (const order of rows.slice(0, 20)) {
      try {
        synced.push(mapEnvioEcomOrder(await refreshShipment(client, order)));
      } catch (err) {
        console.warn("[EnvioEcom] sync lote falhou", order.id, err);
      }
    }
    res.json({ ok: true, orders: synced });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.get("/me/orders/:id/tracking", requireCustomerAuth, async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req as never);
    const session = getCustomerSession(req);
    if (!session) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    const orderId = String(req.params.id);
    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), buildOrderTenantWhere(tenantId), eq(ordersTable.userId, session.userId)))
      .limit(1);
    const order = rows[0];
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    let current = order;
    const config = await loadEnvioEcomConfig(tenantId);
    if (config.configured && (order.envioecomShipmentId || isUsableLabelBarcode(order.envioecomBarcode || order.trackingCode))) {
      try {
        const client = createEnvioEcomClient({
          tenantId,
          baseUrl: config.baseUrl,
          token: config.token,
          email: config.email,
          password: config.password,
          neverExpires: config.neverExpires,
        });
        current = await refreshShipment(client, order);
      } catch (err) {
        console.warn("[EnvioEcom] soft-sync cliente falhou:", err);
      }
    }

    res.json({
      orderId: current.id,
      enviado: !!current.enviado,
      status: current.status,
      envioecomStatus: current.envioecomStatus ?? null,
      deliveryMode: current.envioecomDeliveryMode ?? null,
      barcode: current.envioecomBarcode || current.trackingCode || null,
      history: current.envioecomStatusHistory ?? [],
      updatedAt: current.envioecomStatusUpdatedAt?.toISOString?.() ?? null,
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

export async function applyEnvioEcomWebhook(body: Record<string, unknown>): Promise<{ matched: boolean; orderId?: string }> {
  const barcode = String(body.barcode || "").trim() || null;
  const externalOrderNumber = String(body.external_order_number || "").trim() || null;
  const shipmentId = Number(body.shipment_id);
  const order = await findOrderForEnvioEcomWebhook({
    barcode,
    externalOrderNumber,
    shipmentId: Number.isFinite(shipmentId) ? shipmentId : null,
  });
  if (!order) return { matched: false };

  await persistEnvioEcomShipment(order, {
    shipmentId: Number.isFinite(shipmentId) ? shipmentId : null,
    barcode,
    trackingKey: String(body.tracking_key || "").trim() || null,
    deliveryMode: String(body.delivery_mode || "").trim() || null,
    status: String(body.status || "").trim() || null,
    freightCost: body.freight_cost != null ? String(body.freight_cost) : null,
    externalOrderNumber,
    description: String(body.description || "").trim() || null,
  });
  return { matched: true, orderId: order.id };
}

export default router;
