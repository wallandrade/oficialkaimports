import { Router, type IRouter } from "express";
import crypto from "crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, inventoryBalancesTable, manualReshipmentsTable, manualReturnItemsTable, ordersTable, reshipmentsTable } from "@workspace/db";
import { getAdminScope, requireAdminAuth, requirePrimaryAdmin } from "./admin-auth";
import {
  createManualReshipment,
  ensureReshipmentReservation,
  ensureReshipmentSendDebit,
  getInventoryOverview,
  listReshipments,
  registerInventoryEntry,
  releasePendingReshipments,
  setManualReshipmentStatus,
  setReshipmentStatus,
} from "../lib/reshipments";
import { broadcastNotification } from "./notifications";

const router: IRouter = Router();
const DEFAULT_TENANT_ID = "tenant_loja1";

function buildOrdersTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }

  return eq(ordersTable.tenantId, tenantId);
}

function buildReshipmentsTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(reshipmentsTable.tenantId, tenantId), isNull(reshipmentsTable.tenantId), eq(reshipmentsTable.tenantId, ""));
  }

  return eq(reshipmentsTable.tenantId, tenantId);
}

function buildManualReshipmentsTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(
      eq(manualReshipmentsTable.tenantId, tenantId),
      isNull(manualReshipmentsTable.tenantId),
      eq(manualReshipmentsTable.tenantId, ""),
    );
  }

  return eq(manualReshipmentsTable.tenantId, tenantId);
}

function buildInventoryBalancesTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(
      eq(inventoryBalancesTable.tenantId, tenantId),
      isNull(inventoryBalancesTable.tenantId),
      eq(inventoryBalancesTable.tenantId, ""),
    );
  }

  return eq(inventoryBalancesTable.tenantId, tenantId);
}

function parseReshipmentProducts(raw: unknown): Array<{ id: string; name: string; quantity: number }> {
  const parsed = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const json = JSON.parse(raw);
            return Array.isArray(json) ? json : [];
          } catch {
            return [];
          }
        })()
      : [];

  return parsed
    .map((item) => ({
      id: String((item as { id?: unknown })?.id || "").trim(),
      name: String((item as { name?: unknown })?.name || "Produto").trim() || "Produto",
      quantity: Number((item as { quantity?: unknown })?.quantity || 0),
    }))
    .filter((item) => item.id && item.quantity > 0);
}

function normalizeSellerCode(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function getReshipmentScope(req: Parameters<typeof router.get>[1] extends (req: infer R, _res: infer _S) => unknown ? R : never, res: Parameters<typeof router.get>[1] extends (_req: infer _R, res: infer S) => unknown ? S : never) {
  const scope = getAdminScope(req as never);
  if (!scope) {
    (res as any).status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return null;
  }
  if (!scope.hasGlobalAccess && !scope.sellerCode) {
    (res as any).status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
    return null;
  }
  return { hasGlobalAccess: scope.hasGlobalAccess, sellerCode: normalizeSellerCode(scope.sellerCode), tenantId: scope.tenantId || DEFAULT_TENANT_ID };
}

async function isOrderInScope(orderId: string, scope: { hasGlobalAccess: boolean; sellerCode: string | null }): Promise<boolean> {
  if (scope.hasGlobalAccess) return true;
  const rows = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(and(buildOrdersTenantWhere(scope.tenantId), eq(ordersTable.id, orderId), eq(ordersTable.sellerCode, scope.sellerCode!)))
    .limit(1);
  return !!rows[0];
}

router.get("/admin/inventory/overview", requirePrimaryAdmin, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const [inventory, manualReturnItems] = await Promise.all([
      getInventoryOverview(tenantId),
      db
        .select()
        .from(manualReturnItemsTable)
        .where(eq(manualReturnItemsTable.status, "pending"))
        .orderBy(desc(manualReturnItemsTable.createdAt)),
    ]);

    const pendingReshipments = manualReturnItems.map((item) => ({
      id: item.id,
      source: "manual_return",
      orderId: null,
      supportTicketId: null,
      status: "manual_return_pending",
      clientName: item.clientName,
      clientPhone: null,
      clientDocument: null,
      products: [{ id: item.productId, name: item.productName, quantity: Number(item.quantity) || 1 }],
      resolvedReason: item.returningOrder || null,
      notes: item.returningOrder || null,
      authorizedAt: item.createdAt?.toISOString() || null,
      sentAt: null,
      createdAt: item.createdAt?.toISOString() || null,
    }));

    res.json({
      balances: inventory.balances,
      movements: inventory.movements,
      pendingReshipments,
    });
  } catch (err) {
    console.error("Inventory overview error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar estoque." });
  }
});

