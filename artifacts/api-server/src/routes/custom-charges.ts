import { Router, type IRouter } from "express";
import { db, customChargesTable, ordersTable } from "@workspace/db";
import { desc, and, gte, lte, eq } from "drizzle-orm";
import crypto from "crypto";
import { requireAdminAuth } from "./admin-auth";
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
// POST /api/custom-charges  (public)
// Create a custom PIX charge (payment link page).
// ---------------------------------------------------------------------------
router.post("/custom-charges", async (req, res) => {
  const requestId = Math.random().toString(36).slice(2, 9).toUpperCase();
  const t0 = Date.now();
  console.log(`[CustomCharge:${requestId}] ===== Incoming POST /api/custom-charges =====`);
  console.log(`[CustomCharge:${requestId}] Time: ${new Date().toISOString()}`);
  console.log(`[CustomCharge:${requestId}] Body:`, JSON.stringify(req.body));

  try {
    const { client, address, amount, description, sellerCode } = req.body as {
      client: { name: string; email: string; phone: string; document: string };
      address?: {
        cep?: string; street?: string; number?: string; complement?: string;
        neighborhood?: string; city?: string; state?: string;
      };
      amount: number;
      description?: string;
      sellerCode?: string;
    };

    if (!client?.name || !client?.email || !client?.phone || !client?.document) {
      console.log(`[CustomCharge:${requestId}] Validation FAILED — missing fields`);
      res.status(400).json({ error: "INVALID_INPUT", message: "Nome, e-mail, telefone e CPF são obrigatórios." });
      return;
    }

    if (!amount || Number(amount) <= 0) {
      console.log(`[CustomCharge:${requestId}] Validation FAILED — invalid amount: ${amount}`);
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor inválido." });
      return;
    }

    if (Number(amount) > 10000) {
      console.log(`[CustomCharge:${requestId}] Validation FAILED — amount too large: ${amount}`);
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor máximo é R$10.000." });
      return;
    }

    console.log(`[CustomCharge:${requestId}] Validation OK — client=${client.name} amount=${amount} seller=${sellerCode || "none"}`);

    const id = crypto.randomBytes(8).toString("hex");
    const identifier = genIdentifier();
    // Single fixed callback URL — avoids the gateway's 20-webhook registration limit.
    // The generic handler matches transactions by transactionId in the body.
    const callbackUrl = buildCallbackUrl(req as never, "/webhook/pix");

    console.log(`[CustomCharge:${requestId}] Calling gateway — id=${id} identifier=${identifier} amount=${Number(amount)} callbackUrl=${callbackUrl}`);

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
        metadata: { chargeId: id, description: description || "" },
        callbackUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao gerar PIX.";
      console.error(`[CustomCharge:${requestId}] Gateway ERROR — ${msg} (${Date.now() - t0}ms)`);
      res.status(400).json({ error: "GATEWAY_ERROR", message: msg });
      return;
    }

    console.log(`[CustomCharge:${requestId}] Gateway OK — txId=${gatewayData.transactionId} (${Date.now() - t0}ms)`);

    await db.insert(customChargesTable).values({
      id,
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
      description:         description || null,
      sellerCode:          sellerCode  || null,
      amount:              String(amount),
      status:              "awaiting_payment",
      transactionId:       gatewayData.transactionId,
    });

    broadcastNotification({
      type: "new_charge",
      data: { id, clientName: client.name, amount, createdAt: new Date().toISOString() },
    });

    const expiresAt = new Date(Date.now() + PIX_DURATION_MS).toISOString();

    console.log(`[CustomCharge:${requestId}] SUCCESS — id=${id} txId=${gatewayData.transactionId} total=${Date.now() - t0}ms`);

    res.status(201).json({
      id,
      transactionId: gatewayData.transactionId,
      pixCode:   gatewayData.pix?.code   || "",
      pixBase64: gatewayData.pix?.base64 || "",
      pixImage:  gatewayData.pix?.image  || "",
      expiresAt,
      status: "awaiting_payment",
    });
  } catch (err) {
    console.error(`[CustomCharge:${requestId}] INTERNAL ERROR (${Date.now() - t0}ms):`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno. Tente novamente." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/custom-charges/status/:transactionId  (public)
// Returns the charge status from the local database only.
// Payment confirmation is handled exclusively by the webhook (POST /api/webhook/pix).
// The gateway blocks server-side polling ("Tentativa de polling bloqueada!"),
// so the DB is the sole source of truth for payment status.
// ---------------------------------------------------------------------------
router.get("/custom-charges/status/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;

    const rows = await db
      .select({ id: customChargesTable.id, status: customChargesTable.status })
      .from(customChargesTable)
      .where(eq(customChargesTable.transactionId, transactionId))
      .limit(1);

    const row = rows[0];

    const dbStatusMap: Record<string, string> = {
      paid:             "OK",
      awaiting_payment: "PENDING",
      pending:          "PENDING",
      cancelled:        "CANCELED",
    };

    const status = row ? (dbStatusMap[row.status] ?? "PENDING") : "PENDING";
    res.json({ transactionId, status });
  } catch (err) {
    console.error("[CustomCharge] status error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao consultar status." });
  }
});

