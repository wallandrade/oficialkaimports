import { Router, type IRouter, type Request, type Response } from "express";
import { db, ordersTable, customChargesTable, sellersTable, productsTable, siteSettingsTable, reshipmentsTable, couponsTable, inventoryBalancesTable } from "@workspace/db";
import { desc, and, gte, lte, eq, inArray, isNull, sql } from "drizzle-orm";
import crypto from "crypto";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { broadcastNotification } from "./notifications";
import { evaluateCouponForProducts, incrementCouponUse } from "./coupons";
import {
  createPixCharge,
  buildCallbackUrl,
  genIdentifier,
  PIX_DURATION_MS,
} from "../gateway";
import { getCustomerSession, requireCustomerAuth } from "../middlewares/customer-auth";
import {
  ensureOrderCommission,
  normalizeAffiliateCode,
  registerAffiliateLead,
  resolveAffiliateByCode,
} from "../lib/affiliates";
import { getReshipmentByOrderIds, registerInventoryEntry } from "../lib/reshipments";
import { lookupIpGeo } from "../lib/ip-geo";

const router: IRouter = Router();

type BulkDiscountTierInput = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
};

type OrderProductInput = {
  id: string;
  name?: string;
  quantity: number;
  price: number;
  isBump?: boolean;
};

function parseBulkDiscountTiers(raw: unknown): BulkDiscountTierInput[] {
  if (!raw) return [];

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];

    const tiers = parsed
      .map((tier) => {
        const item = tier as Record<string, unknown>;
        const minQty = Number(item.minQty);
        const maxQtyRaw = item.maxQty;
        const maxQty = maxQtyRaw == null ? null : Number(maxQtyRaw);
        const unitPrice = Number(item.unitPrice);

        if (!Number.isFinite(minQty) || minQty < 1) return null;
        if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) return null;
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

        return { minQty, maxQty, unitPrice };
      })
      .filter((tier): tier is BulkDiscountTierInput => Boolean(tier));

    return tiers.sort((a, b) => a.minQty - b.minQty);
  } catch {
    return [];
  }
}

function isProductUnavailable(product: {
  isActive: boolean;
  isSoldOut: boolean;
  stock: number | null;
}): boolean {
  if (product.isActive === false) return true;
  if (product.isSoldOut === true) return true;
  if (typeof product.stock === "number" && product.stock <= 0) return true;
  return false;
}

function resolveBaseUnitPrice(product: {
  price: string;
  promoPrice: string | null;
  promoEndsAt: Date | null;
}): number {
  const regularPrice = Number(product.price || 0);
  const promoPrice = product.promoPrice == null ? null : Number(product.promoPrice);
  if (!Number.isFinite(promoPrice) || promoPrice == null || promoPrice <= 0) return regularPrice;
  if (product.promoEndsAt && new Date() > product.promoEndsAt) return regularPrice;
  return promoPrice;
}

function resolveUnitPriceForQuantity(product: {
  price: string;
  promoPrice: string | null;
  promoEndsAt: Date | null;
  bulkDiscountEnabled: boolean;
  bulkDiscountTiers: string | null;
}, quantity: number): number {
  const base = resolveBaseUnitPrice(product);
  if (!product.bulkDiscountEnabled) return base;
  const tiers = parseBulkDiscountTiers(product.bulkDiscountTiers);
  if (tiers.length === 0) return base;
  const tier = tiers.find((item) => quantity >= item.minQty && (item.maxQty == null || quantity <= item.maxQty));
  return tier?.unitPrice ?? base;
}

function parseEnabledSetting(value?: string | null): boolean {
  if (value == null || value === "") return true;
  const normalized = String(value).trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

async function isPaymentMethodEnabled(key: "checkout_enable_pix" | "checkout_enable_card"): Promise<boolean> {
  const rows = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  return parseEnabledSetting(rows[0]?.value ?? null);
}

function buildGuestAccessToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function getHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = String(item || "").trim();
      if (text) return text;
    }
    return "";
  }
  return String(value || "").trim();
}

function pickFirstForwardedIp(value: unknown): string {
  const raw = getHeaderValue(value);
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || "";
}

function getPurchaseIp(req: { ip?: string; headers?: Record<string, unknown> }): string | null {
  const headers = req.headers || {};
  const candidates = [
    pickFirstForwardedIp(headers["cf-connecting-ip"]),
    pickFirstForwardedIp(headers["x-real-ip"]),
    pickFirstForwardedIp(headers["x-forwarded-for"]),
    pickFirstForwardedIp(headers["x-client-ip"]),
    pickFirstForwardedIp(headers["x-original-forwarded-for"]),
    pickFirstForwardedIp(headers["fastly-client-ip"]),
    String(req.ip || "").trim(),
  ];

  const ip = candidates.find((candidate) => candidate && candidate.toLowerCase() !== "unknown") || "";
  return ip ? normalizeIp(ip) : null;
}

function normalizeIp(raw?: string | null): string {
  const normalized = String(raw || "")
    .trim()
    .replace(/^::ffff:/, "")
    .replace(/^\[|\]$/g, "");

  const lowered = normalized.toLowerCase();
  if (!normalized || lowered === "ip_nao_encontrado" || lowered === "unknown") {
    return "";
  }

  return normalized;
}

