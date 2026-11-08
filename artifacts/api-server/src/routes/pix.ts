import { Router, type IRouter } from "express";
import { db, ordersTable, siteSettingsTable, tenantSettingsTable } from "@workspace/db";
import { and, eq, notInArray } from "drizzle-orm";
import { broadcastNotification } from "./notifications";
import {
  createPixChargeWithProvider,
  buildCallbackUrl,
  fetchDentpegDepositStatus,
  genIdentifier,
  normalizePixGatewayProvider,
  PIX_DURATION_MS,
} from "../gateway";
import {
  decidePixSettlement,
  legacyPixCallbackGate,
  moneyEquals,
  pixNoticeLogFields,
  readPixNotice,
  regeneratePixChargeDecision,
  safeTokenEquals,
  updatedRowCount,
} from "../lib/pix-settlement";
import { ensureOrderCommission } from "../lib/affiliates";
import { sendOutboundWebhook } from "../lib/outbound-webhook";
import { scheduleOrderPaidWhatsapp } from "../lib/whatsapp-n8n";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";
import { enqueueFilialOrderPurchaseRequest } from "../lib/filial-purchase-queue";
import { allocateOrderLogistics } from "../lib/order-logistics";

const router: IRouter = Router();

const ENABLE_LEGACY_PIX_CALLBACK =
  String(process.env.ENABLE_LEGACY_PIX_CALLBACK || "false").toLowerCase() === "true";
const LEGACY_PIX_CALLBACK_TOKEN = String(process.env.LEGACY_PIX_CALLBACK_TOKEN || "").trim();


async function getActivePixGateway(tenantId: string): Promise<"appcnpay" | "dentpeg"> {
  const tenantRow = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, "checkout_pix_gateway")))
    .limit(1);

  if (tenantRow[0]?.value != null) {
    return normalizePixGatewayProvider(tenantRow[0].value);
  }

  const legacyRow = tenantId === DEFAULT_TENANT_ID
    ? await db
      .select({ value: siteSettingsTable.value })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.key, "checkout_pix_gateway"))
      .limit(1)
    : [];

  return normalizePixGatewayProvider(legacyRow[0]?.value);
}