router.post("/admin/manual-return-items", requirePrimaryAdmin, async (req, res) => {
  try {
    const clientName = String(req.body?.clientName ?? "").trim();
    const returningOrder = String(req.body?.returningOrder ?? "").trim();
    const productId = String(req.body?.productId ?? "").trim();
    const productName = String(req.body?.productName ?? "").trim();
    const quantity = Number(req.body?.quantity || 0);

    if (!clientName || !productId || !productName || !Number.isFinite(quantity) || quantity <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Preencha cliente, produto e quantidade válida." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    await db.insert(manualReturnItemsTable).values({
      id,
      status: "pending",
      clientName,
      returningOrder: returningOrder || null,
      productId,
      productName,
      quantity,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error("Create manual return item error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar item de retorno manual." });
  }
});

router.patch("/admin/manual-return-items/:id/status", requirePrimaryAdmin, async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();
    const status = String(req.body?.status ?? "").trim().toLowerCase();

    if (!id || !["pending", "done"].includes(status)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Status inválido para retorno manual." });
      return;
    }

    const existing = await db
      .select({ id: manualReturnItemsTable.id })
      .from(manualReturnItemsTable)
      .where(eq(manualReturnItemsTable.id, id))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Item de retorno manual não encontrado." });
      return;
    }

    await db
      .update(manualReturnItemsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(manualReturnItemsTable.id, id));

    res.json({ ok: true, id, status });
  } catch (err) {
    console.error("Update manual return item status error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar retorno manual." });
  }
});

