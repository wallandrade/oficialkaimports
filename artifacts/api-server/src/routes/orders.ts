import { Router, type IRouter } from "express";
import { db, ordersTable, customChargesTable, sellersTable, productsTable } from "@workspace/db";
import { desc, and, gte, lte, eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAdminAuth } from "./admin-auth";
import { broadcastNotification } from "./notifications";
import { incrementCouponUse } from "./coupons";
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

const router: IRouter = Router();

function buildGuestAccessToken(): string {
  return crypto.randomBytes(24).toString("hex");
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
    const customerSession = getCustomerSession(req);
    const guestAccessToken = customerSession ? null : buildGuestAccessToken();

    const {
      client, address, products, shippingType, includeInsurance,
      subtotal, shippingCost, insuranceAmount, total,
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

    if (!client || !products || !shippingType || total == null) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Campos obrigatórios ausentes." });
      return;
    }

    const id     = crypto.randomBytes(8).toString("hex");
    const method = paymentMethod || "pix";

    const productItems = Array.isArray(products) ? products : [];
    const productIds = Array.from(new Set(productItems.map((p: { id?: string }) => String(p?.id || "")).filter(Boolean)));
    let productCostMap = new Map<string, number>();
    if (productIds.length > 0) {
      const costRows = await db
        .select({ id: productsTable.id, costPrice: productsTable.costPrice })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds));
      productCostMap = new Map(costRows.map((row) => [row.id, Number(row.costPrice || 0)]));
    }
    const orderProducts = productItems.map((p: { id: string }) => ({
      ...p,
      costPrice: productCostMap.get(String(p.id)) ?? 0,
    }));

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
      subtotal:          String(subtotal),
      shippingCost:      String(shippingCost),
      insuranceAmount:   String(insuranceAmount),
      total:             String(total),
      status:            method === "card_simulation" ? "awaiting_payment" : "pending",
      paymentMethod:     method,
      cardInstallments:  cardInstallments ? Number(cardInstallments) : null,
      sellerCode:        sellerCode ? String(sellerCode) : null,
      sellerCommissionRateSnapshot: String(sellerCommissionRateSnapshot),
      couponCode:        req.body.couponCode ? String(req.body.couponCode).toUpperCase() : null,
      discountAmount:    req.body.discountAmount ? String(req.body.discountAmount) : null,
    });

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
        total,
        paymentMethod: method,
        sellerCode: sellerCode || null,
        createdAt: new Date().toISOString(),
      },
    });

    res.status(201).json({
      id, client, address: address || null, products: orderProducts, shippingType,
      includeInsurance: Boolean(includeInsurance),
      subtotal, shippingCost, insuranceAmount, total,
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
    if (sellerCode && sellerCode !== "all") conditions.push(eq(ordersTable.sellerCode, sellerCode));

    const orders = await db
      .select()
      .from(ordersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ordersTable.createdAt));

    res.json({ orders: orders.map(mapOrder) });
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
        .where(eq(ordersTable.id, id))
        .limit(1);
      const wasAlreadyPaid = existing[0]?.status === "paid" || existing[0]?.status === "completed";
      if (!wasAlreadyPaid && existing[0]?.couponCode) {
        couponCodeToIncrement = existing[0].couponCode;
      }
      // Record the paid amount (the current total at the time of payment confirmation)
      if (!existing[0]?.paidAmount && existing[0]?.total) {
        updates.paidAmount = existing[0].total;
      }
    }

    await db.update(ordersTable).set(updates).where(eq(ordersTable.id, id));

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
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { observation } = req.body as { observation?: string };
    await db.update(ordersTable)
      .set({ observation: observation?.trim() || null, updatedAt: new Date() })
      .where(eq(ordersTable.id, id));
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
      .where(eq(ordersTable.id, id))
      .limit(1);

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
      .where(eq(ordersTable.id, id));

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
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { products: newProducts, subtotal, total } = req.body as {
      products: Array<{ id: string; name: string; quantity: number; price: number }>;
      subtotal: number;
      total: number;
    };

    if (!newProducts || !Array.isArray(newProducts) || newProducts.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Produtos inválidos." });
      return;
    }

    // Read current order to decide if status should change
    const current = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
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

    await db.update(ordersTable)
      .set({ products: newProducts, subtotal: String(subtotal), total: String(total), status: newStatus, updatedAt: new Date() })
      .where(eq(ordersTable.id, id));

    const updated = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
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
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { amount, description } = req.body as { amount: number; description?: string };

    if (!amount || amount <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor inválido." });
      return;
    }

    const orders = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
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
    if (sellerCode && sellerCode !== "all") conditions.push(eq(ordersTable.sellerCode, sellerCode));

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
  };
}

export default router;
