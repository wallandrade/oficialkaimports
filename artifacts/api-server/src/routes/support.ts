import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, ordersTable, supportTicketsTable } from "@workspace/db";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { broadcastNotification } from "./notifications";
import { createOrRefreshReshipment } from "../lib/reshipments";

const router: IRouter = Router();

function normalizeSellerCode(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function getSupportAdminScope(req: Parameters<typeof router.get>[1] extends (req: infer R, _res: infer _S) => unknown ? R : never, res: Parameters<typeof router.get>[1] extends (_req: infer _R, res: infer S) => unknown ? S : never) {
  const scope = getAdminScope(req as never);
  if (!scope) {
    (res as any).status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return null;
  }
  if (!scope.hasGlobalAccess && !scope.sellerCode) {
    (res as any).status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
    return null;
  }
  return { hasGlobalAccess: scope.hasGlobalAccess, sellerCode: normalizeSellerCode(scope.sellerCode) };
}

async function ticketBelongsToScope(orderId: string, scope: { hasGlobalAccess: boolean; sellerCode: string | null }): Promise<boolean> {
  if (scope.hasGlobalAccess) return true;
  const rows = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.sellerCode, scope.sellerCode!)))
    .limit(1);
  return !!rows[0];
}

type AddressChangePayload = {
  cep: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
};

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizedDocumentSql(column: typeof ordersTable.clientDocument) {
  return sql<string>`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${column}, '.', ''), '-', ''), '/', ''), ' ', ''), '\t', '')`;
}