router.post("/admin/inventory/entries", requirePrimaryAdmin, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const productId = String(req.body?.productId ?? "").trim();
    const quantity = Number(req.body?.quantity || 0);
    const movementType = String(req.body?.movementType ?? "entry").trim().toLowerCase();
    const entrySource = String(req.body?.entrySource ?? "purchase").trim().toLowerCase();
    const clientName = String(req.body?.clientName ?? "").trim();
    const clientPhone = String(req.body?.clientPhone ?? "").trim();
    const trackingCode = String(req.body?.trackingCode ?? "").trim();
    const reason = String(req.body?.reason ?? "").trim();
    const estornoMatch = reason.match(/^estorno de baixa do reenvio\s+([a-zA-Z0-9_\-]+)/i);
    const estornoReferenceId = estornoMatch?.[1] ? String(estornoMatch[1]).trim() : null;
    const isEstornoEntry = movementType === "entry" && Boolean(estornoReferenceId);

    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Produto e quantidade devem ser válidos." });
      return;
    }

    if (movementType !== "entry" && movementType !== "exit") {
      res.status(400).json({ error: "INVALID_INPUT", message: "Tipo de movimentação inválido." });
      return;
    }

    if (movementType === "entry" && entrySource !== "purchase" && entrySource !== "customer_return") {
      res.status(400).json({ error: "INVALID_INPUT", message: "Origem da entrada inválida." });
      return;
    }

    if (movementType === "entry" && estornoReferenceId) {
      const [supportReshipment, manualReshipment] = await Promise.all([
        db
          .select({ productsSnapshot: reshipmentsTable.productsSnapshot })
          .from(reshipmentsTable)
          .where(eq(reshipmentsTable.id, estornoReferenceId))
          .limit(1),
        db
          .select({ productsSnapshot: manualReshipmentsTable.productsSnapshot })
          .from(manualReshipmentsTable)
            .where(and(buildManualReshipmentsTenantWhere(tenantId), eq(manualReshipmentsTable.id, estornoReferenceId)))
          .limit(1),
      ]);

      const productsSnapshot = supportReshipment[0]?.productsSnapshot ?? manualReshipment[0]?.productsSnapshot;
      if (!productsSnapshot) {
        res.status(400).json({
          error: "INVALID_RESHIPMENT_REFERENCE",
          message: `Reenvio ${estornoReferenceId} não encontrado para estorno.`,
        });
        return;
      }

      const reshipmentProducts = parseReshipmentProducts(productsSnapshot);
      const allowedProductIds = new Set(reshipmentProducts.map((item) => item.id));
      if (!allowedProductIds.has(productId)) {
        const expectedProducts = reshipmentProducts.map((item) => item.name).join(", ");
        res.status(400).json({
          error: "INVALID_RESHIPMENT_PRODUCT",
          message: `Produto informado não pertence ao reenvio ${estornoReferenceId}. Produtos esperados: ${expectedProducts}.`,
        });
        return;
      }
    }

    const signedQuantity = movementType === "exit" ? -quantity : quantity;

    if (signedQuantity < 0) {
      const [balance] = await db
        .select({ quantity: inventoryBalancesTable.quantity })
        .from(inventoryBalancesTable)
        .where(and(buildInventoryBalancesTenantWhere(tenantId), eq(inventoryBalancesTable.productId, productId)))
        .limit(1);
      const current = Number(balance?.quantity || 0);
      if (current < quantity) {
        res.status(400).json({ error: "INSUFFICIENT_STOCK", message: `Saldo insuficiente. Disponível: ${current}.` });
        return;
      }
    }

    const resolvedReason = reason || (() => {
      if (movementType === "exit") return "Saida manual de estoque";
      if (entrySource === "customer_return") {
        const byClient = clientName ? ` · Cliente: ${clientName}` : "";
        const withPhone = clientPhone ? ` · Telefone: ${clientPhone}` : "";
        const withTracking = trackingCode ? ` · Rastreio: ${trackingCode}` : "";
        return `Entrada de produto retornado${byClient}${withPhone}${withTracking}`;
      }
      return "Entrada por compra de estoque";
    })();

    await registerInventoryEntry({
      tenantId,
      productId,
      quantity: signedQuantity,
      reason: resolvedReason,
      referenceId: movementType === "entry" && estornoReferenceId ? estornoReferenceId : undefined,
      entrySource: movementType === "entry" ? (entrySource === "customer_return" ? "customer_return" : "purchase") : undefined,
      clientName: movementType === "entry" && entrySource === "customer_return" ? clientName || null : null,
      clientPhone: movementType === "entry" && entrySource === "customer_return" ? clientPhone || null : null,
      trackingCode: movementType === "entry" && entrySource === "customer_return" ? trackingCode || null : null,
      affectBalance: !isEstornoEntry,
    });

    const releasedCount = movementType === "entry" && !isEstornoEntry ? await releasePendingReshipments(tenantId) : 0;

    if (releasedCount > 0) {
      broadcastNotification({ type: "reshipment_stock_released", data: { releasedCount } });
    }

    res.status(201).json({ ok: true, releasedCount, balanceChanged: !isEstornoEntry });
  } catch (err) {
    console.error("Inventory entry error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao registrar entrada de estoque." });
  }
});

