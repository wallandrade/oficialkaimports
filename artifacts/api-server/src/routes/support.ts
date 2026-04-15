import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, ordersTable, supportTicketsTable } from "@workspace/db";
import { requireAdminAuth } from "./admin-auth";
import { broadcastNotification } from "./notifications";

const router: IRouter = Router();

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizedDocumentSql(column: typeof ordersTable.clientDocument) {
  return sql<string>`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${column}, '.', ''), '-', ''), '/', ''), ' ', ''), '\t', '')`;
}

function getOrderProducts(raw: unknown): Array<{ name?: string; quantity?: number }> {
  if (Array.isArray(raw)) return raw as Array<{ name?: string; quantity?: number }>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Array<{ name?: string; quantity?: number }>) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// POST /api/support/orders-by-cpf
// ---------------------------------------------------------------------------
router.post("/support/orders-by-cpf", async (req, res) => {
  try {
    const cpf = onlyDigits(req.body?.cpf);
    if (cpf.length !== 11) {
      res.status(400).json({ error: "INVALID_INPUT", message: "CPF invalido." });
      return;
    }

    const rows = await db
      .select({
        id: ordersTable.id,
        clientName: ordersTable.clientName,
        total: ordersTable.total,
        status: ordersTable.status,
        createdAt: ordersTable.createdAt,
        products: ordersTable.products,
      })
      .from(ordersTable)
      .where(
        and(
          inArray(ordersTable.status, ["paid", "completed"]),
          sql`${normalizedDocumentSql(ordersTable.clientDocument)} = ${cpf}`,
        ),
      )
      .orderBy(desc(ordersTable.createdAt))
      .limit(30);

    const orders = rows.map((row) => ({
      id: row.id,
      clientName: row.clientName,
      total: Number(row.total),
      status: row.status,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
      products: getOrderProducts(row.products).map((p) => ({
        name: String(p?.name ?? "Produto"),
        quantity: Number(p?.quantity) || 0,
      })),
    }));

    res.json({ orders });
  } catch (err) {
    console.error("Support cpf lookup error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao localizar pedidos." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/support/tickets
// ---------------------------------------------------------------------------
router.post("/support/tickets", async (req, res) => {
  try {
    const cpf = onlyDigits(req.body?.cpf);
    const orderId = String(req.body?.orderId ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    const imageData = req.body?.imageData == null ? null : String(req.body.imageData);

    if (cpf.length !== 11 || !orderId || description.length < 10) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Dados invalidos para abertura do chamado." });
      return;
    }

    if (description.length > 3000) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Descricao muito longa." });
      return;
    }

    if (imageData && (!imageData.startsWith("data:image/") || imageData.length > 8 * 1024 * 1024)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Imagem invalida. Envie PNG/JPG ate 5MB." });
      return;
    }

    const orderRows = await db
      .select({
        id: ordersTable.id,
        clientName: ordersTable.clientName,
        total: ordersTable.total,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.id, orderId),
          sql`${normalizedDocumentSql(ordersTable.clientDocument)} = ${cpf}`,
        ),
      )
      .limit(1);

    const order = orderRows[0];
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido nao encontrado para este CPF." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    await db.insert(supportTicketsTable).values({
      id,
      orderId: order.id,
      clientDocument: cpf,
      clientName: order.clientName,
      description,
      imageUrl: imageData,
      status: "open",
      orderTotal: String(order.total),
      orderCreatedAt: order.createdAt,
      updatedAt: new Date(),
    });

    broadcastNotification({
      type: "support_ticket_created",
      data: { id, orderId: order.id, clientName: order.clientName },
    });

    res.status(201).json({ ok: true, ticketId: id });
  } catch (err) {
    console.error("Support ticket create error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao abrir chamado de suporte." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/support-tickets
// ---------------------------------------------------------------------------
router.get("/admin/support-tickets", requireAdminAuth, async (req, res) => {
  try {
    const status = String(req.query?.status ?? "all");
    const whereClause = status === "all" ? undefined : eq(supportTicketsTable.status, status);

    const rows = await db
      .select()
      .from(supportTicketsTable)
      .where(whereClause)
      .orderBy(desc(supportTicketsTable.createdAt));

    const tickets = rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      clientDocument: row.clientDocument,
      clientName: row.clientName,
      description: row.description,
      imageUrl: row.imageUrl,
      status: row.status,
      orderTotal: row.orderTotal == null ? null : Number(row.orderTotal),
      orderCreatedAt: row.orderCreatedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
    }));

    res.json({ tickets });
  } catch (err) {
    console.error("Support tickets list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar chamados." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/support-tickets/:id/status
// ---------------------------------------------------------------------------
router.patch("/admin/support-tickets/:id/status", requireAdminAuth, async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();
    const status = String(req.body?.status ?? "").trim();
    if (!id || !["open", "resolved"].includes(status)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Status invalido." });
      return;
    }

    const rows = await db.select({ id: supportTicketsTable.id }).from(supportTicketsTable).where(eq(supportTicketsTable.id, id)).limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Chamado nao encontrado." });
      return;
    }

    await db.update(supportTicketsTable)
      .set({
        status,
        resolvedAt: status === "resolved" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(supportTicketsTable.id, id));

    res.json({ ok: true, id, status });
  } catch (err) {
    console.error("Support ticket status update error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar chamado." });
  }
});

export default router;