function maskName(raw: string | null | undefined): string {
  const source = String(raw ?? "").trim();
  if (!source) return "Cliente";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    if (parts[0].length <= 2) return parts[0][0] + "*";
    return parts[0].slice(0, 2) + "*".repeat(Math.max(1, parts[0].length - 2));
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  const firstMasked = first.length <= 2 ? first[0] + "*" : first.slice(0, 2) + "*".repeat(Math.max(1, first.length - 2));
  const lastMasked = last.length <= 1 ? "*" : "*" + last.slice(1);
  return `${firstMasked} ${lastMasked}`;
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

function normalizeAddressChange(raw: unknown): AddressChangePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;

  const cepDigits = String(source.cep ?? "").replace(/\D/g, "");
  const street = String(source.street ?? "").trim();
  const number = String(source.number ?? "").trim();
  const complement = String(source.complement ?? "").trim();
  const neighborhood = String(source.neighborhood ?? "").trim();
  const city = String(source.city ?? "").trim();
  const state = String(source.state ?? "").trim().toUpperCase();

  if (!cepDigits && !street && !number && !neighborhood && !city && !state && !complement) {
    return null;
  }

  if (!street || !number || !neighborhood || !city || cepDigits.length !== 8 || state.length !== 2) {
    throw new Error("Endereco incompleto. Preencha CEP, rua, numero, bairro, cidade e UF.");
  }

  return {
    cep: cepDigits,
    street,
    number,
    complement: complement || "",
    neighborhood,
    city,
    state,
  };
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
      .limit(10);

    const orders = rows.map((row) => ({
      id: row.id,
      clientName: maskName(row.clientName),
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
    let addressChange: AddressChangePayload | null = null;

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

    try {
      addressChange = normalizeAddressChange(req.body?.addressChange);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Endereco invalido.";
      res.status(400).json({ error: "INVALID_INPUT", message });
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
      addressChangeJson: addressChange ? JSON.stringify(addressChange) : null,
      status: "open",
      resolutionReason: null,
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
    const scope = getSupportAdminScope(req, res);
    if (!scope) return;

    const status = String(req.query?.status ?? "all");
    const whereClause = status === "all" ? undefined : eq(supportTicketsTable.status, status);

    if (!scope.hasGlobalAccess) {
      const scopedOrders = await db
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(eq(ordersTable.sellerCode, scope.sellerCode!));

      const scopedOrderIds = scopedOrders.map((row) => row.id).filter(Boolean);
      if (scopedOrderIds.length === 0) {
        res.json({ tickets: [] });
        return;
      }

      const rows = await db
        .select()
        .from(supportTicketsTable)
        .where(whereClause ? and(whereClause, inArray(supportTicketsTable.orderId, scopedOrderIds)) : inArray(supportTicketsTable.orderId, scopedOrderIds))
        .orderBy(desc(supportTicketsTable.createdAt));

      const tickets = rows.map((row) => {
        let addressChange: AddressChangePayload | null = null;
        if (row.addressChangeJson) {
          try {
            const parsed = JSON.parse(row.addressChangeJson);
            addressChange = normalizeAddressChange(parsed);
          } catch {
            addressChange = null;
          }
        }

        return {
          id: row.id,
          orderId: row.orderId,
          clientDocument: row.clientDocument,
          clientName: row.clientName,
          description: row.description,
          imageUrl: row.imageUrl,
          addressChange,
          status: row.status,
          resolutionReason: row.resolutionReason,
          orderTotal: row.orderTotal == null ? null : Number(row.orderTotal),
          orderCreatedAt: row.orderCreatedAt?.toISOString() ?? null,
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
          createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
          updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
        };
      });

      res.json({ tickets });
      return;
    }

    const rows = await db
      .select()
      .from(supportTicketsTable)
      .where(whereClause)
      .orderBy(desc(supportTicketsTable.createdAt));

    const tickets = rows.map((row) => {
      let addressChange: AddressChangePayload | null = null;
      if (row.addressChangeJson) {
        try {
          const parsed = JSON.parse(row.addressChangeJson);
          addressChange = normalizeAddressChange(parsed);
        } catch {
          addressChange = null;
        }
      }

      return {
        id: row.id,
        orderId: row.orderId,
        clientDocument: row.clientDocument,
        clientName: row.clientName,
        description: row.description,
        imageUrl: row.imageUrl,
        addressChange,
        status: row.status,
        resolutionReason: row.resolutionReason,
        orderTotal: row.orderTotal == null ? null : Number(row.orderTotal),
        orderCreatedAt: row.orderCreatedAt?.toISOString() ?? null,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
        updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
      };
    });

    res.json({ tickets });
  } catch (err) {
    console.error("Support tickets list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar chamados." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/support-tickets/:id/reenviar
// ---------------------------------------------------------------------------
router.post("/admin/support-tickets/:id/reenviar", requireAdminAuth, async (req, res) => {
  try {
    const scope = getSupportAdminScope(req, res);
    if (!scope) return;

    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Chamado invalido." });
      return;
    }

    const ticketRows = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, id))
      .limit(1);

    const ticket = ticketRows[0];
    if (!ticket) {
      res.status(404).json({ error: "NOT_FOUND", message: "Chamado nao encontrado." });
      return;
    }
    if (!(await ticketBelongsToScope(ticket.orderId, scope))) {
      res.status(404).json({ error: "NOT_FOUND", message: "Chamado nao encontrado." });
      return;
    }

    const orderRows = await db
      .select({ id: ordersTable.id, products: ordersTable.products })
      .from(ordersTable)
      .where(scope.hasGlobalAccess
        ? eq(ordersTable.id, ticket.orderId)
        : and(eq(ordersTable.id, ticket.orderId), eq(ordersTable.sellerCode, scope.sellerCode!)))
      .limit(1);

    const order = orderRows[0];
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido do chamado nao encontrado." });
      return;
    }

    const reshipment = await createOrRefreshReshipment({
      orderId: order.id,
      supportTicketId: ticket.id,
      productsRaw: order.products,
      resolvedReason: "reenvio_autorizado",
    });

    await db
      .update(supportTicketsTable)
      .set({
        status: "resolved",
        resolutionReason: "reenvio_autorizado",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supportTicketsTable.id, id));

    broadcastNotification({
      type: "support_ticket_reshipment_authorized",
      data: {
        ticketId: id,
        orderId: order.id,
        reshipmentId: reshipment.id,
        reshipmentStatus: reshipment.status,
      },
    });

    res.json({
      ok: true,
      ticketId: id,
      orderId: order.id,
      reshipment,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao criar reenvio.";
    console.error("Support reenviar error:", err);
    res.status(400).json({ error: "INTERNAL_ERROR", message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/support-tickets/:id/status
// ---------------------------------------------------------------------------
router.patch("/admin/support-tickets/:id/status", requireAdminAuth, async (req, res) => {
  try {
    const scope = getSupportAdminScope(req, res);
    if (!scope) return;

    const id = String(req.params.id ?? "").trim();
    const status = String(req.body?.status ?? "").trim();
    if (!id || !["open", "resolved"].includes(status)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Status invalido." });
      return;
    }

    const ticketRows = await db
      .select({
        id: supportTicketsTable.id,
        orderId: supportTicketsTable.orderId,
        addressChangeJson: supportTicketsTable.addressChangeJson,
      })
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, id))
      .limit(1);

    const ticket = ticketRows[0];
    if (!ticket) {
      res.status(404).json({ error: "NOT_FOUND", message: "Chamado nao encontrado." });
      return;
    }
    if (!(await ticketBelongsToScope(ticket.orderId, scope))) {
      res.status(404).json({ error: "NOT_FOUND", message: "Chamado nao encontrado." });
      return;
    }

    let resolutionReason: string | null = status === "resolved" ? "resolvido_manual" : null;
    let reshipment: { id: string; status: string; missingProducts: string[] } | null = null;

    if (status === "resolved" && ticket.addressChangeJson) {
      let parsedAddress: AddressChangePayload | null = null;
      try {
        parsedAddress = normalizeAddressChange(JSON.parse(ticket.addressChangeJson));
      } catch {
        parsedAddress = null;
      }

      if (parsedAddress) {
        await db
          .update(ordersTable)
          .set({
            addressCep: parsedAddress.cep,
            addressStreet: parsedAddress.street,
            addressNumber: parsedAddress.number,
            addressComplement: parsedAddress.complement || null,
            addressNeighborhood: parsedAddress.neighborhood,
            addressCity: parsedAddress.city,
            addressState: parsedAddress.state,
            updatedAt: new Date(),
          })
          .where(scope.hasGlobalAccess
            ? eq(ordersTable.id, ticket.orderId)
            : and(eq(ordersTable.id, ticket.orderId), eq(ordersTable.sellerCode, scope.sellerCode!)));

        const orderRows = await db
          .select({ id: ordersTable.id, products: ordersTable.products })
          .from(ordersTable)
          .where(scope.hasGlobalAccess
            ? eq(ordersTable.id, ticket.orderId)
            : and(eq(ordersTable.id, ticket.orderId), eq(ordersTable.sellerCode, scope.sellerCode!)))
          .limit(1);

        const order = orderRows[0];
        if (order) {
          reshipment = await createOrRefreshReshipment({
            orderId: order.id,
            supportTicketId: ticket.id,
            productsRaw: order.products,
            resolvedReason: "reenvio_autorizado",
          });
          resolutionReason = "reenvio_autorizado";
        }
      }
    }

    await db.update(supportTicketsTable)
      .set({
        status,
        resolutionReason,
        resolvedAt: status === "resolved" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(supportTicketsTable.id, id));

    if (reshipment) {
      broadcastNotification({
        type: "support_ticket_reshipment_authorized",
        data: {
          ticketId: id,
          orderId: ticket.orderId,
          reshipmentId: reshipment.id,
          reshipmentStatus: reshipment.status,
        },
      });
    }

    res.json({ ok: true, id, status, resolutionReason, reshipment });
  } catch (err) {
    console.error("Support ticket status update error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar chamado." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/support-tickets/:id
// ---------------------------------------------------------------------------
router.delete("/admin/support-tickets/:id", requireAdminAuth, async (req, res) => {
  try {
    const scope = getSupportAdminScope(req, res);
    if (!scope) return;

    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Chamado invalido." });
      return;
    }

    const rows = await db
      .select({ id: supportTicketsTable.id, orderId: supportTicketsTable.orderId })
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, id))
      .limit(1);

    if (!rows[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Chamado nao encontrado." });
      return;
    }
    if (!(await ticketBelongsToScope(rows[0].orderId, scope))) {
      res.status(404).json({ error: "NOT_FOUND", message: "Chamado nao encontrado." });
      return;
    }

    await db.delete(supportTicketsTable).where(eq(supportTicketsTable.id, id));

    res.json({ ok: true, id });
  } catch (err) {
    console.error("Support ticket delete error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao excluir chamado." });
  }
});

export default router;