router.post("/admin/reshipments/manual", requirePrimaryAdmin, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const clientName = String(req.body?.clientName ?? "").trim();
    const clientPhone = String(req.body?.clientPhone ?? "").trim();
    const clientDocument = String(req.body?.clientDocument ?? "").trim() || null;
    const addressCep = String(req.body?.addressCep ?? "").trim();
    const addressStreet = String(req.body?.addressStreet ?? "").trim();
    const addressNumber = String(req.body?.addressNumber ?? "").trim();
    const addressComplement = String(req.body?.addressComplement ?? "").trim() || null;
    const addressNeighborhood = String(req.body?.addressNeighborhood ?? "").trim();
    const addressCity = String(req.body?.addressCity ?? "").trim();
    const addressState = String(req.body?.addressState ?? "").trim();
    const notes = String(req.body?.notes ?? "").trim() || null;
    const productId = String(req.body?.productId ?? "").trim();
    const quantity = Number(req.body?.quantity || 0);

    if (
      !clientName ||
      !clientPhone ||
      !addressCep ||
      !addressStreet ||
      !addressNumber ||
      !addressNeighborhood ||
      !addressCity ||
      !addressState ||
      !productId ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Preencha cliente, endereço e produto/quantidade válidos." });
      return;
    }

    const createdByUsername = String((req as any).adminSession?.username || "").trim() || null;

    const created = await createManualReshipment({
      tenantId,
      clientName,
      clientPhone,
      clientDocument,
      addressCep,
      addressStreet,
      addressNumber,
      addressComplement,
      addressNeighborhood,
      addressCity,
      addressState,
      notes,
      productId,
      quantity,
      createdByUsername,
    });

    broadcastNotification({
      type: "support_ticket_reshipment_authorized",
      data: { id: created.id, orderId: null, clientName },
    });

    res.status(201).json({ ok: true, ...created });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao criar reenvio manual.";
    res.status(400).json({ error: "INVALID_INPUT", message });
  }
});

router.get("/admin/reshipments", requireAdminAuth, async (req, res) => {
  try {
    const scope = getReshipmentScope(req, res);
    if (!scope) return;

    const status = String(req.query?.status ?? "all");
    const reshipments = await listReshipments(status, scope.tenantId);
    if (!scope.hasGlobalAccess) {
      const orderRows = await db
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(and(buildOrdersTenantWhere(scope.tenantId), eq(ordersTable.sellerCode, scope.sellerCode!)));
      const allowedOrderIds = new Set(orderRows.map((row) => row.id));
      res.json({
        reshipments: reshipments.filter((item) => !!item.orderId && allowedOrderIds.has(item.orderId)),
      });
      return;
    }

    res.json({ reshipments });
  } catch (err) {
    console.error("List reshipments error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar reenvios." });
  }
});

