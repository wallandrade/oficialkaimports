import { Router, type IRouter } from "express";
import { db, ordersTable, sellersTable, productsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { broadcastNotification } from "./notifications";
import { incrementCouponUse } from "./coupons";
import {
  createPixCharge,
  buildCallbackUrl,
  genIdentifier,
  PIX_DURATION_MS,
} from "../gateway";
import { getCustomerSession } from "../middlewares/customer-auth";
import { applyAffiliateCreditToOrder, normalizeAffiliateCode, registerAffiliateLead, resolveAffiliateByCode } from "../lib/affiliates";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/checkout/pix
// Atomically creates an order and generates a PIX charge.
// Replaces the two-step POST /api/orders + POST /api/pix/generate flow to
// eliminate the gap where the client might disconnect between the two calls.
// ---------------------------------------------------------------------------
router.post("/checkout/pix", async (req, res) => {
  const requestId = crypto.randomBytes(4).toString("hex");

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
    const customerSession = getCustomerSession(req);
    const guestAccessToken = customerSession ? null : crypto.randomBytes(24).toString("hex");

    const {
      client, address, products, shippingType, includeInsurance,
      subtotal, shippingCost, insuranceAmount, total,
      sellerCode, couponCode, discountAmount,
      useAffiliateCredit,
    } = req.body as {
      client: { name: string; email: string; phone: string; document: string };
      address?: {
        cep?: string; street?: string; number?: string; complement?: string;
        neighborhood?: string; city?: string; state?: string;
      };
      products?: Array<{ id: string; name: string; quantity: number; price: number }>;
      shippingType?: string;
      includeInsurance?: boolean;
      subtotal?: number;
      shippingCost?: number;
      insuranceAmount?: number;
      total: number;
      sellerCode?: string;
      couponCode?: string;
      discountAmount?: number;
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

    // ── Validate amount ───────────────────────────────────────────────────
    const amount = Number(total);
    if (!amount || amount <= 0) {
      console.warn(`[CHECKOUT/PIX:${requestId}] Validation failed — invalid amount: ${total}`);
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor inválido. Deve ser maior que zero." });
      return;
    }
    if (amount > 10000) {
      console.warn(`[CHECKOUT/PIX:${requestId}] Validation failed — amount exceeds limit: ${amount}`);
      res.status(400).json({ error: "INVALID_INPUT", message: "O valor máximo para PIX é R$10.000." });
      return;
    }

    // ── Create the order record ───────────────────────────────────────────
    const orderId = crypto.randomBytes(8).toString("hex");

    const productItems = Array.isArray(products) ? products : [];
    const productIds = Array.from(new Set(productItems.map((p) => String(p?.id || "")).filter(Boolean)));
    let productCostMap = new Map<string, number>();
    if (productIds.length > 0) {
      const costRows = await db
        .select({ id: productsTable.id, costPrice: productsTable.costPrice })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds));
      productCostMap = new Map(costRows.map((row) => [row.id, Number(row.costPrice || 0)]));
    }
    // Garante que todos os campos necessários estejam presentes e costPrice correto
    const orderProducts = productItems.map((p) => ({
      id: p.id,
      name: p.name,
      quantity: Number(p.quantity) || 0,
      price: Number(p.price) || 0,
      costPrice: productCostMap.get(String(p.id)) ?? 0,
    }));

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
      subtotal:            String(subtotal ?? amount),
      shippingCost:        String(shippingCost ?? 0),
      insuranceAmount:     String(insuranceAmount ?? 0),
      total:               String(amount),
      status:              "pending",
      paymentMethod:       "pix",
      sellerCode:          sellerCode ? String(sellerCode) : null,
      sellerCommissionRateSnapshot: String(sellerCommissionRateSnapshot),
      couponCode:          couponCode  ? String(couponCode).toUpperCase() : null,
      discountAmount:      discountAmount ? String(discountAmount) : null,
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
    if (couponCode) {
      try { await incrementCouponUse(couponCode); } catch { /* non-fatal */ }
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
