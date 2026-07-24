import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db, ordersTable, siteSettingsTable, tenantSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { broadcastNotification } from "./notifications";
import {
  createPixChargeWithProvider,
  buildCallbackUrl,
  fetchDentpegDepositStatus,
  genIdentifier,
  normalizePixGatewayProvider,
  PIX_DURATION_MS,
  isPaymentConfirmed,
} from "../gateway";
import { ensureOrderCommission } from "../lib/affiliates";
import { sendOutboundWebhook } from "../lib/outbound-webhook";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";
import { enqueueFilialOrderPurchaseRequest } from "../lib/filial-purchase-queue";

const router: IRouter = Router();

const ENABLE_LEGACY_PIX_CALLBACK =
  String(process.env.ENABLE_LEGACY_PIX_CALLBACK || "false").toLowerCase() === "true";
const LEGACY_PIX_CALLBACK_TOKEN = String(process.env.LEGACY_PIX_CALLBACK_TOKEN || "").trim();

function safeTokenEquals(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

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
    console.log(`[PIX] Creating charge for order ${orderId || identifier} via ${gatewayProvider} — callback: ${callbackUrl}`);

    let gatewayData;
    try {
      gatewayData = await createPixChargeWithProvider({
        identifier,
        amount: Number(amount),
        provider: gatewayProvider,
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
        await db
          .update(ordersTable)
          .set({
            transactionId: gatewayData.transactionId,
            status: "awaiting_payment",
            updatedAt: new Date(),
          })
          .where(and(eq(ordersTable.id, orderId), eq(ordersTable.tenantId, tenantId)));
      } catch (dbErr) {
        console.error("[PIX] DB update error:", dbErr);
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
        updatedAt: ordersTable.updatedAt,
      })
      .from(ordersTable)
      .where(and(eq(ordersTable.transactionId, transactionId), eq(ordersTable.tenantId, tenantId)))
      .limit(1);

    const row = rows[0];

    // DentPeg supports status lookup; for IDs like dep_* we can refresh status live.
    if (transactionId.startsWith("dep_")) {
      const live = await fetchDentpegDepositStatus(transactionId);
      if (live?.status && row) {
        const normalized = String(live.status).toLowerCase();
        const isPaid = normalized === "depix_sent";
        const isCancelled = ["expired", "canceled", "refunded", "error"].includes(normalized);
        const nextOrderStatus = isPaid ? "paid" : isCancelled ? "cancelled" : row.status;

        if (nextOrderStatus !== row.status) {
          await db
            .update(ordersTable)
            .set({ status: nextOrderStatus, updatedAt: new Date() })
            .where(and(eq(ordersTable.id, row.id), eq(ordersTable.tenantId, tenantId)));

          if (nextOrderStatus === "paid") {
            await ensureOrderCommission(row.id);
            await enqueueFilialOrderPurchaseRequest(row.id);
          }
        }

        const status = isPaid ? "OK" : isCancelled ? "CANCELED" : "PENDING";
        res.json({ transactionId, status, paidAt: null });
        return;
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
    if (!ENABLE_LEGACY_PIX_CALLBACK) {
      res.status(410).json({
        error: "LEGACY_CALLBACK_DISABLED",
        message: "Callback legado desabilitado por segurança.",
      });
      return;
    }
    if (!safeTokenEquals(LEGACY_PIX_CALLBACK_TOKEN, token)) {
      console.warn("[PIX] Legacy callback rejected: invalid token", {
        ip: req.ip,
        ua: req.get("user-agent"),
      });
      res.status(403).json({ error: "FORBIDDEN", message: "Token inválido." });
      return;
    }

    const body = req.body as { transactionId?: string; status?: string };
    console.log("[PIX] Legacy callback received:", JSON.stringify(body));

    if (body.transactionId && isPaymentConfirmed(body.status || "")) {
      const existing = await db
        .select({ id: ordersTable.id, status: ordersTable.status })
        .from(ordersTable)
        .where(and(eq(ordersTable.transactionId, body.transactionId), eq(ordersTable.tenantId, tenantId)))
        .limit(1);

      await db
        .update(ordersTable)
        .set({ status: "paid", updatedAt: new Date() })
        .where(and(eq(ordersTable.transactionId, body.transactionId), eq(ordersTable.tenantId, tenantId)));

      if (existing[0] && existing[0].status !== "paid" && existing[0].status !== "completed") {
        await ensureOrderCommission(existing[0].id);
        await enqueueFilialOrderPurchaseRequest(existing[0].id);
      }

      broadcastNotification({
        type: "order_paid",
        data: { transactionId: body.transactionId, status: "paid", tenantId },
      });
      void sendOutboundWebhook("order_paid", {
        transactionId: body.transactionId,
        status: "paid",
        source: "legacy_pix_callback",
      }, { tenantId });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[PIX] Callback error:", err);
    res.json({ ok: false });
  }
});

export default router;