// ---------------------------------------------------------------------------
// Legacy callback (kept for backward compat)
// ---------------------------------------------------------------------------
router.post("/custom-charges/callback/:token/:chargeId", async (req, res) => {
  try {
    const { chargeId } = req.params;
    const body = req.body as { transactionId?: string; status?: string };
    console.log("[CustomCharge] Legacy callback:", JSON.stringify(body));

    if (isPaymentConfirmed(body.status || "")) {
      const existing = await db
        .select({ id: customChargesTable.id, status: customChargesTable.status, orderId: customChargesTable.orderId, amount: customChargesTable.amount })
        .from(customChargesTable)
        .where(eq(customChargesTable.id, chargeId))
        .limit(1);

      if (existing[0] && existing[0].status !== "paid") {
        await db
          .update(customChargesTable)
          .set({ status: "paid", updatedAt: new Date() })
          .where(eq(customChargesTable.id, chargeId));

        broadcastNotification({ type: "charge_paid", data: { id: chargeId } });

        // Propagate to parent order if this is a diff charge
        if (existing[0].orderId) {
          const parentOrder = await db
            .select({ id: ordersTable.id, status: ordersTable.status, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
            .from(ordersTable)
            .where(eq(ordersTable.id, existing[0].orderId))
            .limit(1);

          if (parentOrder[0] && parentOrder[0].status === "awaiting_payment") {
            const orderTotal  = Number(parentOrder[0].total ?? 0);
            const alreadyPaid = Number(parentOrder[0].paidAmount ?? 0);
            const diffPaid    = Number(existing[0].amount ?? 0);
            const totalPaid   = alreadyPaid + diffPaid;
            const newOrderStatus = totalPaid >= orderTotal - 0.01 ? "paid" : "awaiting_payment";

            await db
              .update(ordersTable)
              .set({ status: newOrderStatus, paidAmount: String(totalPaid), updatedAt: new Date() })
              .where(eq(ordersTable.id, existing[0].orderId));

            broadcastNotification({ type: "order_paid", data: { id: existing[0].orderId, status: newOrderStatus } });
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[CustomCharge] Callback error:", err);
    res.json({ ok: false });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/custom-charges  (protected)
// ---------------------------------------------------------------------------
router.get("/admin/custom-charges", requireAdminAuth, async (req, res) => {
  try {
    const { dateFrom, dateTo, status, sellerCode } = req.query as Record<string, string>;
    const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
    const conditions = [];

    if (dateFrom) {
      const from = new Date(dateFrom + "T00:00:00.000Z");
      from.setTime(from.getTime() + SP_OFFSET_MS);
      conditions.push(gte(customChargesTable.createdAt, from));
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59.999Z");
      to.setTime(to.getTime() + SP_OFFSET_MS);
      conditions.push(lte(customChargesTable.createdAt, to));
    }
    if (status && status !== "all") {
      conditions.push(eq(customChargesTable.status, status));
    }
    if (sellerCode && sellerCode !== "all") {
      conditions.push(eq(customChargesTable.sellerCode, sellerCode));
    }

    const charges = await db
      .select()
      .from(customChargesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(customChargesTable.createdAt));

    res.json({
      charges: charges.map((c) => {
        let proofUrls: string[] = [];
        if (c.proofUrls) {
          try { proofUrls = JSON.parse(c.proofUrls); } catch { proofUrls = []; }
        }
        if (c.proofUrl && !proofUrls.includes(c.proofUrl)) {
          proofUrls = [c.proofUrl, ...proofUrls];
        }
        return {
          id:                  c.id,
          clientName:          c.clientName,
          clientEmail:         c.clientEmail,
          clientPhone:         c.clientPhone,
          clientDocument:      c.clientDocument,
          addressCep:          c.addressCep,
          addressStreet:       c.addressStreet,
          addressNumber:       c.addressNumber,
          addressComplement:   c.addressComplement,
          addressNeighborhood: c.addressNeighborhood,
          addressCity:         c.addressCity,
          addressState:        c.addressState,
          description:         c.description,
          sellerCode:          c.sellerCode ?? null,
          amount:              Number(c.amount),
          status:              c.status,
          transactionId:       c.transactionId,
          proofUrl:            c.proofUrl ?? null,
          proofUrls,
          observation:         c.observation ?? null,
          createdAt:           c.createdAt?.toISOString() ?? new Date().toISOString(),
        };
      }),
    });
  } catch (err) {
    console.error("[CustomCharge] admin list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar cobranças." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/custom-charges/export  (protected)
// ---------------------------------------------------------------------------
router.get("/admin/custom-charges/export", requireAdminAuth, async (req, res) => {
  try {
    const { dateFrom, dateTo, status } = req.query as Record<string, string>;
    const conditions = [];

    if (dateFrom) {
      // SP = UTC-3: midnight SP = 03:00 UTC
      const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
      const from = new Date(dateFrom + "T00:00:00.000Z");
      from.setTime(from.getTime() + SP_OFFSET_MS);
      conditions.push(gte(customChargesTable.createdAt, from));
    }
    if (dateTo) {
      const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
      const to = new Date(dateTo + "T23:59:59.999Z");
      to.setTime(to.getTime() + SP_OFFSET_MS);
      conditions.push(lte(customChargesTable.createdAt, to));
    }
    if (status && status !== "all") {
      conditions.push(eq(customChargesTable.status, status));
    }

    const charges = await db
      .select()
      .from(customChargesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(customChargesTable.createdAt));

    const header = "ID;Data;Cliente;Email;Telefone;CPF;Descrição;Vendedor;Valor;Status;Transação";
    const rows = charges.map((c) => [
      c.id,
      c.createdAt?.toLocaleString("pt-BR") ?? "",
      c.clientName,
      c.clientEmail,
      c.clientPhone,
      c.clientDocument,
      `"${c.description || ""}"`,
      c.sellerCode ?? "",
      c.amount,
      c.status,
      c.transactionId ?? "",
    ].join(";"));

    const csv = [header, ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cobranças-${Date.now()}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (err) {
    console.error("[CustomCharge] export error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao exportar." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/custom-charges/:id/status  (protected)
// Manually update a charge status (paid / cancelled / etc).
// ---------------------------------------------------------------------------
router.patch("/admin/custom-charges/:id/status", requireAdminAuth, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { status } = req.body as { status: string };

    const allowed = ["paid", "cancelled", "awaiting_payment", "pending"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "INVALID_STATUS" });
      return;
    }

    const existing = await db
      .select({ status: customChargesTable.status, orderId: customChargesTable.orderId, amount: customChargesTable.amount })
      .from(customChargesTable)
      .where(eq(customChargesTable.id, id))
      .limit(1);

    await db
      .update(customChargesTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(customChargesTable.id, id));

    if (status === "paid") {
      broadcastNotification({ type: "charge_paid", data: { id, status } });

      // Propagate to parent order if this is a diff charge
      if (existing[0]?.orderId && existing[0].status !== "paid") {
        const parentOrder = await db
          .select({ id: ordersTable.id, status: ordersTable.status, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
          .from(ordersTable)
          .where(eq(ordersTable.id, existing[0].orderId))
          .limit(1);

        if (parentOrder[0] && parentOrder[0].status === "awaiting_payment") {
          const orderTotal  = Number(parentOrder[0].total ?? 0);
          const alreadyPaid = Number(parentOrder[0].paidAmount ?? 0);
          const diffPaid    = Number(existing[0].amount ?? 0);
          const totalPaid   = alreadyPaid + diffPaid;
          const newOrderStatus = totalPaid >= orderTotal - 0.01 ? "paid" : "awaiting_payment";

          await db
            .update(ordersTable)
            .set({ status: newOrderStatus, paidAmount: String(totalPaid), updatedAt: new Date() })
            .where(eq(ordersTable.id, existing[0].orderId));

          broadcastNotification({ type: "order_paid", data: { id: existing[0].orderId, status: newOrderStatus } });
        }
      }
    }

    res.json({ ok: true, status });
  } catch (err) {
    console.error("[CustomCharge] status update error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/custom-charges/:id/proof  (protected)
// Upload proof of payment (base64 data URL).
// ---------------------------------------------------------------------------
router.patch("/admin/custom-charges/:id/proof", requireAdminAuth, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { proofData } = req.body as { proofData: string };

    if (!proofData || !proofData.startsWith("data:")) {
      res.status(400).json({ error: "INVALID_PROOF" });
      return;
    }

    const existing = await db
      .select({ proofUrl: customChargesTable.proofUrl, proofUrls: customChargesTable.proofUrls })
      .from(customChargesTable)
      .where(eq(customChargesTable.id, id))
      .limit(1);

    let urls: string[] = [];
    if (existing[0]?.proofUrls) {
      try { urls = JSON.parse(existing[0].proofUrls); } catch { urls = []; }
    }
    if (existing[0]?.proofUrl && !urls.includes(existing[0].proofUrl)) {
      urls.unshift(existing[0].proofUrl);
    }
    if (!urls.includes(proofData)) urls.push(proofData);

    await db
      .update(customChargesTable)
      .set({ proofUrl: proofData, proofUrls: JSON.stringify(urls), status: "paid", updatedAt: new Date() })
      .where(eq(customChargesTable.id, id));

    broadcastNotification({ type: "charge_paid", data: { id, status: "paid" } });

    res.json({ ok: true, proofUrls: urls });
  } catch (err) {
    console.error("[CustomCharge] proof upload error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/custom-charges/:id/observation  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/custom-charges/:id/observation", requireAdminAuth, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { observation } = req.body as { observation?: string };
    await db
      .update(customChargesTable)
      .set({ observation: observation?.trim() || null, updatedAt: new Date() })
      .where(eq(customChargesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[CustomCharge] observation update error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