function ensureSellerScopeOnOrderQuery(
  req: Request,
  res: Response,
): { hasGlobalAccess: boolean; sellerCode: string | null } | null {
  const scope = getAdminScope(req);
  if (!scope) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return null;
  }
  if (!scope.hasGlobalAccess && !scope.sellerCode) {
    res.status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
    return null;
  }
  return { hasGlobalAccess: scope.hasGlobalAccess, sellerCode: scope.sellerCode };
}

function buildAdminOrderWhere(orderId: string, scope: { hasGlobalAccess: boolean; sellerCode: string | null }) {
  if (scope.hasGlobalAccess) return eq(ordersTable.id, orderId);
  return and(eq(ordersTable.id, orderId), eq(ordersTable.sellerCode, scope.sellerCode!));
}

function parseOrderItemsForInventory(raw: unknown): Array<{ productId: string | null; productName: string; quantity: number }> {
  const parsed = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const value = JSON.parse(raw);
            return Array.isArray(value) ? value : [];
          } catch {
            return [];
          }
        })()
      : [];

  const items = parsed
    .map((item) => {
      const row = item as { id?: unknown; name?: unknown; quantity?: unknown };
      return {
        productId: String(row?.id || "").trim() || null,
        productName: String(row?.name || "Produto").trim() || "Produto",
        quantity: Number(row?.quantity || 0),
      };
    })
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);

  const grouped = new Map<string, { productId: string | null; productName: string; quantity: number }>();
  for (const item of items) {
    const key = item.productId ? `id:${item.productId}` : `name:${item.productName.toLowerCase()}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      productId: prev?.productId || item.productId,
      productName: prev?.productName || item.productName,
      quantity: (prev?.quantity || 0) + item.quantity,
    });
  }

  return [...grouped.values()];
}

async function attachLegacyGuestOrdersToCustomer(userId: string, email: string): Promise<void> {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!userId || !normalizedEmail) return;

  await db
    .update(ordersTable)
    .set({ userId })
    .where(
      and(
        isNull(ordersTable.userId),
        sql`lower(trim(${ordersTable.clientEmail})) = ${normalizedEmail}`,
      ),
    );
}

// ---------------------------------------------------------------------------
// CSV field escaper — wraps in quotes, escapes internal quotes, strips newlines
// ---------------------------------------------------------------------------
function csvField(value: unknown): string {
  const str = String(value ?? "")
    .replace(/\r?\n/g, " ")   // no newlines inside a field
    .replace(/\r/g, " ");
  // Always wrap in quotes and double any internal quotes
  return `"${str.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// POST /api/orders  — create a new order
// ---------------------------------------------------------------------------
router.post("/orders", async (req, res) => {
  try {
    const purchaseIp = getPurchaseIp(req) || "IP_NAO_ENCONTRADO";
    const customerSession = getCustomerSession(req);
    const guestAccessToken = customerSession ? null : buildGuestAccessToken();

    const {
      client, address, products, shippingType, includeInsurance,
      shippingCost, insuranceAmount,
      paymentMethod, cardInstallments, sellerCode,
    } = req.body;

    const normalizedAffiliateCode = normalizeAffiliateCode(req.body?.affiliateCode);
    const affiliate = normalizedAffiliateCode
      ? await resolveAffiliateByCode(normalizedAffiliateCode)
      : null;
    const affiliateUserId = affiliate?.userId && affiliate.userId !== customerSession?.userId
      ? affiliate.userId
      : null;

    let sellerCommissionRateSnapshot = 0;
    if (sellerCode) {
      const slug = String(sellerCode).toLowerCase();
      const [seller] = await db
        .select({
          hasCommission: sellersTable.hasCommission,
          commissionRate: sellersTable.commissionRate,
        })
        .from(sellersTable)
        .where(eq(sellersTable.slug, slug));
      if (seller?.hasCommission) {
        sellerCommissionRateSnapshot = Number(seller.commissionRate ?? 0);
      }
    }

    if (!client || !products || !shippingType) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Campos obrigatórios ausentes." });
      return;
    }

    const id     = crypto.randomBytes(8).toString("hex");
    const method = paymentMethod || "pix";

    if (method === "pix") {
      const pixEnabled = await isPaymentMethodEnabled("checkout_enable_pix");
      if (!pixEnabled) {
        res.status(403).json({
          error: "PAYMENT_METHOD_DISABLED",
          message: "Pagamento via PIX está temporariamente indisponível.",
        });
        return;
      }
    }

    if (method === "card_simulation") {
      const cardEnabled = await isPaymentMethodEnabled("checkout_enable_card");
      if (!cardEnabled) {
        res.status(403).json({
          error: "PAYMENT_METHOD_DISABLED",
          message: "Pagamento via cartão está temporariamente indisponível.",
        });
        return;
      }
    }

    const productItems = Array.isArray(products) ? (products as OrderProductInput[]) : [];
    if (productItems.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Carrinho vazio." });
      return;
    }

    const productIds = Array.from(new Set(productItems.map((p: { id?: string }) => String(p?.id || "")).filter(Boolean)));
    let productRows = new Map<string, typeof productsTable.$inferSelect>();
    if (productIds.length > 0) {
      const rows = await db.select().from(productsTable).where(inArray(productsTable.id, productIds));
      productRows = new Map(rows.map((row) => [row.id, row]));
    }

    const unavailableProducts: string[] = [];
    const priceChanges: Array<{ id: string; name: string; sentPrice: number; currentPrice: number }> = [];
    const orderProducts = productItems
      .map((item) => {
        const productId = String(item.id || "").trim();
        const quantity = Number(item.quantity) || 0;
        if (!productId || quantity <= 0) return null;

        const current = productRows.get(productId);
        if (!current || isProductUnavailable(current)) {
          unavailableProducts.push(productId);
          return null;
        }

        const sentUnitPrice = Number(item.price) || 0;
        const isBump = item.isBump === true;
        const serverUnitPrice = isBump ? sentUnitPrice : resolveUnitPriceForQuantity(current, quantity);

        if (!isBump && Math.abs(sentUnitPrice - serverUnitPrice) > 0.001) {
          priceChanges.push({
            id: productId,
            name: current.name,
            sentPrice: sentUnitPrice,
            currentPrice: serverUnitPrice,
          });
        }

        return {
          id: productId,
          name: String(item.name || current.name || "Produto"),
          quantity,
          price: serverUnitPrice,
          costPrice: Number(current.costPrice || 0),
        };
      })
      .filter((item): item is { id: string; name: string; quantity: number; price: number; costPrice: number } => Boolean(item));

    if (unavailableProducts.length > 0) {
      res.status(400).json({
        error: "UNAVAILABLE_PRODUCT",
        message: "Um ou mais produtos não estão mais disponíveis.",
      });
      return;
    }

    if (priceChanges.length > 0) {
      res.status(409).json({
        error: "PRICE_CHANGED",
        message: "Os preços do carrinho foram atualizados. Revise e tente novamente.",
        items: priceChanges,
      });
      return;
    }

    const computedSubtotal = orderProducts.reduce((acc: number, p: { quantity?: number; price?: number }) => {
      const qty = Number(p.quantity) || 0;
      const price = Number(p.price) || 0;
      return acc + qty * price;
    }, 0);
    const computedShippingCost = Math.max(0, Number(shippingCost) || 0);
    const computedInsuranceAmount = Math.max(0, Number(insuranceAmount) || 0);
    const computedBaseTotal = computedSubtotal + computedShippingCost + computedInsuranceAmount;

    let normalizedCouponCode: string | null = null;
    let computedDiscountAmount = 0;
    const rawCouponCode = req.body.couponCode ? String(req.body.couponCode).trim().toUpperCase() : "";
    if (rawCouponCode) {
      const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, rawCouponCode));
      if (!coupon) {
        res.status(400).json({ error: "INVALID_COUPON", message: "Cupom não encontrado." });
        return;
      }
      const evaluation = evaluateCouponForProducts(coupon, orderProducts, computedBaseTotal);
      if (!evaluation.valid) {
        res.status(400).json({
          error: evaluation.error || "INVALID_COUPON",
          message: evaluation.message || "Cupom inválido para este carrinho.",
        });
        return;
      }
      normalizedCouponCode = rawCouponCode;
      computedDiscountAmount = evaluation.discountAmount;
    }

    const computedTotal = Math.max(0, computedBaseTotal - computedDiscountAmount);
    if (!computedTotal || computedTotal <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor inválido. Deve ser maior que zero." });
      return;
    }
    if (computedTotal > 10000) {
      res.status(400).json({ error: "INVALID_INPUT", message: "O valor máximo por pedido é R$10.000." });
      return;
    }

    await db.insert(ordersTable).values({
      id,
      userId: customerSession?.userId ?? null,
      guestAccessToken,
      affiliateUserId,
      affiliateCode: affiliateUserId ? normalizedAffiliateCode : null,
      clientName:          client.name,
      clientEmail:         client.email,
      clientPhone:         client.phone,
      clientDocument:      client.document,
      purchaseIp,
      addressCep:          address?.cep          || null,
      addressStreet:       address?.street       || null,
      addressNumber:       address?.number       || null,
      addressComplement:   address?.complement   || null,
      addressNeighborhood: address?.neighborhood || null,
      addressCity:         address?.city         || null,
      addressState:        address?.state        || null,
      products: orderProducts,
      shippingType,
      includeInsurance:  Boolean(includeInsurance),
      subtotal:          String(computedSubtotal),
      shippingCost:      String(computedShippingCost),
      insuranceAmount:   String(computedInsuranceAmount),
      total:             String(computedTotal),
      status:            method === "card_simulation" ? "awaiting_payment" : "pending",
      paymentMethod:     method,
      cardInstallments:  cardInstallments ? Number(cardInstallments) : null,
      sellerCode:        sellerCode ? String(sellerCode) : null,
      sellerCommissionRateSnapshot: String(sellerCommissionRateSnapshot),
      couponCode:        normalizedCouponCode,
      discountAmount:    computedDiscountAmount > 0 ? String(computedDiscountAmount) : null,
    });

    // Geo lookup — fire and forget, não bloqueia a resposta
    lookupIpGeo(purchaseIp).then((geo) => {
      if (!geo) return;
      db.update(ordersTable)
        .set({ ipCity: geo.city, ipRegion: geo.region, ipIsp: geo.isp, ipIsProxy: geo.isProxy })
        .where(eq(ordersTable.id, id))
        .catch(() => {});
    }).catch(() => {});

    if (affiliateUserId) {
      await registerAffiliateLead({
        affiliateUserId,
        referredUserId: customerSession?.userId ?? null,
        referredEmail: client?.email ?? null,
      });
    }

    broadcastNotification({
      type: "new_order",
      data: {
        id,
        clientName: client.name,
        total: computedTotal,
        paymentMethod: method,
        sellerCode: sellerCode || null,
        createdAt: new Date().toISOString(),
      },
    });

    res.status(201).json({
      id, client, address: address || null, products: orderProducts, shippingType,
      includeInsurance: Boolean(includeInsurance),
      subtotal: computedSubtotal,
      shippingCost: computedShippingCost,
      insuranceAmount: computedInsuranceAmount,
      total: computedTotal,
      status:        method === "card_simulation" ? "awaiting_payment" : "pending",
      paymentMethod: method,
      sellerCode:    sellerCode || null,
      affiliateCode: affiliateUserId ? normalizedAffiliateCode : null,
      guestAccessToken,
      isGuestOrder: !customerSession,
      createdAt:     new Date().toISOString(),
    });
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar pedido. Tente novamente." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/me/orders  (protected customer route)
// ---------------------------------------------------------------------------
router.get("/me/orders", requireCustomerAuth, async (req, res) => {
  try {
    const customerSession = getCustomerSession(req);
    if (!customerSession) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    await attachLegacyGuestOrdersToCustomer(customerSession.userId, customerSession.email);

    const orders = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.userId, customerSession.userId))
      .orderBy(desc(ordersTable.createdAt));

    res.json({ orders: orders.map(mapOrder) });
  } catch (err) {
    console.error("Customer orders error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pedidos." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/me/orders/:id  (protected customer route)
// ---------------------------------------------------------------------------
router.get("/me/orders/:id", requireCustomerAuth, async (req, res) => {
  try {
    const customerSession = getCustomerSession(req);
    if (!customerSession) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    await attachLegacyGuestOrdersToCustomer(customerSession.userId, customerSession.email);

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    let orderId = id;
    if (Array.isArray(orderId)) orderId = orderId[0];
    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.userId, customerSession.userId)))
      .limit(1);

    if (!rows[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    res.json({ order: mapOrder(rows[0]) });
  } catch (err) {
    console.error("Customer order detail error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pedido." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/guest/:id?token=...  (public guest route)
// ---------------------------------------------------------------------------
router.get("/orders/guest/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const token = String((req.query as Record<string, string>).token || "").trim();

    if (!token) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Token de acesso é obrigatório." });
      return;
    }

    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.id, id), eq(ordersTable.guestAccessToken, token)))
      .limit(1);

    if (!rows[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    res.json({ order: mapOrder(rows[0]) });
  } catch (err) {
    console.error("Guest order access error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pedido." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/orders  (protected)
// ---------------------------------------------------------------------------
router.get("/admin/orders", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    const { dateFrom, dateTo, status, paymentMethod, sellerCode, pinReshipments } = req.query as Record<string, string>;
    const shouldPinReshipments = pinReshipments !== "0";

    // São Paulo = UTC-3: midnight SP = 03:00 UTC; end-of-day SP 23:59:59 = next day 02:59:59 UTC
    const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
    const dateConditions = [];
    const nonDateConditions = [];
    if (dateFrom) {
      const from = new Date(dateFrom + "T00:00:00.000Z");
      from.setTime(from.getTime() + SP_OFFSET_MS);
      dateConditions.push(gte(ordersTable.createdAt, from));
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59.999Z");
      to.setTime(to.getTime() + SP_OFFSET_MS);
      dateConditions.push(lte(ordersTable.createdAt, to));
    }
    if (status && status !== "all") {
      if (status === "paid") nonDateConditions.push(inArray(ordersTable.status, ["paid", "completed"]));
      else nonDateConditions.push(eq(ordersTable.status, status));
    }
    if (paymentMethod && paymentMethod !== "all") nonDateConditions.push(eq(ordersTable.paymentMethod, paymentMethod));
    if (!adminScope.hasGlobalAccess) {
      if (sellerCode && sellerCode !== "all" && sellerCode !== adminScope.sellerCode) {
        res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para acessar outro seller." });
        return;
      }
      nonDateConditions.push(eq(ordersTable.sellerCode, adminScope.sellerCode!));
    } else if (sellerCode && sellerCode !== "all") {
      nonDateConditions.push(eq(ordersTable.sellerCode, sellerCode));
    }

    const conditions = [...dateConditions, ...nonDateConditions];

    const baseOrders = await db
      .select()
      .from(ordersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ordersTable.createdAt));

    // Keep active reshipments visible in Orders even if the order is outside the current date range.
    let orders = baseOrders;
    if (shouldPinReshipments && dateConditions.length > 0) {
      const activeReshipments = await db
        .select({ orderId: reshipmentsTable.orderId })
        .from(reshipmentsTable)
        .where(inArray(reshipmentsTable.status, ["reenvio_aguardando_estoque", "reenvio_pronto_para_envio"]));

      const baseOrderIds = new Set(baseOrders.map((o) => o.id));
      const activeOrderIds = Array.from(new Set(activeReshipments.map((r) => r.orderId))).filter((id) => !baseOrderIds.has(id));

      if (activeOrderIds.length > 0) {
        const extraWhere = nonDateConditions.length > 0
          ? and(inArray(ordersTable.id, activeOrderIds), ...nonDateConditions)
          : inArray(ordersTable.id, activeOrderIds);

        const extraOrders = await db
          .select()
          .from(ordersTable)
          .where(extraWhere)
          .orderBy(desc(ordersTable.createdAt));

        orders = [...baseOrders, ...extraOrders];
      }
    }

    const reshipmentByOrder = await getReshipmentByOrderIds(orders.map((o) => o.id));

    const enriched = orders.map((order) => {
      const ipCity   = String((order as any).ipCity   || "").trim().toLowerCase();
      const ipRegion = String((order as any).ipRegion || "").trim().toLowerCase();
      const addrCity = String(order.addressCity  || "").trim().toLowerCase();
      const addrState= String(order.addressState || "").trim().toLowerCase();
      const hasGeo   = ipCity !== "" || ipRegion !== "";
      const hasAddr  = addrCity !== "" || addrState !== "";

      let purchaseRisk: "low" | "medium" | "high";
      let purchaseRiskReason: string;

      if (!hasGeo || !hasAddr) {
        // Sem dados de geolocalização ou endereço — não é possível comparar
        purchaseRisk = "medium";
        purchaseRiskReason = !hasGeo
          ? "Geolocalização do IP indisponível"
          : "Endereço do pedido não informado";
      } else {
        const cityMatch  = ipCity   !== "" && addrCity  !== "" && (addrCity.includes(ipCity)  || ipCity.includes(addrCity));
        const stateMatch = ipRegion !== "" && addrState !== "" && (ipRegion.includes(addrState) || addrState.includes(ipRegion));

        if (cityMatch) {
          purchaseRisk = "low";
          purchaseRiskReason = `Cidade do IP bate com o endereço (${(order as any).ipCity} / ${order.addressCity})`;
        } else if (stateMatch) {
          purchaseRisk = "medium";
          purchaseRiskReason = `Estado bate, cidade diverge (IP: ${(order as any).ipCity || ipRegion}, pedido: ${order.addressCity})`;
        } else {
          purchaseRisk = "high";
          purchaseRiskReason = `Localização não bate com o endereço (IP: ${(order as any).ipCity || (order as any).ipRegion}, pedido: ${order.addressCity}/${order.addressState})`;
        }
      }

      return {
        ...mapOrder(order),
        purchaseRisk,
        purchaseRiskReason,
        reshipment: reshipmentByOrder.get(order.id) || null,
      };
    });

    // Prioritize cards that still need resend handling at the top of the list.
    const prioritized = [...enriched].sort((a, b) => {
      const aActive = a.reshipment?.status === "reenvio_aguardando_estoque" || a.reshipment?.status === "reenvio_pronto_para_envio";
      const bActive = b.reshipment?.status === "reenvio_aguardando_estoque" || b.reshipment?.status === "reenvio_pronto_para_envio";
      if (aActive !== bActive) return bActive ? 1 : -1;
      const aTime = Date.parse(a.createdAt || "");
      const bTime = Date.parse(b.createdAt || "");
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });

    res.json({ orders: prioritized });
  } catch (err) {
    console.error("Admin orders error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pedidos." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/status  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/status", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { status, cardInstallmentsActual, cardInstallmentValue, cardTotalActual } = req.body as {
      status: string;
      cardInstallmentsActual?: number;
      cardInstallmentValue?: number;
      cardTotalActual?: number;
    };

    const allowed = ["pending", "awaiting_payment", "paid", "cancelled", "completed"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "INVALID_STATUS", message: "Status inválido." });
      return;
    }

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (cardInstallmentsActual !== undefined) updates.cardInstallmentsActual = Number(cardInstallmentsActual);
    if (cardInstallmentValue !== undefined) updates.cardInstallmentValue = String(cardInstallmentValue);
    if (cardTotalActual !== undefined) updates.cardTotalActual = String(cardTotalActual);

    // Fetch coupon before updating (to increment usage on manual paid confirmation)
    const isBeingPaid = status === "paid" || status === "completed";
    let couponCodeToIncrement: string | null = null;
    if (isBeingPaid) {
      const existing = await db
        .select({ status: ordersTable.status, couponCode: ordersTable.couponCode, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
        .from(ordersTable)
        .where(buildAdminOrderWhere(id, adminScope))
        .limit(1);
      if (!existing[0]) {
        res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
        return;
      }
      const wasAlreadyPaid = existing[0]?.status === "paid" || existing[0]?.status === "completed";
      if (!wasAlreadyPaid && existing[0]?.couponCode) {
        couponCodeToIncrement = existing[0].couponCode;
      }
      // Record the paid amount (the current total at the time of payment confirmation)
      if (!existing[0]?.paidAmount && existing[0]?.total) {
        updates.paidAmount = existing[0].total;
      }
    }

    const updateResult = await db.update(ordersTable).set(updates).where(buildAdminOrderWhere(id, adminScope));
    if ((updateResult as any).rowsAffected === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    if (couponCodeToIncrement) {
      await incrementCouponUse(couponCodeToIncrement);
    }

    if (isBeingPaid) {
      await ensureOrderCommission(id);
    }

    broadcastNotification({ type: "order_status_updated", data: { id, status } });
    res.json({ ok: true, id, status });
  } catch (err) {
    console.error("Update order status error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar status." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/observation  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/observation", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { observation } = req.body as { observation?: string };
    await db.update(ordersTable)
      .set({ observation: observation?.trim() || null, updatedAt: new Date() })
      .where(buildAdminOrderWhere(id, adminScope));
    res.json({ ok: true });
  } catch (err) {
    console.error("Update observation error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar observação." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/proof  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/proof", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { proofData } = req.body as { proofData: string };

    if (!proofData) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Comprovante obrigatório." });
      return;
    }

    const existing = await db
      .select({ proofUrl: ordersTable.proofUrl, proofUrls: ordersTable.proofUrls, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    let urls: string[] = [];
    if (existing[0]?.proofUrls) {
      try { urls = JSON.parse(existing[0].proofUrls); } catch { urls = []; }
    }
    if (existing[0]?.proofUrl && !urls.includes(existing[0].proofUrl)) {
      urls.unshift(existing[0].proofUrl);
    }
    if (!urls.includes(proofData)) urls.push(proofData);

    // Set paidAmount to current total if not already recorded
    const proofPaidAmount = existing[0]?.paidAmount ?? existing[0]?.total ?? null;

    await db.update(ordersTable)
      .set({ proofUrl: proofData, proofUrls: JSON.stringify(urls), status: "completed", paidAmount: proofPaidAmount, updatedAt: new Date() })
      .where(buildAdminOrderWhere(id, adminScope));

    await ensureOrderCommission(id);

    broadcastNotification({ type: "order_status_updated", data: { id, status: "completed" } });
    res.json({ ok: true, proofUrls: urls });
  } catch (err) {
    console.error("Upload proof error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar comprovante." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/edit  (protected, full-access only)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/edit", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { products: newProducts, subtotal, total, address } = req.body as {
      products: Array<{ id: string; name: string; quantity: number; price: number }>;
      subtotal: number;
      total: number;
      address?: {
        cep?: string | null;
        street?: string | null;
        number?: string | null;
        complement?: string | null;
        neighborhood?: string | null;
        city?: string | null;
        state?: string | null;
      };
    };

    if (!newProducts || !Array.isArray(newProducts) || newProducts.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Produtos inválidos." });
      return;
    }

    // Read current order to decide if status should change
    const current = await db.select().from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    if (!current[0]) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const currentTotal   = Number(current[0].total);
    const currentStatus  = current[0].status;
    const paidAmount     = current[0].paidAmount ? Number(current[0].paidAmount) : null;
    const isPaid         = currentStatus === "paid" || currentStatus === "completed";

    let newStatus: string;
    if (paidAmount !== null) {
      // Order has a recorded paid amount — use it as the reference for all comparisons
      if (total > paidAmount + 0.01) {
        // New total exceeds what was paid → wait for the difference
        newStatus = "awaiting_payment";
      } else {
        // New total is at or below what was paid → fully paid again
        newStatus = "paid";
      }
    } else if (isPaid && total > currentTotal + 0.01) {
      // Paid order (no paidAmount recorded yet) edited UP → flag for difference
      newStatus = "awaiting_payment";
    } else {
      // Unpaid order or no change in direction — keep current status
      newStatus = currentStatus;
    }

    const nextAddressCep = address?.cep !== undefined ? String(address.cep || "").trim() || null : undefined;
    const nextAddressStreet = address?.street !== undefined ? String(address.street || "").trim() || null : undefined;
    const nextAddressNumber = address?.number !== undefined ? String(address.number || "").trim() || null : undefined;
    const nextAddressComplement = address?.complement !== undefined ? String(address.complement || "").trim() || null : undefined;
    const nextAddressNeighborhood = address?.neighborhood !== undefined ? String(address.neighborhood || "").trim() || null : undefined;
    const nextAddressCity = address?.city !== undefined ? String(address.city || "").trim() || null : undefined;
    const nextAddressState = address?.state !== undefined ? String(address.state || "").trim() || null : undefined;

    const updates: Partial<typeof ordersTable.$inferInsert> = {
      products: newProducts,
      subtotal: String(subtotal),
      total: String(total),
      status: newStatus,
      updatedAt: new Date(),
    };

    if (nextAddressCep !== undefined) updates.addressCep = nextAddressCep;
    if (nextAddressStreet !== undefined) updates.addressStreet = nextAddressStreet;
    if (nextAddressNumber !== undefined) updates.addressNumber = nextAddressNumber;
    if (nextAddressComplement !== undefined) updates.addressComplement = nextAddressComplement;
    if (nextAddressNeighborhood !== undefined) updates.addressNeighborhood = nextAddressNeighborhood;
    if (nextAddressCity !== undefined) updates.addressCity = nextAddressCity;
    if (nextAddressState !== undefined) updates.addressState = nextAddressState;

    await db.update(ordersTable)
      .set(updates)
      .where(buildAdminOrderWhere(id, adminScope));

    const updated = await db.select().from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    if (!updated[0]) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    broadcastNotification({ type: "order_updated", data: { id } });
    res.json({ ok: true, order: mapOrder(updated[0]) });
  } catch (err) {
    console.error("Edit order error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao editar pedido." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/orders/:id/difference-charge  (protected, full-access only)
// ---------------------------------------------------------------------------
router.post("/admin/orders/:id/difference-charge", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { amount, description } = req.body as { amount: number; description?: string };

    if (!amount || amount <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor inválido." });
      return;
    }

    const orders = await db.select().from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    if (!orders[0]) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    const order = orders[0];

    const chargeId = crypto.randomBytes(8).toString("hex");
    const identifier = genIdentifier();
    const callbackUrl = buildCallbackUrl(req as never, "/webhook/pix");
    const desc = description || `Diferença pedido #${id}`;

    const gatewayData = await createPixCharge({
      identifier,
      amount,
      client: { name: order.clientName, email: order.clientEmail, phone: order.clientPhone, document: order.clientDocument },
      metadata: { chargeId, description: desc },
      callbackUrl,
    });

    await db.insert(customChargesTable).values({
      id: chargeId,
      orderId: id,
      clientName: order.clientName,
      clientEmail: order.clientEmail,
      clientPhone: order.clientPhone,
      clientDocument: order.clientDocument,
      addressCep: order.addressCep,
      addressStreet: order.addressStreet,
      addressNumber: order.addressNumber,
      addressComplement: order.addressComplement,
      addressNeighborhood: order.addressNeighborhood,
      addressCity: order.addressCity,
      addressState: order.addressState,
      description: desc,
      sellerCode: order.sellerCode,
      amount: String(amount),
      status: "awaiting_payment",
      transactionId: gatewayData.transactionId,
    });

    const expiresAt = new Date(Date.now() + PIX_DURATION_MS).toISOString();
    res.json({
      id: chargeId,
      transactionId: gatewayData.transactionId,
      pixCode: gatewayData.pix?.code || "",
      pixBase64: gatewayData.pix?.base64 || "",
      pixImage: gatewayData.pix?.image || "",
      expiresAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido.";
    console.error("Diff PIX error:", err);
    res.status(400).json({ error: "GATEWAY_ERROR", message: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/export  (protected)
// ---------------------------------------------------------------------------
router.get("/admin/export", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    const { dateFrom, dateTo, status, paymentMethod, sellerCode } = req.query as Record<string, string>;

    // São Paulo = UTC-3: midnight SP = 03:00 UTC; end-of-day SP 23:59:59 = next day 02:59:59 UTC
    const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
    const conditions = [];
    if (dateFrom) {
      const from = new Date(dateFrom + "T00:00:00.000Z");
      from.setTime(from.getTime() + SP_OFFSET_MS);
      conditions.push(gte(ordersTable.createdAt, from));
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59.999Z");
      to.setTime(to.getTime() + SP_OFFSET_MS);
      conditions.push(lte(ordersTable.createdAt, to));
    }
    if (status && status !== "all") {
      if (status === "paid") conditions.push(inArray(ordersTable.status, ["paid", "completed"]));
      else conditions.push(eq(ordersTable.status, status));
    }
    if (paymentMethod && paymentMethod !== "all") conditions.push(eq(ordersTable.paymentMethod, paymentMethod));
    if (!adminScope.hasGlobalAccess) {
      if (sellerCode && sellerCode !== "all" && sellerCode !== adminScope.sellerCode) {
        res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para acessar outro seller." });
        return;
      }
      conditions.push(eq(ordersTable.sellerCode, adminScope.sellerCode!));
    } else if (sellerCode && sellerCode !== "all") {
      conditions.push(eq(ordersTable.sellerCode, sellerCode));
    }

    const orders = await db
      .select()
      .from(ordersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ordersTable.createdAt));

    const cols = [
      "ID", "Data", "Vendedor", "Cliente", "Email", "Telefone", "CPF",
      "CEP", "Rua", "Número", "Bairro", "Cidade", "Estado",
      "Pagamento", "Parcelamento", "Frete", "Seguro",
      "Subtotal", "Frete (R$)", "Seguro (R$)", "Cupom", "Desconto (R$)", "Total",
      "Status", "Transação PIX", "Produtos",
    ];
    const header = cols.map(csvField).join(";");

    const rows = orders.map((o) => {
      const products = (o.products as Array<{ name: string; quantity: number; price: number }>)
        .map((p) => `${p.quantity}x ${p.name}`).join(" | ");

      return [
        o.id,
        o.createdAt?.toLocaleString("pt-BR") ?? "",
        o.sellerCode || "",
        o.clientName,
        o.clientEmail,
        o.clientPhone,
        o.clientDocument,
        o.addressCep ?? "",
        o.addressStreet ?? "",
        o.addressNumber ?? "",
        o.addressNeighborhood ?? "",
        o.addressCity ?? "",
        o.addressState ?? "",
        o.paymentMethod === "card_simulation" ? "Cartão (simulação)" : "PIX",
        o.cardInstallments ? `${o.cardInstallments}x` : "",
        o.shippingType,
        o.includeInsurance ? "Sim" : "Não",
        o.subtotal,
        o.shippingCost,
        o.insuranceAmount,
        o.couponCode ?? "",
        o.discountAmount ?? "0",
        o.total,
        o.status,
        o.transactionId ?? "",
        products,
      ].map(csvField).join(";");
    });

    const csv = [header, ...rows].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pedidos-${Date.now()}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao exportar." });
  }
});

function mapOrder(o: typeof ordersTable.$inferSelect) {
  let proofUrls: string[] = [];
  if (o.proofUrls) {
    try { proofUrls = JSON.parse(o.proofUrls); } catch { proofUrls = []; }
  }
  if (o.proofUrl && !proofUrls.includes(o.proofUrl)) {
    proofUrls = [o.proofUrl, ...proofUrls];
  }

  let products: Array<{ id: string; name: string; quantity: number; price: number; costPrice?: number }> = [];
  if (Array.isArray(o.products)) {
    products = o.products as Array<{ id: string; name: string; quantity: number; price: number; costPrice?: number }>;
  } else if (typeof o.products === "string") {
    try {
      const parsed = JSON.parse(o.products);
      if (Array.isArray(parsed)) {
        products = parsed as Array<{ id: string; name: string; quantity: number; price: number; costPrice?: number }>;
      }
    } catch {
      products = [];
    }
  }

  return {
    id:                  o.id,
    clientName:          o.clientName,
    clientEmail:         o.clientEmail,
    clientPhone:         o.clientPhone,
    clientDocument:      o.clientDocument,
    addressCep:          o.addressCep,
    addressStreet:       o.addressStreet,
    addressNumber:       o.addressNumber,
    addressComplement:   o.addressComplement,
    addressNeighborhood: o.addressNeighborhood,
    addressCity:         o.addressCity,
    addressState:        o.addressState,
    products,
    shippingType:        o.shippingType,
    includeInsurance:    o.includeInsurance,
    subtotal:            Number(o.subtotal),
    shippingCost:        Number(o.shippingCost),
    insuranceAmount:     Number(o.insuranceAmount),
    total:               Number(o.total),
    status:              o.status,
    paymentMethod:       o.paymentMethod || "pix",
    cardInstallments:    o.cardInstallments,
    proofUrl:            o.proofUrl,
    proofUrls,
    transactionId:       o.transactionId,
    sellerCode:             o.sellerCode,
    sellerCommissionRateSnapshot: o.sellerCommissionRateSnapshot ? Number(o.sellerCommissionRateSnapshot) : null,
    couponCode:             o.couponCode,
    discountAmount:         o.discountAmount ? Number(o.discountAmount) : null,
    affiliateCreditUsed:    o.affiliateCreditUsed ? Number(o.affiliateCreditUsed) : null,
    observation:            o.observation,
    cardInstallmentsActual: o.cardInstallmentsActual,
    cardInstallmentValue:   o.cardInstallmentValue ? Number(o.cardInstallmentValue) : null,
    cardTotalActual:        o.cardTotalActual ? Number(o.cardTotalActual) : null,
    paidAmount:             o.paidAmount ? Number(o.paidAmount) : null,
    createdAt:              o.createdAt?.toISOString() ?? new Date().toISOString(),
    purchaseIp:             o.purchaseIp,
    ipCity:                 o.ipCity ?? null,
    ipRegion:               o.ipRegion ?? null,
    ipIsp:                  o.ipIsp ?? null,
    ipIsProxy:              o.ipIsProxy ?? null,
    enviado:                !!o.enviado,
  };
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/enviado  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/enviado", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { enviado } = req.body as { enviado: boolean };
    if (typeof enviado !== "boolean") {
      res.status(400).json({ error: "INVALID_INPUT", message: "Campo 'enviado' obrigatório e deve ser boolean." });
      return;
    }
    const rows = await db
      .select({
        id: ordersTable.id,
        products: ordersTable.products,
        clientName: ordersTable.clientName,
        enviado: ordersTable.enviado,
      })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);
    const order = rows[0];
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    const wasEnviado = !!order.enviado;

    if (enviado !== wasEnviado) {
      const orderItems = parseOrderItemsForInventory(order.products);
      if (orderItems.length > 0) {
        const missingIds = orderItems.filter((item) => !item.productId);
        let resolvedItems = orderItems;

        if (missingIds.length > 0) {
          const productRows = await db
            .select({ id: productsTable.id, name: productsTable.name })
            .from(productsTable);
          const productIdByName = new Map(productRows.map((row) => [String(row.name || "").trim().toLowerCase(), row.id] as const));
          resolvedItems = orderItems.map((item) => {
            if (item.productId) return item;
            const byName = productIdByName.get(item.productName.trim().toLowerCase()) || null;
            return { ...item, productId: byName };
          });
        }

        const stillMissingIds = resolvedItems.filter((item) => !item.productId);
        if (stillMissingIds.length > 0) {
          const names = stillMissingIds.map((item) => item.productName).join(", ");
          res.status(400).json({
            error: "INVENTORY_PRODUCT_MAPPING_ERROR",
            message: `Não foi possível mapear os produtos no estoque: ${names}.`,
          });
          return;
        }

        const productIds = resolvedItems.map((item) => item.productId!).filter(Boolean);
        const balanceRows = productIds.length > 0
          ? await db
              .select({ productId: inventoryBalancesTable.productId, quantity: inventoryBalancesTable.quantity })
              .from(inventoryBalancesTable)
              .where(inArray(inventoryBalancesTable.productId, productIds))
          : [];

        const stockByProduct = new Map<string, number>();
        for (const row of balanceRows as Array<{ productId: string; quantity: number }>) {
          stockByProduct.set(String(row.productId), Number(row.quantity) || 0);
        }

        if (enviado) {
          const insufficient = resolvedItems.filter((item) => (stockByProduct.get(item.productId!) || 0) < item.quantity);
          if (insufficient.length > 0) {
            const details = insufficient
              .map((item) => `${item.productName} (precisa ${item.quantity}, disponível ${stockByProduct.get(item.productId!) || 0})`)
              .join("; ");
            res.status(400).json({
              error: "INSUFFICIENT_STOCK",
              message: `Estoque insuficiente para envio: ${details}.`,
            });
            return;
          }
        }

        for (const item of resolvedItems) {
          const qty = enviado ? -item.quantity : item.quantity;
          await registerInventoryEntry({
            productId: item.productId!,
            quantity: qty,
            reason: enviado
              ? `Saída por envio do pedido ${id}`
              : `Estorno de saída do pedido ${id}`,
            referenceId: id,
            clientName: order.clientName || null,
          });
        }
      }
    }

    await db.update(ordersTable)
      .set({ enviado, updatedAt: new Date() })
      .where(buildAdminOrderWhere(id, adminScope));
    broadcastNotification({ type: "order_enviado_updated", data: { id, enviado } });
    res.json({ ok: true, id, enviado });
  } catch (err) {
    console.error("Update order enviado error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar status de envio." });
  }
});

export default router;
