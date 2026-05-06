import { Router, type IRouter } from "express";
import { db, ordersTable, sellersTable, productsTable, siteSettingsTable, couponsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { broadcastNotification } from "./notifications";
import { evaluateCouponForProducts, incrementCouponUse } from "./coupons";
import {
  createPixCharge,
  buildCallbackUrl,
  genIdentifier,
  PIX_DURATION_MS,
} from "../gateway";
import { getCustomerSession } from "../middlewares/customer-auth";
import { applyAffiliateCreditToOrder, normalizeAffiliateCode, registerAffiliateLead, resolveAffiliateByCode } from "../lib/affiliates";
import { lookupIpGeo } from "../lib/ip-geo";

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

async function isPaymentMethodEnabled(key: "checkout_enable_pix" | "checkout_enable_card"): Promise<boolean> {
  const rows = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  return parseEnabledSetting(rows[0]?.value ?? null);
}

// ---------------------------------------------------------------------------
// POST /api/checkout/pix
// Atomically creates an order and generates a PIX charge.
// Replaces the two-step POST /api/orders + POST /api/pix/generate flow to
// eliminate the gap where the client might disconnect between the two calls.
// ---------------------------------------------------------------------------
router.post("/checkout/pix", async (req, res) => {
  const requestId = crypto.randomBytes(4).toString("hex");
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
    const pixEnabled = await isPaymentMethodEnabled("checkout_enable_pix");
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
        .where(eq(sellersTable.slug, slug));
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
    const productIds = Array.from(new Set(productItems.map((p) => String(p?.id || "")).filter(Boolean)));
    let productRows = new Map<string, {
      id: string;
      name: string;
      price: string;
      promoPrice: string | null;
      promoEndsAt: Date | null;
      bulkDiscountEnabled: boolean;
      bulkDiscountTiers: string | null;
      isActive: boolean;
      isSoldOut: boolean;
      stock: number | null;
      costPrice: string | null;
    }>();
    if (productIds.length > 0) {
      const rows = await db
        .select({
          id: productsTable.id,
          name: productsTable.name,
          price: productsTable.price,
          promoPrice: productsTable.promoPrice,
          promoEndsAt: productsTable.promoEndsAt,
          bulkDiscountEnabled: productsTable.bulkDiscountEnabled,
          bulkDiscountTiers: productsTable.bulkDiscountTiers,
          isActive: productsTable.isActive,
          isSoldOut: productsTable.isSoldOut,
          stock: productsTable.stock,
          costPrice: productsTable.costPrice,
        })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds));
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

    const computedSubtotal = orderProducts.reduce((acc, p) => acc + (Number(p.quantity) || 0) * (Number(p.price) || 0), 0);
    const computedShippingCost = Math.max(0, Number(shippingCost) || 0);
    const computedInsuranceAmount = Math.max(0, Number(insuranceAmount) || 0);
    const computedBaseTotal = computedSubtotal + computedShippingCost + computedInsuranceAmount;

    let normalizedCouponCode: string | null = null;
    let computedDiscountAmount = 0;

    if (couponCode?.trim()) {
      const cleanCouponCode = String(couponCode).trim().toUpperCase();
      const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, cleanCouponCode));
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
    if (amount > 10000) {
      console.warn(`[CHECKOUT/PIX:${requestId}] Validation failed — amount exceeds limit: ${amount}`);
      res.status(400).json({ error: "INVALID_INPUT", message: "O valor máximo para PIX é R$10.000." });
      return;
    }

    await db.insert(ordersTable).values({
      id:                  orderId,
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
          .where(eq(ordersTable.id, orderId));
      }
    }

    if (affiliateUserId) {
      await registerAffiliateLead({
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
        .where(eq(ordersTable.id, orderId))
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
        createdAt:     new Date().toISOString(),
      },
    });

    // Increment coupon usage if applicable
    if (normalizedCouponCode) {
      try { await incrementCouponUse(normalizedCouponCode); } catch { /* non-fatal */ }
    }

    const payableAmount = Math.max(0, amount - affiliateCreditUsed);
    if (payableAmount <= 0) {
      broadcastNotification({ type: "order_paid", data: { id: orderId, status: "paid" } });
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
    const identifier  = genIdentifier();
    const callbackUrl = buildCallbackUrl(req as never, "/webhook/pix");
    console.log(`[CHECKOUT/PIX:${requestId}] Generating PIX for order ${orderId} — amount: ${payableAmount} — callback: ${callbackUrl}`);

    let gatewayData;
    try {
      gatewayData = await createPixCharge({
        identifier,
        amount: payableAmount,
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
        .where(eq(ordersTable.id, orderId))
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
      .where(eq(ordersTable.id, orderId));

    console.log(`[CHECKOUT/PIX:${requestId}] PIX generated — transactionId: ${gatewayData.transactionId}`);

    res.json({
      orderId,
      affiliateCode: affiliateUserId ? normalizedAffiliateCode : null,
      guestAccessToken,
      isGuestOrder: !customerSession,
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
    console.error(`[CHECKOUT/PIX:${requestId}] Unexpected error:`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno ao processar pedido. Tente novamente." });
  }
});

export default router;
