import { Router, type IRouter, type Request, type Response } from "express";
import { db, ordersTable } from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { getCustomerSession, requireCustomerAuth } from "../middlewares/customer-auth";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";
import { actorFromAdminRequest, addOrderEvent } from "../lib/order-events";
import { isStandardShipping } from "../lib/order-logistics-calendar";
import { buildCallbackUrl } from "../gateway";
import { getR2MissingConfig, isR2Configured, uploadShipmentLabelPdfToR2 } from "../lib/r2";
import {
  ENVIOECOM_DEFAULT_SHIPMENT_ITEM_NAME,
  ENVIOECOM_DEFAULT_SHIPMENT_ITEM_QUANTITY,
  ENVIOECOM_DEFAULT_SHIPMENT_ITEM_UNIT_COST,
  loadEnvioEcomConfig,
  maskSecret,
  saveEnvioEcomConfig,
} from "../lib/envioecom-config";
import {
  createEnvioEcomClientForAccount,
  createEnvioEcomExtraAccount,
  deleteEnvioEcomAccount,
  getEnvioEcomAccountNameMap,
  hasAnyEnvioEcomAccount,
  isEnvioEcomAccountConfigured,
  listEnvioEcomAccounts,
  orderEnvioEcomAccountsForFallback,
  pickWriteEnvioEcomAccount,
  toPublicEnvioEcomAccount,
  updateEnvioEcomAccount,
  type EnvioEcomAccountAuth,
} from "../lib/envioecom-accounts";
import { EnvioEcomApiError, type EnvioEcomClient } from "../lib/envioecom-client";
import {
  buildConsolidatedQuotePackage,
  buildGenericShipmentItem,
  formatDimension,
  formatMoney,
  formatWeight,
} from "../lib/envioecom-package";
import { isLabelBlockedStatus, isProvisionalBarcode, isUsableLabelBarcode, classifyEnvioEcomTrackingGroup, isOpenEnvioEcomTrackingStatus, resolveStatusAfterLabelGenerated, trackingEventsNewestFirst, trackingHistoryMissingLocation } from "../lib/envioecom-status";
import {
  buildNextExternalOrderNumber,
  detachEnvioEcomShipment,
  digitsOnly,
  findOrderForEnvioEcomWebhook,
  isDuplicateOrderIdError,
  parseCreatedShipment,
  parseShipmentDetails,
  persistEnvioEcomShipment,
  parseEnvioEcomLinkRef,
  describeEnvioEcomRecipientIssues,
  sanitizeDocument,
  sanitizeUf,
  shipmentEventMatchesOrder,
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
    console.warn("[EnvioEcom]", {
      code: err.code,
      message: err.message,
      httpStatus: err.httpStatus,
      details: err.details,
    });
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

function rejectNoAccounts(res: Response) {
  res.status(503).json({
    error: "ENVIOECOM_NOT_CONFIGURED",
    message: "Cadastre uma API EnvioEcom em Configurações.",
  });
}

async function withEnvioEcomAccount(
  tenantId: string,
  accountId: string | undefined,
  res: Response,
): Promise<{ client: EnvioEcomClient; account: EnvioEcomAccountAuth } | null> {
  const picked = pickWriteEnvioEcomAccount(await listEnvioEcomAccounts(tenantId), accountId);
  if ("error" in picked && picked.error === "NONE") {
    rejectNoAccounts(res);
    return null;
  }
  if ("error" in picked) {
    res.status(404).json({ error: "NOT_FOUND", message: "Conta EnvioEcom não encontrada." });
    return null;
  }
  return {
    client: createEnvioEcomClientForAccount(tenantId, picked.account),
    account: picked.account,
  };
}

function isFallbackMiss(err: unknown): boolean {
  if (!(err instanceof EnvioEcomApiError)) return false;
  return err.httpStatus === 404
    || err.httpStatus === 400
    || err.httpStatus === 401
    || err.httpStatus === 403
    || err.code === "SHIPMENT_NOT_FOUND";
}

async function withEnvioEcomAccountFallback<T>(
  tenantId: string,
  preferredId: string | null | undefined,
  res: Response,
  fn: (client: EnvioEcomClient, account: EnvioEcomAccountAuth) => Promise<T>,
  isFound: (result: T) => boolean,
): Promise<{ result: T; account: EnvioEcomAccountAuth } | null> {
  const ordered = orderEnvioEcomAccountsForFallback(await listEnvioEcomAccounts(tenantId), preferredId);
  if (!ordered.length) {
    rejectNoAccounts(res);
    return null;
  }
  let lastError: unknown = null;
  let lastHit: { result: T; account: EnvioEcomAccountAuth } | null = null;
  for (const account of ordered) {
    try {
      const result = await fn(createEnvioEcomClientForAccount(tenantId, account), account);
      lastHit = { result, account };
      if (isFound(result)) return lastHit;
    } catch (err) {
      lastError = err;
      if (isFallbackMiss(err)) continue;
      throw err;
    }
  }
  if (lastHit) return lastHit;
  if (lastError) throw lastError;
  return null;
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

function mapEnvioEcomOrder(
  order: typeof ordersTable.$inferSelect,
  extra?: { accountName?: string | null },
) {
  const events = trackingEventsNewestFirst(order.envioecomStatusHistory, 80);
  const accountId = order.envioecomAccountId ?? null;
  return {
    id: order.id,
    orderNumber: order.orderNumber ?? null,
    clientName: order.clientName,
    clientPhone: order.clientPhone ?? null,
    sellerCode: order.sellerCode ?? null,
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
    events,
    lastEvents: events.slice(0, 5),
    envioecomLabelUrl: order.envioecomLabelUrl ?? null,
    envioecomFreightCost: order.envioecomFreightCost != null ? Number(order.envioecomFreightCost) : null,
    envioecomExternalOrderNumber: order.envioecomExternalOrderNumber ?? null,
    envioecomAccountId: accountId,
    envioecomAccountName: extra?.accountName || null,
    trackingGroup: classifyEnvioEcomTrackingGroup(order.envioecomStatus),
  };
}

function requireEnvioEcomBoardAdmin(req: Request, res: Response): { tenantId: string; sellerCode: string | null; hasGlobalAccess: boolean } | null {
  const scope = getAdminScope(req);
  if (!scope) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return null;
  }
  if (!scope.hasGlobalAccess && !scope.sellerCode) {
    res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para ver rastreios EnvioEcom." });
    return null;
  }
  return {
    tenantId: scope.tenantId || DEFAULT_TENANT_ID,
    sellerCode: scope.sellerCode,
    hasGlobalAccess: scope.hasGlobalAccess,
  };
}

function matchesTrackingQuery(order: ReturnType<typeof mapEnvioEcomOrder>, q: string): boolean {
  if (!q) return true;
  const hay = [
    order.id,
    order.orderNumber,
    order.clientName,
    order.clientPhone,
    order.envioecomBarcode,
    order.trackingCode,
    order.envioecomStatus,
    order.envioecomDeliveryMode,
    order.envioecomShipmentId,
    order.envioecomExternalOrderNumber,
    order.envioecomAccountName,
    order.envioecomAccountId,
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

async function persistShipmentForAccount(
  order: typeof ordersTable.$inferSelect,
  patch: Parameters<typeof persistEnvioEcomShipment>[1],
  account?: EnvioEcomAccountAuth,
) {
  return persistEnvioEcomShipment(order, {
    ...patch,
    accountId: account?.accountId || patch.accountId || order.envioecomAccountId,
  });
}

async function refreshShipment(
  client: EnvioEcomClient,
  order: typeof ordersTable.$inferSelect,
  account?: EnvioEcomAccountAuth,
) {
  const details = await resolveLiveShipmentRefs(client, order, {});
  if (!details) return order;
  return persistShipmentForAccount(order, parseShipmentDetails(details), account);
}

async function softRefreshOrderWithFallback(tenantId: string, order: typeof ordersTable.$inferSelect) {
  const ordered = orderEnvioEcomAccountsForFallback(await listEnvioEcomAccounts(tenantId), order.envioecomAccountId);
  for (const account of ordered) {
    try {
      const details = await resolveLiveShipmentRefs(createEnvioEcomClientForAccount(tenantId, account), order, {});
      if (details) return persistShipmentForAccount(order, parseShipmentDetails(details), account);
    } catch (err) {
      if (isFallbackMiss(err)) continue;
      throw err;
    }
  }
  return order;
}

function firstShipmentFromList(payload: unknown): unknown | null {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : root;
  const candidates = [root.data, root.shipments, root.results, root.items, nested.shipments, nested.results, nested.items, nested.data];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const active = candidate.find((row) => !isLabelBlockedStatus(parseShipmentDetails(row).status));
    if (active) return active;
  }
  if (root.id || root.shipment_id || nested.id || nested.shipment_id) {
    return isLabelBlockedStatus(parseShipmentDetails(payload).status) ? null : payload;
  }
  return null;
}

async function tryEnvioEcomLookup(fn: () => Promise<unknown>): Promise<unknown | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof EnvioEcomApiError && (err.httpStatus === 404 || err.httpStatus === 400)) return null;
    throw err;
  }
}

