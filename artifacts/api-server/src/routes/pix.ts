import { Router, type IRouter } from "express";
import { db, ordersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { broadcastNotification } from "./notifications";
import {
  createPixCharge,
  buildCallbackUrl,
  genIdentifier,
  PIX_DURATION_MS,
  isPaymentConfirmed,
} from "../gateway";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/pix/generate
// Creates a PIX charge via the gateway and links it to an existing order.
// ---------------------------------------------------------------------------
router.post("/pix/generate", async (req, res) => {
  try {
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

    if (Number(amount) > 10000) {
      res.status(400).json({ error: "INVALID_INPUT", message: "O valor máximo para PIX é R$10.000." });
      return;
    }

    const identifier = genIdentifier();
    // Single fixed callback URL — avoids the gateway's 20-webhook registration limit.
    // The generic handler matches transactions by transactionId in the body.
    const callbackUrl = buildCallbackUrl(req as never, "/webhook/pix");
    console.log(`[PIX] Creating charge for order ${orderId || identifier} — callback: ${callbackUrl}`);

    let gatewayData;
    try {
      gatewayData = await createPixCharge({
        identifier,
        amount: Number(amount),
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
          .where(eq(ordersTable.id, orderId));
      } catch (dbErr) {
        console.error("[PIX] DB update error:", dbErr);
      }
    }

    res.json({
      transactionId: gatewayData.transactionId,
      status:        gatewayData.status,
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
    const { transactionId } = req.params;

    const rows = await db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        updatedAt: ordersTable.updatedAt,
      })
      .from(ordersTable)
      .where(eq(ordersTable.transactionId, transactionId))
      .limit(1);

    const row = rows[0];

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
    const body = req.body as { transactionId?: string; status?: string };
    console.log("[PIX] Legacy callback received:", JSON.stringify(body));

    if (body.transactionId && isPaymentConfirmed(body.status || "")) {
      await db
        .update(ordersTable)
        .set({ status: "paid", updatedAt: new Date() })
        .where(eq(ordersTable.transactionId, body.transactionId));

      broadcastNotification({
        type: "order_paid",
        data: { transactionId: body.transactionId, status: "paid" },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[PIX] Callback error:", err);
    res.json({ ok: false });
  }
});

export default router;