// ---------------------------------------------------------------------------
// POST /api/pix/generate
// Creates a PIX charge via the gateway and links it to an existing order.
// ---------------------------------------------------------------------------
router.post("/pix/generate", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req as any);
    const { client, amount, shippingType, includeInsurance, orderId } = req.body as {
      client: { name: string; email: string; phone: string; document: string };
      amount: number;
      shippingType?: string;
      includeInsurance?: boolean;
      orderId?: string;
    };

    if (!client?.name || !client?.email || !client?.phone || !client?.document) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Nome, e-mail, telefone e CPF são obrigatórios." });
      return;
    }

    if (!amount || Number(amount) <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor inválido. Deve ser maior que zero." });
      return;
    }

    const gatewayProvider = await getActivePixGateway(tenantId);
    const identifier = genIdentifier();
    // Single fixed callback URL — avoids the gateway's 20-webhook registration limit.
    // The generic handler matches transactions by transactionId in the body.
    const webhookSecret = String(process.env.WEBHOOK_SHARED_SECRET || "").trim();
    const callbackBase = buildCallbackUrl(req as never, "/webhook/pix");
    const callbackUrl = webhookSecret
      ? `${callbackBase}${callbackBase.includes("?") ? "&" : "?"}whsec=${encodeURIComponent(webhookSecret)}`
      : callbackBase;
    if (!orderId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Pedido obrigatório para gerar o PIX." });
      return;
    }

    const [order] = await db
      .select({ id: ordersTable.id, status: ordersTable.status, total: ordersTable.total })
      .from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.tenantId, tenantId)))
      .limit(1);
    const chargeDecision = regeneratePixChargeDecision({
      orderFound: Boolean(order),
      orderStatus: order?.status || "",
      orderTotal: Number(order?.total ?? 0),
      clientAmount: Number(amount),
    });
    if (!chargeDecision.ok) {
      res.status(chargeDecision.httpStatus).json({ error: "PIX_AMOUNT_REJECTED", message: "O valor do PIX precisa ser o total do pedido." });
      return;
    }

    console.log(`[PIX] Creating charge for order ${orderId} via ${gatewayProvider} amount=${chargeDecision.chargeAmount}`);

    let gatewayData;
    try {
      gatewayData = await createPixChargeWithProvider({
        identifier,
        amount: chargeDecision.chargeAmount,
        provider: gatewayProvider,
        tenantId,
        client: {
          name:     client.name,
          email:    client.email,
          phone:    client.phone,
          document: client.document,
        },
        metadata: {
          orderId:          orderId || identifier,
          shippingType:     shippingType || "normal",
          includeInsurance: String(includeInsurance ?? false),
        },
        callbackUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao gerar pagamento PIX.";
      res.status(400).json({ error: "GATEWAY_ERROR", message: msg });
      return;
    }

    const expiresAt = new Date(Date.now() + PIX_DURATION_MS).toISOString();

    // Update the order record with the transaction ID
    if (orderId) {
      try {
        const linked = await db
          .update(ordersTable)
          .set({
            transactionId: gatewayData.transactionId,
            status: "awaiting_payment",
            updatedAt: new Date(),
          })
          .where(and(
            eq(ordersTable.id, orderId),
            eq(ordersTable.tenantId, tenantId),
            notInArray(ordersTable.status, ["paid", "completed"]),
          ));
        if (updatedRowCount(linked) < 1) {
          res.status(409).json({ error: "PIX_AMOUNT_REJECTED", message: "O pedido já foi pago." });
          return;
        }
      } catch (dbErr) {
        console.error("[PIX] DB update error");
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno ao gerar pagamento. Tente novamente." });
        return;
      }
    }

    res.json({
      transactionId: gatewayData.transactionId,
      status:        gatewayData.status,
      gatewayProvider: gatewayData.gatewayProvider || gatewayProvider,
      pixCode:       gatewayData.pix?.code   || "",
      pixBase64:     gatewayData.pix?.base64 || "",
      pixImage:      gatewayData.pix?.image  || "",
      expiresAt,
      orderId:       orderId || identifier,
      receiptUrl:    gatewayData.order?.receiptUrl || null,
    });
  } catch (err) {
    console.error("[PIX] generate error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno ao gerar pagamento. Tente novamente." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pix/status/:transactionId
// Returns the order status from the local database only.
// Payment confirmation is handled exclusively by the webhook (POST /api/webhook/pix).
// The gateway blocks server-side polling ("Tentativa de polling bloqueada!"),
// so the DB is the sole source of truth for payment status.
// ---------------------------------------------------------------------------
router.get("/pix/status/:transactionId", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req as any);
    const { transactionId } = req.params;

    const rows = await db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        total: ordersTable.total,
        updatedAt: ordersTable.updatedAt,
      })
      .from(ordersTable)
      .where(and(eq(ordersTable.transactionId, transactionId), eq(ordersTable.tenantId, tenantId)))
      .limit(1);

    const row = rows[0];

    // DentPeg supports status lookup; for IDs like dep_* we can refresh status live.
    // The browser does not send the status. Amount is required because the GET
    // contract in this repo includes amountInCents on the deposit object.
    if (transactionId.startsWith("dep_") && row && row.status !== "paid" && row.status !== "completed") {
      const live = await fetchDentpegDepositStatus(transactionId);
      const normalized = String(live?.status || "").toLowerCase();
      const isPaid = normalized === "depix_sent";
      const isCancelled = ["expired", "canceled", "refunded", "error"].includes(normalized);
      const amountOk = live?.amountInCents != null && moneyEquals(live.amountInCents / 100, Number(row.total ?? 0));
      if (isPaid && !amountOk) {
        console.warn("[PIX] DentPeg status ignored: amount missing or different");
      } else if (live && (isCancelled || (isPaid && amountOk))) {
        const nextOrderStatus = isPaid ? "paid" : "cancelled";
        const updated = await db
          .update(ordersTable)
          .set({ status: nextOrderStatus, ...(isPaid ? { paidAmount: row.total } : {}), updatedAt: new Date() })
          .where(and(
            eq(ordersTable.id, row.id),
            eq(ordersTable.tenantId, tenantId),
            notInArray(ordersTable.status, ["paid", "completed"]),
          ));
        if (isPaid && updatedRowCount(updated) > 0) {
          await ensureOrderCommission(row.id);
          await enqueueFilialOrderPurchaseRequest(row.id);
          row.status = "paid";
        } else if (!isPaid && updatedRowCount(updated) > 0) {
          row.status = "cancelled";
        }
      }
    }

    const dbStatusMap: Record<string, string> = {
      paid:             "OK",
      completed:        "OK",
      awaiting_payment: "PENDING",
      pending:          "PENDING",
      cancelled:        "CANCELED",
    };

    const status = row ? (dbStatusMap[row.status] ?? "PENDING") : "PENDING";
    res.json({
      transactionId,
      status,
      paidAt: null,
    });
  } catch (err) {
    console.error("[PIX] status error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao consultar status." });
  }
});

