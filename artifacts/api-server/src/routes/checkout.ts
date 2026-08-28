import { Router, type IRouter } from "express";
import { db, ordersTable, sellersTable, productsTable, siteSettingsTable, tenantSettingsTable, couponsTable, motoboyDeliveryReservationsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { broadcastNotification } from "./notifications";
import { evaluateCouponForProducts, incrementCouponUse } from "./coupons";
import {
  createPixChargeWithProvider,
  buildCallbackUrl,
  genIdentifier,
  normalizePixGatewayProvider,
  PIX_DURATION_MS,
} from "../gateway";
import { getCustomerSession } from "../middlewares/customer-auth";
import { applyAffiliateCreditToOrder, ensureOrderCommission, normalizeAffiliateCode, registerAffiliateLead, resolveAffiliateByCode } from "../lib/affiliates";
import { sendOutboundWebhook } from "../lib/outbound-webhook";
import { lookupIpGeo } from "../lib/ip-geo";
import { parseFreeShippingMinSubtotalSetting, pickFreeShippingMinSubtotal, resolveShippingCostWithFreeThreshold } from "../lib/free-shipping";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";
import { enqueueFilialOrderPurchaseRequest } from "../lib/filial-purchase-queue";
import { reserveNextOrderNumber } from "../lib/order-number";
import { allocateOrderLogistics } from "../lib/order-logistics";
import { MotoboyScheduleError, type MotoboyScheduleInput, reserveMotoboySchedule } from "../lib/motoboy-delivery-schedule";
import { isMotoboyShippingType } from "../lib/motoboy-shipping-type";
import { cartProductIdsFromItems, isCartEligibleForMotoboy } from "../lib/motoboy-eligible-products";

const router: IRouter = Router();

type BulkDiscountTierInput = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
};

type CheckoutProductInput = {
  id: string;
  name?: string;
  quantity: number;
  price: number;
  isBump?: boolean;
  selectedVariants?: Array<{ groupName?: string; option?: string }>;
  variantLabel?: string;
};

function normalizeOrderItemVariants(raw: unknown): Array<{ groupName: string; option: string }> {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const value = item as Record<string, unknown>;
      const groupName = String(value.groupName ?? "").trim();
      const option = String(value.option ?? "").trim();
      if (!groupName || !option) return null;
      return { groupName, option };
    })
    .filter((item): item is { groupName: string; option: string } => Boolean(item));
}

function buildVariantLabel(variants: Array<{ groupName: string; option: string }>): string {
  return variants.map((item) => `${item.groupName}: ${item.option}`).join(" / ");
}

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

function normalizeIp(raw?: string | null): string {
  return String(raw || "")
    .trim()
    .replace(/^::ffff:/, "")
    .replace(/^\[|\]$/g, "");
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

function parseEnabledSetting(value?: string | null): boolean {
  if (value == null || value === "") return true;
  const normalized = String(value).trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

async function isPaymentMethodEnabled(key: "checkout_enable_pix" | "checkout_enable_card", tenantId: string): Promise<boolean> {
  const value = await getSettingValue(key, tenantId);
  return parseEnabledSetting(value ?? null);
}

async function getActivePixGateway(tenantId: string): Promise<"appcnpay" | "dentpeg"> {
  const value = await getSettingValue("checkout_pix_gateway", tenantId);
  return normalizePixGatewayProvider(value ?? null);
}

async function getFreeShippingMinSubtotal(tenantId: string, shippingType?: unknown): Promise<number | null> {
  const [standardRaw, motoboyRaw] = await Promise.all([
    getSettingValue("checkout_free_shipping_min_subtotal", tenantId),
    getSettingValue("checkout_free_shipping_min_motoboy", tenantId),
  ]);
  return pickFreeShippingMinSubtotal({
    shippingType,
    standardMin: parseFreeShippingMinSubtotalSetting(standardRaw ?? ""),
    motoboyMin: parseFreeShippingMinSubtotalSetting(motoboyRaw ?? ""),
  });
}

async function getSettingValue(key: string, tenantId = DEFAULT_TENANT_ID): Promise<string | null> {
  const tenantRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);

  if (tenantRows[0]?.value != null) return tenantRows[0].value;

  const legacyRows = await db
    .select({ value: siteSettingsTable.value })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.key, key))
    .limit(1);

  return legacyRows[0]?.value ?? null;
}