async function lookupShipmentByRecipient(client: EnvioEcomClient, order: typeof ordersTable.$inferSelect): Promise<unknown | null> {
  const document = digitsOnly(order.clientDocument);
  const cep = digitsOnly(order.addressCep);
  const name = String(order.clientName || "").trim();
  const listParams: Record<string, string> = {};
  if (document) listParams.document_number = document;
  if (cep) listParams.zipcode = cep;
  if (name) listParams.receiver_name = name;
  if (Object.keys(listParams).length === 0) return null;
  const listed = await tryEnvioEcomLookup(() => client.list(listParams));
  return firstShipmentFromList(listed);
}

async function resolveLiveShipmentRefs(
  client: EnvioEcomClient,
  order: typeof ordersTable.$inferSelect,
  input: { shipmentId?: number; barcode?: string },
): Promise<unknown | null> {
  const explicitId = input.shipmentId && input.shipmentId > 0 ? input.shipmentId : undefined;
  const explicitBarcode = String(input.barcode || "").trim();
  const shipmentId = explicitId || Number(order.envioecomShipmentId || 0) || undefined;
  const barcode = explicitBarcode || String(order.envioecomBarcode || order.trackingCode || "").trim();
  const hadExplicit = Boolean(explicitId || explicitBarcode);

  if (shipmentId) {
    const byId = await tryEnvioEcomLookup(() => client.getById(shipmentId));
    if (byId) return byId;
  }

  if (barcode && !isProvisionalBarcode(barcode)) {
    const byCode = await tryEnvioEcomLookup(() => client.getByIdentifier(barcode));
    if (byCode) return byCode;
  }

  if (hadExplicit && explicitBarcode && /^\d+$/.test(explicitBarcode)) {
    const asId = Number(explicitBarcode);
    if (Number.isFinite(asId) && asId > 0 && asId !== shipmentId) {
      const byId = await tryEnvioEcomLookup(() => client.getById(asId));
      if (byId) return byId;
    }
  }

  if (hadExplicit) {
    const listed = await lookupShipmentByRecipient(client, order);
    if (listed) return listed;
    throw new EnvioEcomApiError(
      "SHIPMENT_NOT_FOUND",
      "Não encontramos esse envio na EnvioEcom. Confira o ID ou o código de rastreio.",
      404,
    );
  }

  if (!shipmentId && !(barcode && !isProvisionalBarcode(barcode))) {
    return null;
  }

  throw new EnvioEcomApiError(
    "SHIPMENT_NOT_FOUND",
    "Não encontramos esse envio na EnvioEcom. Confira o ID ou o código de rastreio.",
    404,
  );
}