// ---------------------------------------------------------------------------
// Legacy callback route (kept for backward compat)
// ---------------------------------------------------------------------------
router.post("/pix/callback/:token", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req as any);
    const token = String(req.params.token || "").trim();
    const gate = legacyPixCallbackGate({
      enabled: ENABLE_LEGACY_PIX_CALLBACK,
      tokenMatches: safeTokenEquals(LEGACY_PIX_CALLBACK_TOKEN, token),
    });
    if (gate) {
      res.status(gate.httpStatus).json({ ok: false, error: gate.reason });
      return;
    }

    const notice = readPixNotice(req.body);
    console.log("[PIX] Legacy callback", JSON.stringify(pixNoticeLogFields(notice)));
    if (!notice.transactionId) {
      res.status(403).json({ ok: false, error: "missing_transaction" });
      return;
    }

    const existing = await db
      .select({ id: ordersTable.id, status: ordersTable.status, total: ordersTable.total, transactionId: ordersTable.transactionId })
      .from(ordersTable)
      .where(and(eq(ordersTable.transactionId, notice.transactionId), eq(ordersTable.tenantId, tenantId)))
      .limit(1);
    const row = existing[0];
    if (!row?.transactionId) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }

    const decision = decidePixSettlement({
      authenticated: true,
      transactionId: notice.transactionId,
      boundTransactionId: row.transactionId,
      status: notice.status,
      reportedAmount: notice.amount,
      expectedAmount: Number(row.total ?? 0),
      currency: notice.currency,
      alreadySettled: row.status === "paid" || row.status === "completed",
    });
    if (decision.action !== "pay") {
      res.status(decision.httpStatus).json({ ok: decision.action !== "reject", reason: decision.reason });
      return;
    }

    const updated = await db
      .update(ordersTable)
      .set({ status: "paid", paidAmount: row.total, updatedAt: new Date() })
      .where(and(
        eq(ordersTable.id, row.id),
        eq(ordersTable.tenantId, tenantId),
        notInArray(ordersTable.status, ["paid", "completed"]),
      ));
    if (updatedRowCount(updated) > 0) {
      await ensureOrderCommission(row.id);
      await enqueueFilialOrderPurchaseRequest(row.id);
      scheduleOrderPaidWhatsapp(row.id);
      await allocateOrderLogistics(row.id);
      broadcastNotification({
        type: "order_paid",
        data: { transactionId: notice.transactionId, status: "paid", tenantId },
      });
      void sendOutboundWebhook("order_paid", {
        transactionId: notice.transactionId,
        status: "paid",
        source: "legacy_pix_callback",
      }, { tenantId });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[PIX] Callback failed");
    res.status(500).json({ ok: false });
  }
});

export default router;