// ---------------------------------------------------------------------------
// POST /api/checkout/pix
// Atomically creates an order and generates a PIX charge.
// Replaces the two-step POST /api/orders + POST /api/pix/generate flow to
// eliminate the gap where the client might disconnect between the two calls.
// ---------------------------------------------------------------------------
router.post("/checkout/pix", async (req, res) => {
  const requestId = crypto.randomBytes(4).toString("hex");
  const tenantId = await resolvePublicTenantId(req as any);
  const purchaseIp = getPurchaseIp(req) || "IP_NAO_ENCONTRADO";

  // Log the FULL request payload immediately — before any validation
  console.log(`[CHECKOUT/PIX:${requestId}] Request received:`, JSON.stringify({
    amount:    req.body?.amount,
    orderId:   req.body?.orderId,
    client: {
      name:     req.body?.client?.name     || "(missing)",
      email:    req.body?.client?.email    || "(missing)",
      phone:    req.body?.client?.phone    || "(missing)",
      document: req.body?.client?.document ? `present(${String(req.body.client.document).length} chars)` : "(missing)",
    },
    shippingType: req.body?.shippingType,
    sellerCode: req.body?.sellerCode || null,
    hasAddress:   !!req.body?.address,
    hasProducts:  Array.isArray(req.body?.products) ? req.body.products.length : 0,
  }));

  try {
    const pixEnabled = await isPaymentMethodEnabled("checkout_enable_pix", tenantId);
    if (!pixEnabled) {
      res.status(403).json({
        error: "PAYMENT_METHOD_DISABLED",
        message: "Pagamento via PIX está temporariamente indisponível.",
      });
      return;
    }

    const customerSession = getCustomerSession(req);
    const guestAccessToken = customerSession ? null : crypto.randomBytes(24).toString("hex");

    const {
      client, address, products, shippingType, includeInsurance,
      shippingCost, insuranceAmount,
      sellerCode, couponCode,
      useAffiliateCredit,
      motoboySchedule,
    } = req.body as {
      client: { name: string; email: string; phone: string; document: string };
      address?: {
        cep?: string; street?: string; number?: string; complement?: string;
        neighborhood?: string; city?: string; state?: string;
      };
      products?: CheckoutProductInput[];
      shippingType?: string;
      includeInsurance?: boolean;
      shippingCost?: number;
      insuranceAmount?: number;
      sellerCode?: string;
      couponCode?: string;
      useAffiliateCredit?: boolean;
      motoboySchedule?: MotoboyScheduleInput;
    };

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
        .where(and(eq(sellersTable.tenantId, tenantId), eq(sellersTable.slug, slug)));
      if (seller?.hasCommission) {
        sellerCommissionRateSnapshot = Number(seller.commissionRate ?? 0);
      }
    }

    // ── Validate client fields ────────────────────────────────────────────
    if (!client?.name || !client?.email || !client?.phone || !client?.document) {
      console.warn(`[CHECKOUT/PIX:${requestId}] Validation failed — missing client fields:`, {
        name: !client?.name, email: !client?.email,
        phone: !client?.phone, document: !client?.document,
      });
      res.status(400).json({ error: "INVALID_INPUT", message: "Nome, e-mail, telefone e CPF são obrigatórios." });
      return;
    }

    // ── Create the order record ───────────────────────────────────────────
    const orderId = crypto.randomBytes(8).toString("hex");

    const productItems = Array.isArray(products) ? products : [];
    if (productItems.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Carrinho vazio." });
      return;
    }

    const productIds = Array.from(new Set(productItems.map((p) => String(p?.id || "")).filter(Boolean)));
    let productRows = new Map<string, typeof productsTable.$inferSelect>();
    if (productIds.length > 0) {
      const rows = await db.select().from(productsTable).where(and(eq(productsTable.tenantId, tenantId), inArray(productsTable.id, productIds)));
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
        const selectedVariants = normalizeOrderItemVariants(item.selectedVariants);
        const variantLabel = String(item.variantLabel || "").trim() || buildVariantLabel(selectedVariants);
        const rawName = String(item.name || current.name || "Produto");
        const productName = variantLabel && !rawName.includes(variantLabel)
          ? `${rawName} - ${variantLabel}`
          : rawName;

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
          name: productName,
          quantity,
          price: serverUnitPrice,
          costPrice: Number(current.costPrice || 0),
          selectedVariants: selectedVariants.length > 0 ? selectedVariants : undefined,
          variantLabel: variantLabel || undefined,
        };
      })
      .filter((item): item is {
        id: string;
        name: string;
        quantity: number;
        price: number;
        costPrice: number;
        selectedVariants?: Array<{ groupName: string; option: string }>;
        variantLabel?: string;
      } => Boolean(item));

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

    if (isMotoboyShippingType(shippingType)) {
      const eligibleRaw = await getSettingValue("motoboy_eligible_product_ids", tenantId);
      if (!isCartEligibleForMotoboy(cartProductIdsFromItems(orderProducts), eligibleRaw)) {
        res.status(400).json({
          error: "MOTOBOY_NOT_ELIGIBLE",
          message: "Este carrinho não é elegível para entrega por motoboy.",
        });
        return;
      }
    }

    const computedSubtotal = orderProducts.reduce((acc, p) => acc + (Number(p.quantity) || 0) * (Number(p.price) || 0), 0);
    const shippingBaseCost = Math.max(0, Number(shippingCost) || 0);
    const freeShippingMinSubtotal = await getFreeShippingMinSubtotal(tenantId, shippingType);
    const computedShippingCost = resolveShippingCostWithFreeThreshold({
      subtotal: computedSubtotal,
      shippingBaseCost,
      freeShippingMinSubtotal,
    });
    const computedInsuranceAmount = Math.max(0, Number(insuranceAmount) || 0);
    const computedBaseTotal = computedSubtotal + computedShippingCost + computedInsuranceAmount;

    let normalizedCouponCode: string | null = null;
    let computedDiscountAmount = 0;

    if (couponCode?.trim()) {
      const cleanCouponCode = String(couponCode).trim().toUpperCase();
      const [coupon] = await db.select().from(couponsTable).where(and(eq(couponsTable.tenantId, tenantId), eq(couponsTable.code, cleanCouponCode)));
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
      normalizedCouponCode = cleanCouponCode;
      computedDiscountAmount = evaluation.discountAmount;

      console.warn(`[CHECKOUT/PIX:${requestId}] Coupon applied`, {
        code: cleanCouponCode,
        orderValue: computedBaseTotal,
        eligibleSubtotal: evaluation.eligibleSubtotal,
        discountAmount: evaluation.discountAmount,
        productsCount: orderProducts.length,
        purchaseIp,
        customerEmail: client?.email || null,
      });
    }

    const amount = Math.max(0, computedBaseTotal - computedDiscountAmount);
    if (!amount || amount <= 0) {
      console.warn(`[CHECKOUT/PIX:${requestId}] Validation failed — invalid computed amount: ${amount}`);
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor inválido. Deve ser maior que zero." });
      return;
    }

    let assignedOrderNumber = 0;
    await db.transaction(async (tx) => {
      assignedOrderNumber = await reserveNextOrderNumber(tx, tenantId);
      const reservedMotoboySchedule = isMotoboyShippingType(shippingType)
        ? await reserveMotoboySchedule(tx, tenantId, orderId, motoboySchedule || {})
        : null;

      await tx.insert(ordersTable).values({
        id:                  orderId,
        orderNumber:         assignedOrderNumber,
        tenantId,
        userId:              customerSession?.userId ?? null,
        guestAccessToken,
        affiliateUserId,
        affiliateCode:       affiliateUserId ? normalizedAffiliateCode : null,
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
        products:            orderProducts,
        shippingType:        shippingType || "Frete",
        motoboyDeliveryDate: reservedMotoboySchedule?.date || null,
        motoboyDeliveryTime: reservedMotoboySchedule?.time || null,
        motoboyDeliveryDurationHours: reservedMotoboySchedule?.durationHours || null,
        includeInsurance:    Boolean(includeInsurance),
        subtotal:            String(computedSubtotal),
        shippingCost:        String(computedShippingCost),
        insuranceAmount:     String(computedInsuranceAmount),
        total:               String(amount),
        status:              "pending",
        paymentMethod:       "pix",
        sellerCode:          sellerCode ? String(sellerCode) : null,
        sellerCommissionRateSnapshot: String(sellerCommissionRateSnapshot),
        couponCode:          normalizedCouponCode,
        discountAmount:      computedDiscountAmount > 0 ? String(computedDiscountAmount) : null,
      });
    });

    let affiliateCreditUsed = 0;
    if (useAffiliateCredit === true && customerSession?.userId) {
      affiliateCreditUsed = await applyAffiliateCreditToOrder({
        userId: customerSession.userId,
        orderId,
        requestedAmount: amount,
      });

      if (affiliateCreditUsed > 0) {
        const payableAmount = Math.max(0, amount - affiliateCreditUsed);
        await db
          .update(ordersTable)
          .set({
            total: String(payableAmount),
            affiliateCreditUsed: String(affiliateCreditUsed),
            paymentMethod: payableAmount <= 0 ? "affiliate_credit" : "pix",
            status: payableAmount <= 0 ? "paid" : "pending",
            updatedAt: new Date(),
          })
          .where(and(eq(ordersTable.id, orderId), eq(ordersTable.tenantId, tenantId)));
      }
    }

    if (affiliateUserId) {
      await registerAffiliateLead({
        tenantId,
        affiliateUserId,
        referredUserId: customerSession?.userId ?? null,
        referredEmail: client?.email ?? null,
      });
    }

    console.log(`[CHECKOUT/PIX:${requestId}] Order created: ${orderId} (sellerCode=${sellerCode || "none"})`);

    // Geo lookup — fire and forget, não bloqueia a resposta
    lookupIpGeo(purchaseIp).then((geo) => {
      if (!geo) return;
      db.update(ordersTable)
        .set({ ipCity: geo.city, ipRegion: geo.region, ipIsp: geo.isp, ipIsProxy: geo.isProxy })
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.tenantId, tenantId)))
        .catch(() => {});
    }).catch(() => {});

    broadcastNotification({
      type: "new_order",
      data: {
        id:            orderId,
        clientName:    client.name,
        total:         amount,
        paymentMethod: "pix",
        sellerCode:    sellerCode || null,
        tenantId,
        createdAt:     new Date().toISOString(),
      },
    });
    void sendOutboundWebhook("new_order", {
      id: orderId,
      clientName: client.name,
      total: amount,
      paymentMethod: "pix",
      sellerCode: sellerCode || null,
      createdAt: new Date().toISOString(),
    }, { tenantId });

    // Increment coupon usage if applicable
    if (normalizedCouponCode) {
      try { await incrementCouponUse(normalizedCouponCode, tenantId); } catch { /* non-fatal */ }
    }

    const payableAmount = Math.max(0, amount - affiliateCreditUsed);
    if (payableAmount <= 0) {
      await ensureOrderCommission(orderId);
      await allocateOrderLogistics(orderId);
      await enqueueFilialOrderPurchaseRequest(orderId);
      broadcastNotification({ type: "order_paid", data: { id: orderId, status: "paid", tenantId } });
      void sendOutboundWebhook("order_paid", {
        id: orderId,
        status: "paid",
        coveredByAffiliateCredit: true,
      }, { tenantId });
      res.json({
        orderId,
        affiliateCode: affiliateUserId ? normalizedAffiliateCode : null,
        guestAccessToken,
        isGuestOrder: !customerSession,
        status: "paid",
        coveredByAffiliateCredit: true,
        affiliateCreditUsed,
        remainingToPay: 0,
      });
      return;
    }

    // ── Generate PIX charge ───────────────────────────────────────────────
    const gatewayProvider = await getActivePixGateway(tenantId);
    const identifier  = genIdentifier();
    const webhookSecret = String(process.env.WEBHOOK_SHARED_SECRET || "").trim();
    const callbackBase = buildCallbackUrl(req as never, "/webhook/pix");
    const callbackUrl = webhookSecret
      ? `${callbackBase}${callbackBase.includes("?") ? "&" : "?"}whsec=${encodeURIComponent(webhookSecret)}`
      : callbackBase;
    console.log(`[CHECKOUT/PIX:${requestId}] Generating PIX for order ${orderId} via ${gatewayProvider} — amount: ${payableAmount} — callback: ${callbackUrl}`);

    let gatewayData;
    try {
      gatewayData = await createPixChargeWithProvider({
        identifier,
        amount: payableAmount,
        provider: gatewayProvider,
        tenantId,
        client: {
          name:     client.name,
          email:    client.email,
          phone:    client.phone,
          document: client.document,
        },
        metadata: {
          orderId,
          shippingType:     shippingType || "normal",
          includeInsurance: String(includeInsurance ?? false),
        },
        callbackUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao gerar pagamento PIX.";
      console.error(`[CHECKOUT/PIX:${requestId}] Gateway error for order ${orderId}:`, msg);
      // Order was created but PIX failed — mark as failed so admin knows
      await db.update(ordersTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.tenantId, tenantId)))
        .catch(() => {});
      await db.delete(motoboyDeliveryReservationsTable)
        .where(and(
          eq(motoboyDeliveryReservationsTable.orderId, orderId),
          eq(motoboyDeliveryReservationsTable.tenantId, tenantId),
        ))
        .catch(() => {});
      res.status(400).json({ error: "GATEWAY_ERROR", message: msg });
      return;
    }

    const expiresAt = new Date(Date.now() + PIX_DURATION_MS).toISOString();

    // Link PIX transaction to the order
    await db.update(ordersTable)
      .set({
        transactionId: gatewayData.transactionId,
        status: "awaiting_payment",
        updatedAt: new Date(),
      })
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.tenantId, tenantId)));

    console.log(`[CHECKOUT/PIX:${requestId}] PIX generated — transactionId: ${gatewayData.transactionId}`);

    res.json({
      orderId,
      affiliateCode: affiliateUserId ? normalizedAffiliateCode : null,
      guestAccessToken,
      isGuestOrder: !customerSession,
      gatewayProvider: gatewayData.gatewayProvider || gatewayProvider,
      transactionId: gatewayData.transactionId,
      status:        gatewayData.status,
      affiliateCreditUsed,
      remainingToPay: payableAmount,
      pixCode:       gatewayData.pix?.code   || "",
      pixBase64:     gatewayData.pix?.base64 || "",
      pixImage:      gatewayData.pix?.image  || "",
      expiresAt,
    });
  } catch (err) {
    if (err instanceof MotoboyScheduleError) {
      res.status(err.code === "DELIVERY_SLOT_UNAVAILABLE" ? 409 : 400).json({ error: err.code, message: err.message });
      return;
    }
    console.error(`[CHECKOUT/PIX:${requestId}] Unexpected error:`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno ao processar pedido. Tente novamente." });
  }
});

export default router;