router.get("/admin/envioecom/status", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const config = await loadEnvioEcomConfig(admin.tenantId);
    const accounts = (await listEnvioEcomAccounts(admin.tenantId)).map(toPublicEnvioEcomAccount);
    res.json({
      configured: accounts.some((account) => account.configured),
      hasToken: !!config.token,
      tokenMasked: maskSecret(config.token),
      hasEmail: !!config.email,
      originCep: config.originCep || null,
      carriers: config.carriers,
      defaults: config.defaults,
      accounts,
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
    const accounts = (await listEnvioEcomAccounts(admin.tenantId)).map(toPublicEnvioEcomAccount);
    res.json({
      configured: accounts.some((account) => account.configured),
      tokenMasked: maskSecret(config.token),
      emailMasked: accounts.find((account) => account.id === "tenant")?.emailMasked || null,
      originCep: config.originCep || "",
      carriers: config.carriers,
      defaults: config.defaults,
      accounts,
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

router.get("/admin/envioecom/accounts", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const accounts = (await listEnvioEcomAccounts(admin.tenantId)).map(toPublicEnvioEcomAccount);
    res.json({ accounts, configured: accounts.some((account) => account.configured) });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/accounts", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const account = await createEnvioEcomExtraAccount(admin.tenantId, {
      name: body.name == null ? undefined : String(body.name),
      token: body.token == null ? undefined : String(body.token),
      email: body.email == null ? undefined : String(body.email),
      password: body.password == null ? undefined : String(body.password),
      originCep: body.originCep == null ? undefined : String(body.originCep),
    });
    res.status(201).json({ ok: true, account: toPublicEnvioEcomAccount(account) });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.put("/admin/envioecom/accounts/:id", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const account = await updateEnvioEcomAccount(admin.tenantId, String(req.params.id), {
      name: body.name === undefined ? undefined : String(body.name ?? ""),
      token: body.token === undefined ? undefined : String(body.token ?? ""),
      email: body.email === undefined ? undefined : String(body.email ?? ""),
      password: body.password === undefined ? undefined : String(body.password ?? ""),
      originCep: body.originCep === undefined ? undefined : String(body.originCep ?? ""),
    });
    res.json({ ok: true, account: toPublicEnvioEcomAccount(account) });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.delete("/admin/envioecom/accounts/:id", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    await deleteEnvioEcomAccount(admin.tenantId, String(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.get("/admin/envioecom/shipment-item-name", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const config = await loadEnvioEcomConfig(admin.tenantId);
    res.json({
      name: config.shipmentItemName,
      quantity: config.shipmentItemQuantity,
      unitCost: config.shipmentItemUnitCost,
      defaultName: ENVIOECOM_DEFAULT_SHIPMENT_ITEM_NAME,
      defaultQuantity: ENVIOECOM_DEFAULT_SHIPMENT_ITEM_QUANTITY,
      defaultUnitCost: ENVIOECOM_DEFAULT_SHIPMENT_ITEM_UNIT_COST,
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.put("/admin/envioecom/shipment-item-name", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const body = (req.body || {}) as { name?: string; quantity?: string | number; unitCost?: string | number };
    await saveEnvioEcomConfig(admin.tenantId, {
      shipmentItemName: String(body.name ?? ""),
      shipmentItemQuantity: body.quantity,
      shipmentItemUnitCost: body.unitCost,
    });
    const config = await loadEnvioEcomConfig(admin.tenantId);
    res.json({
      ok: true,
      name: config.shipmentItemName,
      quantity: config.shipmentItemQuantity,
      unitCost: config.shipmentItemUnitCost,
      defaultName: ENVIOECOM_DEFAULT_SHIPMENT_ITEM_NAME,
      defaultQuantity: ENVIOECOM_DEFAULT_SHIPMENT_ITEM_QUANTITY,
      defaultUnitCost: ENVIOECOM_DEFAULT_SHIPMENT_ITEM_UNIT_COST,
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.get("/admin/envioecom/webhook", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const accounts = (await listEnvioEcomAccounts(admin.tenantId)).filter(isEnvioEcomAccountConfigured);
    const suggestedUrl = publicWebhookUrl(req);
    if (!accounts.length) {
      res.json({ url: null, enabled: false, suggestedUrl, accounts: [] });
      return;
    }
    const perAccount = [];
    for (const account of accounts) {
      try {
        const current = await createEnvioEcomClientForAccount(admin.tenantId, account).getWebhook();
        perAccount.push({
          id: account.accountId,
          name: account.name,
          url: current.url ?? null,
          enabled: !!current.enabled,
        });
      } catch (err) {
        perAccount.push({
          id: account.accountId,
          name: account.name,
          url: null,
          enabled: false,
          error: err instanceof EnvioEcomApiError ? err.message : "Falha ao ler webhook.",
        });
      }
    }
    const first = perAccount.find((row) => row.url) || perAccount[0];
    res.json({
      url: first?.url ?? null,
      enabled: !!first?.enabled,
      suggestedUrl,
      accounts: perAccount,
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/webhook", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomAdmin(req, res);
    if (!admin) return;
    const accounts = (await listEnvioEcomAccounts(admin.tenantId)).filter(isEnvioEcomAccountConfigured);
    if (!accounts.length) {
      rejectNoAccounts(res);
      return;
    }
    const url = String((req.body as { url?: string })?.url || publicWebhookUrl(req)).trim();
    const registered = [];
    let lastMessage: string | undefined;
    for (const account of accounts) {
      try {
        const saved = await createEnvioEcomClientForAccount(admin.tenantId, account).setWebhook({ url, enabled: true });
        lastMessage = saved.message;
        registered.push({
          id: account.accountId,
          name: account.name,
          ok: true,
          url: saved.url ?? url,
        });
      } catch (err) {
        registered.push({
          id: account.accountId,
          name: account.name,
          ok: false,
          error: err instanceof EnvioEcomApiError ? err.message : "Falha ao registrar webhook.",
        });
      }
    }
    const okCount = registered.filter((row) => row.ok).length;
    if (!okCount) {
      res.status(400).json({ error: "WEBHOOK_FAILED", message: "Não foi possível registrar o webhook em nenhuma conta.", accounts: registered });
      return;
    }
    res.json({
      ok: true,
      url,
      enabled: true,
      message: lastMessage,
      registered: okCount,
      accounts: registered,
    });
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
    const body = (req.body || {}) as { carriers?: string[]; accountId?: string };
    const scoped = await withEnvioEcomAccount(admin.tenantId, body.accountId, res);
    if (!scoped) return;
    const packed = buildConsolidatedQuotePackage({ products: order.products, defaults: config.defaults });
    const carriersFilter = Array.isArray(body.carriers) ? body.carriers : config.carriers;
    const payload: Record<string, unknown> = {
      postal_code_destination: destination,
      aviso_recebimento: false,
      products: [packed.product],
    };
    if (scoped.account.originCep.length === 8) payload.postal_code_origin = scoped.account.originCep;
    if (carriersFilter.length) payload.carriers = carriersFilter;
    const quoted = await scoped.client.quote(payload);
    res.json({
      originZipcode: quoted.origin_zipcode || quoted.origin_zip || scoped.account.originCep,
      destinationZipcode: quoted.destination_zipcode || destination,
      quotes: quoted.quotes || [],
      unavailableCarriers: quoted.unavailable_carriers || [],
      package: packed.product,
      accountId: scoped.account.accountId,
      accountName: scoped.account.name,
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
      accountId?: string;
    };
    const shippingCompany = String(body.shippingCompany || "").trim();
    if (!shippingCompany) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe a transportadora exatamente como na cotação." });
      return;
    }
    const scoped = await withEnvioEcomAccount(admin.tenantId, body.accountId, res);
    if (!scoped) return;
    const config = await loadEnvioEcomConfig(admin.tenantId);
    const originCep = digitsOnly(body.originCep || scoped.account.originCep);
    if (originCep.length !== 8) {
      res.status(400).json({ error: "ORIGIN_CEP_REQUIRED", message: "CEP de origem obrigatório. Configure na conta EnvioEcom." });
      return;
    }
    const destination = digitsOnly(order.addressCep);
    if (destination.length !== 8) {
      res.status(400).json({ error: "INVALID_CEP", message: "CEP de destino inválido no pedido." });
      return;
    }
    const recipientIssue = describeEnvioEcomRecipientIssues(order);
    if (recipientIssue) {
      res.status(400).json({ error: "INVALID_RECIPIENT", message: recipientIssue });
      return;
    }
    let workingOrder = order;
    if (isLabelBlockedStatus(order.envioecomStatus)) {
      workingOrder = await detachEnvioEcomShipment(order, order.envioecomStatus);
    }
    const packed = buildConsolidatedQuotePackage({ products: workingOrder.products, defaults: config.defaults });
    const labelItem = buildGenericShipmentItem({
      name: config.shipmentItemName,
      quantity: config.shipmentItemQuantity,
      unitCost: config.shipmentItemUnitCost,
      fallbackUnitCost: packed.declaredValue,
    });
    const shipmentFields = {
        shipping_company: shippingCompany,
        cep_origem: originCep,
        cep_destino: destination,
        freight_cost: formatMoney(Number(body.freightCost || 0)),
        delivery_time: String(body.deliveryTime || "1"),
        height: formatDimension(Number(body.height || packed.product.height)),
        width: formatDimension(Number(body.width || packed.product.width)),
        length: formatDimension(Number(body.length || packed.product.length)),
        weight: formatWeight(Number(body.weight || packed.product.weight)),
        cost: formatMoney(labelItem.declaredCost),
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
        items: labelItem.items,
    };
    let externalOrderNumber = buildNextExternalOrderNumber(workingOrder);
    let created: Awaited<ReturnType<typeof scoped.client.create>> | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        created = await scoped.client.create({
          defer_payment: false,
          shipments: [{ orderId: externalOrderNumber, ...shipmentFields }],
        });
        break;
      } catch (err) {
        if (err instanceof EnvioEcomApiError && isDuplicateOrderIdError(err) && attempt < 2) {
          externalOrderNumber = buildNextExternalOrderNumber({
            ...workingOrder,
            envioecomShipmentId: null,
            envioecomExternalOrderNumber: null,
            envioecomStatusHistory: [{ at: new Date().toISOString(), status: "retry" }],
          });
          continue;
        }
        throw err;
      }
    }
    if (!created) {
      throw new EnvioEcomApiError("CREATE_FAILED", "Não foi possível criar o envio na EnvioEcom.", 502);
    }

    let persisted = await persistShipmentForAccount(workingOrder, {
      ...parseCreatedShipment(created),
      deliveryMode: shippingCompany,
      externalOrderNumber,
    }, scoped.account);
    try {
      persisted = await refreshShipment(scoped.client, persisted, scoped.account);
    } catch (err) {
      console.warn("[EnvioEcom] Sync pós-create falhou:", err);
    }
    await addOrderEvent({
      orderId: order.id,
      tenantId: admin.tenantId,
      action: "ee_created",
      ...actorFromAdminRequest(req),
      payload: {
        barcode: persisted.envioecomBarcode || persisted.trackingCode || null,
        carrier: persisted.envioecomDeliveryMode || shippingCompany,
        shipmentId: persisted.envioecomShipmentId ?? null,
      },
    });
    res.json({
      ok: true,
      order: mapEnvioEcomOrder(persisted, { accountName: scoped.account.name }),
      accountId: scoped.account.accountId,
      accountName: scoped.account.name,
      raw: created,
    });
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
    const body = (req.body || {}) as { shipmentId?: number; accountId?: string };
    const shipmentId = Number(body.shipmentId);
    if (!Number.isFinite(shipmentId) || shipmentId <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe o ID numérico do envio no painel EnvioEcom." });
      return;
    }
    const preferred = String(body.accountId || order.envioecomAccountId || "").trim() || undefined;
    const found = await withEnvioEcomAccountFallback(
      admin.tenantId,
      preferred,
      res,
      async (client) => tryEnvioEcomLookup(() => client.getById(shipmentId)),
      (details) => !!details,
    );
    if (!found) return;
    if (!found.result) {
      res.status(404).json({ error: "SHIPMENT_NOT_FOUND", message: "Não encontramos esse envio na EnvioEcom." });
      return;
    }
    const persisted = await persistShipmentForAccount(order, parseShipmentDetails(found.result), found.account);
    await addOrderEvent({
      orderId: order.id,
      tenantId: admin.tenantId,
      action: "ee_bound",
      ...actorFromAdminRequest(req),
      payload: {
        barcode: persisted.envioecomBarcode || persisted.trackingCode || null,
        carrier: persisted.envioecomDeliveryMode || null,
        shipmentId: persisted.envioecomShipmentId ?? shipmentId,
      },
    });
    res.json({ ok: true, order: mapEnvioEcomOrder(persisted, { accountName: found.account.name }), accountId: found.account.accountId });
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
    if (isLabelBlockedStatus(order.envioecomStatus)) {
      res.status(400).json({
        error: "LABEL_BLOCKED",
        message: `Não é possível gerar etiqueta com status "${order.envioecomStatus}". Cote e crie um envio novo.`,
      });
      return;
    }
    const requestedId = Number((req.body as { shipmentId?: number; accountId?: string })?.shipmentId);
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
    if (!isR2Configured()) {
      res.status(503).json({
        error: "R2_NOT_CONFIGURED",
        message: "Cloudflare R2 não está configurado no servidor.",
        missing: getR2MissingConfig(),
      });
      return;
    }
    const payload = shipmentId
      ? { ids: [Number(shipmentId)] }
      : { barcodes: [String(order.envioecomBarcode || order.trackingCode)] };
    const preferred = String((req.body as { accountId?: string })?.accountId || order.envioecomAccountId || "").trim() || undefined;
    const found = await withEnvioEcomAccountFallback(
      admin.tenantId,
      preferred,
      res,
      async (client) => client.generateLabels(payload),
      (result) => result.kind === "pdf",
    );
    if (!found) return;
    const result = found.result;
    if (result.kind !== "pdf") {
      const code = String((result.json as { error?: { code?: string } } | null)?.error?.code || "LABEL_PROCESSING");
      res.status(202).json({
        error: code,
        message: "Etiqueta ainda em processamento. Tente novamente em instantes.",
        details: result.json,
        accountId: found.account.accountId,
      });
      return;
    }
    const labelUrl = await uploadShipmentLabelPdfToR2({ buffer: result.buffer, orderId: order.id });
    const persisted = await persistShipmentForAccount(order, {
      shipmentId: shipmentId || order.envioecomShipmentId,
      barcode: isUsableLabelBarcode(order.envioecomBarcode) ? order.envioecomBarcode : order.trackingCode,
      labelUrl,
      status: resolveStatusAfterLabelGenerated(order.envioecomStatus),
    }, found.account);
    await addOrderEvent({
      orderId: order.id,
      tenantId: admin.tenantId,
      action: "ee_label",
      ...actorFromAdminRequest(req),
      payload: {
        barcode: persisted.envioecomBarcode || persisted.trackingCode || null,
        carrier: persisted.envioecomDeliveryMode || null,
        shipmentId: persisted.envioecomShipmentId ?? shipmentId ?? null,
      },
    });
    res.json({
      ok: true,
      labelUrl,
      order: mapEnvioEcomOrder(persisted, { accountName: found.account.name }),
      accountId: found.account.accountId,
    });
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
    const body = (req.body || {}) as {
      shipment_id?: number | string;
      shipmentId?: number | string;
      barcode?: string;
      ref?: string;
      accountId?: string;
    };
    const parsed = parseEnvioEcomLinkRef(body.ref);
    const shipmentIdRaw = Number(body.shipment_id || body.shipmentId || parsed.shipmentId);
    const shipmentId = Number.isFinite(shipmentIdRaw) && shipmentIdRaw > 0 ? Math.trunc(shipmentIdRaw) : undefined;
    const barcode = String(body.barcode || parsed.barcode || "").trim() || undefined;
    const preferred = String(body.accountId || order.envioecomAccountId || "").trim() || undefined;

    const found = await withEnvioEcomAccountFallback(
      admin.tenantId,
      preferred,
      res,
      async (client) => resolveLiveShipmentRefs(client, order, { shipmentId, barcode }),
      (details) => !!details,
    );
    if (!found) return;
    if (!found.result) {
      res.json({ ok: true, order: mapEnvioEcomOrder(order), resolved: false });
      return;
    }
    const persisted = await persistShipmentForAccount(order, parseShipmentDetails(found.result), found.account);
    res.json({
      ok: true,
      order: mapEnvioEcomOrder(persisted, { accountName: found.account.name }),
      resolved: true,
      accountId: found.account.accountId,
      tracking: {
        shipmentId: persisted.envioecomShipmentId ?? null,
        barcode: persisted.envioecomBarcode ?? persisted.trackingCode ?? null,
        status: persisted.envioecomStatus ?? null,
      },
    });
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
    const hasBinding = Boolean(
      identifier
      || order.envioecomExternalOrderNumber
      || order.envioecomLabelUrl
      || order.envioecomStatus,
    );
    if (!hasBinding) {
      res.status(400).json({ error: "NO_SHIPMENT", message: "Este pedido ainda não tem envio EnvioEcom." });
      return;
    }
    const reason = String((req.body as { reason?: string; accountId?: string })?.reason || "").trim();
    const preferred = String((req.body as { accountId?: string })?.accountId || order.envioecomAccountId || "").trim() || undefined;
    let cancelResult: { status?: unknown; message?: unknown; auto_cancelled?: unknown } = {};
    let cancelAccountName: string | null = null;
    let cancelAccountId: string | null = null;
    if (identifier) {
      try {
        const found = await withEnvioEcomAccountFallback(
          admin.tenantId,
          preferred,
          res,
          async (client) => client.cancel(identifier, reason || undefined),
          () => true,
        );
        if (!found) return;
        cancelResult = found.result as { status?: unknown; message?: unknown; auto_cancelled?: unknown };
        cancelAccountName = found.account.name;
        cancelAccountId = found.account.accountId;
      } catch (err) {
        console.warn("[EnvioEcom] Cancel na API falhou; pedido será desvinculado mesmo assim:", err);
      }
    }
    const cancelStatus = String(cancelResult.status || "").trim() || null;
    const persisted = await detachEnvioEcomShipment(order, cancelStatus);
    await addOrderEvent({
      orderId: order.id,
      tenantId: admin.tenantId,
      action: "ee_cancelled",
      ...actorFromAdminRequest(req),
      payload: {
        barcode: order.envioecomBarcode || order.trackingCode || null,
        shipmentId: order.envioecomShipmentId ?? null,
        cancelStatus,
      },
    });
    res.json({
      ok: true,
      detached: true,
      autoCancelled: !!cancelResult.auto_cancelled,
      message: String(cancelResult.message || "Cancelamento pedido na EnvioEcom. Pedido liberado para cotar de novo."),
      order: mapEnvioEcomOrder(persisted, { accountName: cancelAccountName }),
      accountId: cancelAccountId,
    });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.get("/admin/envioecom/tracking-board", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomBoardAdmin(req, res);
    if (!admin) return;
    const q = String((req.query as { q?: string }).q || "").trim().toLowerCase();
    const group = String((req.query as { group?: string }).group || "all").trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Number((req.query as { limit?: string }).limit) || 200));
    const conditions = [
      buildOrderTenantWhere(admin.tenantId),
      or(
        isNotNull(ordersTable.envioecomShipmentId),
        isNotNull(ordersTable.envioecomBarcode),
        isNotNull(ordersTable.envioecomStatus),
      ),
    ];
    if (!admin.hasGlobalAccess && admin.sellerCode) {
      conditions.push(eq(ordersTable.sellerCode, admin.sellerCode));
    }
    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(...conditions))
      .orderBy(desc(ordersTable.envioecomStatusUpdatedAt), desc(ordersTable.updatedAt))
      .limit(500);
    const names = await getEnvioEcomAccountNameMap(admin.tenantId);
    const mapped = rows.map((order) => mapEnvioEcomOrder(order, {
      accountName: order.envioecomAccountId ? names[order.envioecomAccountId] || null : null,
    })).filter((order) => matchesTrackingQuery(order, q));
    const summary = {
      total: mapped.length,
      in_transit: mapped.filter((order) => order.trackingGroup === "in_transit").length,
      awaiting: mapped.filter((order) => order.trackingGroup === "awaiting").length,
      delivered: mapped.filter((order) => order.trackingGroup === "delivered").length,
      cancelled: mapped.filter((order) => order.trackingGroup === "cancelled").length,
      other: mapped.filter((order) => order.trackingGroup === "other").length,
    };
    const items = (group && group !== "all" ? mapped.filter((order) => order.trackingGroup === group) : mapped).slice(0, limit);
    res.json({ summary, items, configured: await hasAnyEnvioEcomAccount(admin.tenantId) });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

router.post("/admin/envioecom/tracking-board/sync", requireAdminAuth, async (req, res) => {
  try {
    const admin = requireEnvioEcomBoardAdmin(req, res);
    if (!admin) return;
    const body = req.body as { orderIds?: string[]; limit?: number };
    const requestedIds = Array.isArray(body?.orderIds) ? body.orderIds.map(String).filter(Boolean) : [];
    const limit = Math.min(30, Math.max(1, Number(body?.limit) || 20));
    const scopeConditions = [buildOrderTenantWhere(admin.tenantId)];
    if (!admin.hasGlobalAccess && admin.sellerCode) {
      scopeConditions.push(eq(ordersTable.sellerCode, admin.sellerCode));
    }
    if (!(await hasAnyEnvioEcomAccount(admin.tenantId))) {
      rejectNoAccounts(res);
      return;
    }
    const rows = requestedIds.length
      ? await db.select().from(ordersTable).where(and(...scopeConditions, inArray(ordersTable.id, requestedIds.slice(0, limit))))
      : await db
          .select()
          .from(ordersTable)
          .where(and(
            ...scopeConditions,
            or(isNotNull(ordersTable.envioecomShipmentId), isNotNull(ordersTable.envioecomBarcode)),
          ))
          .orderBy(desc(ordersTable.envioecomStatusUpdatedAt), desc(ordersTable.updatedAt))
          .limit(80);

    const targets = rows.filter((order) => (
      isOpenEnvioEcomTrackingStatus(order.envioecomStatus)
      || trackingHistoryMissingLocation(order.envioecomStatusHistory)
    )).slice(0, limit);
    const names = await getEnvioEcomAccountNameMap(admin.tenantId);
    const synced = [];
    for (const order of targets) {
      try {
        const updated = await softRefreshOrderWithFallback(admin.tenantId, order);
        synced.push(mapEnvioEcomOrder(updated, {
          accountName: updated.envioecomAccountId ? names[updated.envioecomAccountId] || null : null,
        }));
      } catch (err) {
        console.warn("[EnvioEcom] sync lote falhou", order.id, err);
      }
    }
    res.json({ ok: true, synced: synced.length, orders: synced });
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
    if (order.envioecomShipmentId || isUsableLabelBarcode(order.envioecomBarcode || order.trackingCode)) {
      try {
        current = await softRefreshOrderWithFallback(tenantId, order);
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

router.post("/me/orders/tracking-sync", requireCustomerAuth, async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req as never);
    const session = getCustomerSession(req);
    if (!session) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const limit = Math.min(10, Math.max(1, Number((req.body as { limit?: number })?.limit) || 8));
    const configured = await hasAnyEnvioEcomAccount(tenantId);
    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(
        buildOrderTenantWhere(tenantId),
        eq(ordersTable.userId, session.userId),
        or(isNotNull(ordersTable.envioecomShipmentId), isNotNull(ordersTable.envioecomBarcode)),
      ))
      .orderBy(desc(ordersTable.envioecomStatusUpdatedAt), desc(ordersTable.updatedAt))
      .limit(40);

    const targets = rows.filter((order) => (
      isOpenEnvioEcomTrackingStatus(order.envioecomStatus)
      || trackingHistoryMissingLocation(order.envioecomStatusHistory)
    )).slice(0, limit);
    if (!configured || !targets.length) {
      res.json({
        ok: true,
        synced: 0,
        orders: targets.map((order) => ({
          id: order.id,
          enviado: !!order.enviado,
          status: order.status,
          envioecomStatus: order.envioecomStatus ?? null,
          envioecomDeliveryMode: order.envioecomDeliveryMode ?? null,
          envioecomBarcode: order.envioecomBarcode || order.trackingCode || null,
          trackingCode: order.trackingCode ?? null,
          envioecomStatusHistory: order.envioecomStatusHistory ?? [],
        })),
      });
      return;
    }

    const synced = [];
    for (const order of targets) {
      try {
        const current = await softRefreshOrderWithFallback(tenantId, order);
        synced.push({
          id: current.id,
          enviado: !!current.enviado,
          status: current.status,
          envioecomStatus: current.envioecomStatus ?? null,
          envioecomDeliveryMode: current.envioecomDeliveryMode ?? null,
          envioecomBarcode: current.envioecomBarcode || current.trackingCode || null,
          trackingCode: current.trackingCode ?? null,
          envioecomStatusHistory: current.envioecomStatusHistory ?? [],
        });
      } catch (err) {
        console.warn("[EnvioEcom] tracking-sync cliente falhou", order.id, err);
      }
    }
    res.json({ ok: true, synced: synced.length, orders: synced });
  } catch (err) {
    sendEnvioEcomError(res, err);
  }
});

function asWebhookRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function applyEnvioEcomWebhook(body: Record<string, unknown>): Promise<{ matched: boolean; orderId?: string }> {
  const nested = { ...asWebhookRecord(body.shipment), ...asWebhookRecord(body.data) };
  const merged = { ...body, ...nested };
  const patch = parseShipmentDetails(merged);
  const barcode = patch.barcode || String(merged.barcode || "").trim() || null;
  const externalOrderNumber = patch.externalOrderNumber || String(merged.external_order_number || merged.orderId || "").trim() || null;
  const shipmentId = patch.shipmentId || Number(merged.shipment_id || merged.id);
  const order = await findOrderForEnvioEcomWebhook({
    barcode,
    externalOrderNumber,
    shipmentId: Number.isFinite(shipmentId) && shipmentId > 0 ? shipmentId : null,
  });
  if (!order || !shipmentEventMatchesOrder(order, {
    barcode,
    shipmentId: Number.isFinite(shipmentId) && shipmentId > 0 ? shipmentId : null,
    externalOrderNumber,
  })) return { matched: false };

  await persistEnvioEcomShipment(order, {
    shipmentId: Number.isFinite(shipmentId) && shipmentId > 0 ? shipmentId : null,
    barcode,
    trackingKey: patch.trackingKey || String(merged.tracking_key || "").trim() || null,
    deliveryMode: patch.deliveryMode || String(merged.delivery_mode || "").trim() || null,
    status: patch.status || String(merged.status || merged.situacao || "").trim() || null,
    freightCost: patch.freightCost ?? (merged.freight_cost != null ? String(merged.freight_cost) : null),
    externalOrderNumber,
    description: String(merged.description || "").trim() || null,
    history: patch.history,
  });
  return { matched: true, orderId: order.id };
}

export default router;