router.patch("/admin/reshipments/:id/status", requireAdminAuth, async (req, res) => {
  try {
    const scope = getReshipmentScope(req, res);
    if (!scope) return;

    const id = String(req.params.id ?? "").trim();
    const skipStockValidation = Boolean(req.body?.skipStockValidation);
    const status = String(req.body?.status ?? "").trim() as
      | "reenvio_aguardando_estoque"
      | "reenvio_pronto_para_envio"
      | "reenvio_resolvido_sem_entrada"
      | "reenvio_enviado";

    if (!id || !["reenvio_aguardando_estoque", "reenvio_pronto_para_envio", "reenvio_resolvido_sem_entrada", "reenvio_enviado"].includes(status)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Status de reenvio inválido." });
      return;
    }

    const rows = await db
      .select({ orderId: reshipmentsTable.orderId, currentStatus: reshipmentsTable.status })
      .from(reshipmentsTable)
      .where(and(buildReshipmentsTenantWhere(scope.tenantId), eq(reshipmentsTable.id, id)))
      .limit(1);
          const check = await ensureReshipmentReservation({ id, source: "support", tenantId: scope.tenantId });
          const debit = await ensureReshipmentSendDebit({ id, source: "support", tenantId: scope.tenantId });
  const ok = await setReshipmentStatus(id, status, scope.tenantId);

    if (rows[0]) {
      if (!(await isOrderInScope(rows[0].orderId, scope))) {
        res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
        return;
      }

      let debitSummary: Array<{ productId: string; productName: string; quantity: number }> = [];
      let alreadySent = false;
      if (status === "reenvio_pronto_para_envio" || status === "reenvio_enviado") {
        if (status === "reenvio_pronto_para_envio" && skipStockValidation) {
          // Manual return-flow action can clear pending card without forcing stock reconciliation.
        } else {
        if (status === "reenvio_enviado" && rows[0].currentStatus === "reenvio_enviado") {
          alreadySent = true;
        }
        const reservation = status === "reenvio_enviado"
          ? (alreadySent
              ? { ok: true, missingProducts: [], debitedProducts: [] }
              : await ensureReshipmentSendDebit({ id, source: "support" }))
          : await ensureReshipmentReservation({ id, source: "support" });
        if (!reservation.ok) {
          if (reservation.notFound) {
            res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
            return;
          }
          if (reservation.invalidProducts) {
            res.status(400).json({ error: "INVALID_RESHIPMENT_PRODUCTS", message: "Reenvio sem produtos válidos para reservar estoque." });
            return;
          }
          res.status(400).json({
            error: "INSUFFICIENT_STOCK",
            message: `Estoque insuficiente para o reenvio: ${(reservation.missingProducts || []).join(", ")}.`,
            missingProducts: reservation.missingProducts || [],
          });
          return;
        }
        if (status === "reenvio_enviado" && "debitedProducts" in reservation) {
          debitSummary = reservation.debitedProducts || [];
          console.info("[ReshipmentSendDebit] support", { id, requestedStatus: status, debitedProducts: debitSummary });
        }
        }
      }

      const nextStatus = status;

      const updated = await setReshipmentStatus(id, nextStatus);
      if (!updated) {
        res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
        return;
      }

      broadcastNotification({ type: "reshipment_updated", data: { id, status: nextStatus } });
      res.json({ ok: true, id, status: nextStatus, requestedStatus: status, debitedProducts: debitSummary, alreadySent });
      return;
    } else {
      const manualRows = await db
        .select({ id: manualReshipmentsTable.id, currentStatus: manualReshipmentsTable.status })
        .from(manualReshipmentsTable)
        .where(and(buildManualReshipmentsTenantWhere(scope.tenantId), eq(manualReshipmentsTable.id, id)))
        .limit(1);
          const check = await ensureReshipmentReservation({ id, source: "manual", tenantId: scope.tenantId });
          const debit = await ensureReshipmentSendDebit({ id, source: "manual", tenantId: scope.tenantId });
  const ok = await setManualReshipmentStatus(id, status, scope.tenantId);

      if (!manualRows[0]) {
        res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
        return;
      }

      const adminScope = getAdminScope(req as never);
      if (!adminScope?.isPrimary) {
        res.status(403).json({ error: "FORBIDDEN", message: "Somente admin primário pode atualizar reenvio manual." });
        return;
      }

      let debitSummary: Array<{ productId: string; productName: string; quantity: number }> = [];
      let alreadySent = false;
      if (status === "reenvio_pronto_para_envio" || status === "reenvio_enviado") {
        if (status === "reenvio_pronto_para_envio" && skipStockValidation) {
          // Manual return-flow action can clear pending card without forcing stock reconciliation.
        } else {
        if (status === "reenvio_enviado" && manualRows[0].currentStatus === "reenvio_enviado") {
          alreadySent = true;
        }
        const reservation = status === "reenvio_enviado"
          ? (alreadySent
              ? { ok: true, missingProducts: [], debitedProducts: [] }
              : await ensureReshipmentSendDebit({ id, source: "manual" }) )
          : await ensureReshipmentReservation({ id, source: "manual" });
        if (!reservation.ok) {
          if (reservation.notFound) {
            res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
            return;
          }
          if (reservation.invalidProducts) {
            res.status(400).json({ error: "INVALID_RESHIPMENT_PRODUCTS", message: "Reenvio sem produtos válidos para reservar estoque." });
            return;
          }
          res.status(400).json({
            error: "INSUFFICIENT_STOCK",
            message: `Estoque insuficiente para o reenvio: ${(reservation.missingProducts || []).join(", ")}.`,
            missingProducts: reservation.missingProducts || [],
          });
          return;
        }
        if (status === "reenvio_enviado" && "debitedProducts" in reservation) {
          debitSummary = reservation.debitedProducts || [];
          console.info("[ReshipmentSendDebit] manual", { id, requestedStatus: status, debitedProducts: debitSummary });
        }
        }
      }

      const nextStatus = status;

      const updatedManual = await setManualReshipmentStatus(id, nextStatus);
      if (!updatedManual) {
        res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
        return;
      }

      broadcastNotification({ type: "reshipment_updated", data: { id, status: nextStatus } });
      res.json({ ok: true, id, status: nextStatus, requestedStatus: status, debitedProducts: debitSummary, alreadySent });
      return;
    }
  } catch (err) {
    console.error("Update reshipment status error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar reenvio." });
  }
});

export default router;
