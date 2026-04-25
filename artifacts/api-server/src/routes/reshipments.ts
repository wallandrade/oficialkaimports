import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, inventoryBalancesTable, manualReshipmentsTable, ordersTable, reshipmentsTable } from "@workspace/db";
import { getAdminScope, requireAdminAuth, requirePrimaryAdmin } from "./admin-auth";
import {
  createManualReshipment,
  getInventoryOverview,
  listReshipments,
  registerInventoryEntry,
  releasePendingReshipments,
  setManualReshipmentStatus,
  setReshipmentStatus,
} from "../lib/reshipments";
import { broadcastNotification } from "./notifications";

const router: IRouter = Router();

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
  return { hasGlobalAccess: scope.hasGlobalAccess, sellerCode: normalizeSellerCode(scope.sellerCode) };
}

async function isOrderInScope(orderId: string, scope: { hasGlobalAccess: boolean; sellerCode: string | null }): Promise<boolean> {
  if (scope.hasGlobalAccess) return true;
  const rows = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.sellerCode, scope.sellerCode!)))
    .limit(1);
  return !!rows[0];
}

router.get("/admin/inventory/overview", requirePrimaryAdmin, async (_req, res) => {
  try {
    const [inventory, pendingReshipments] = await Promise.all([
      getInventoryOverview(),
      listReshipments("reenvio_aguardando_estoque"),
    ]);

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

router.post("/admin/inventory/entries", requirePrimaryAdmin, async (req, res) => {
  try {
    const productId = String(req.body?.productId ?? "").trim();
    const quantity = Number(req.body?.quantity || 0);
    const movementType = String(req.body?.movementType ?? "entry").trim().toLowerCase();
    const reason = String(req.body?.reason ?? "").trim();

    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Produto e quantidade devem ser válidos." });
      return;
    }

    if (movementType !== "entry" && movementType !== "exit") {
      res.status(400).json({ error: "INVALID_INPUT", message: "Tipo de movimentação inválido." });
      return;
    }

    const signedQuantity = movementType === "exit" ? -quantity : quantity;

    if (signedQuantity < 0) {
      const [balance] = await db
        .select({ quantity: inventoryBalancesTable.quantity })
        .from(inventoryBalancesTable)
        .where(eq(inventoryBalancesTable.productId, productId))
        .limit(1);
      const current = Number(balance?.quantity || 0);
      if (current < quantity) {
        res.status(400).json({ error: "INSUFFICIENT_STOCK", message: `Saldo insuficiente. Disponível: ${current}.` });
        return;
      }
    }

    await registerInventoryEntry({
      productId,
      quantity: signedQuantity,
      reason: reason || (movementType === "exit" ? "Saida manual de estoque" : "Entrada manual de estoque"),
    });

    const releasedCount = movementType === "entry" ? await releasePendingReshipments() : 0;

    if (releasedCount > 0) {
      broadcastNotification({ type: "reshipment_stock_released", data: { releasedCount } });
    }

    res.status(201).json({ ok: true, releasedCount });
  } catch (err) {
    console.error("Inventory entry error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao registrar entrada de estoque." });
  }
});

router.post("/admin/reshipments/manual", requirePrimaryAdmin, async (req, res) => {
  try {
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
    const reshipments = await listReshipments(status);
    if (!scope.hasGlobalAccess) {
      const orderRows = await db
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(eq(ordersTable.sellerCode, scope.sellerCode!));
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
    const status = String(req.body?.status ?? "").trim() as
      | "reenvio_aguardando_estoque"
      | "reenvio_pronto_para_envio"
      | "reenvio_enviado";

    if (!id || !["reenvio_aguardando_estoque", "reenvio_pronto_para_envio", "reenvio_enviado"].includes(status)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Status de reenvio inválido." });
      return;
    }

    const rows = await db
      .select({ orderId: reshipmentsTable.orderId })
      .from(reshipmentsTable)
      .where(eq(reshipmentsTable.id, id))
      .limit(1);

    if (rows[0]) {
      if (!(await isOrderInScope(rows[0].orderId, scope))) {
        res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
        return;
      }

      const updated = await setReshipmentStatus(id, status);
      if (!updated) {
        res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
        return;
      }
    } else {
      const manualRows = await db
        .select({ id: manualReshipmentsTable.id })
        .from(manualReshipmentsTable)
        .where(eq(manualReshipmentsTable.id, id))
        .limit(1);

      if (!manualRows[0]) {
        res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
        return;
      }

      const adminScope = getAdminScope(req as never);
      if (!adminScope?.isPrimary) {
        res.status(403).json({ error: "FORBIDDEN", message: "Somente admin primário pode atualizar reenvio manual." });
        return;
      }

      const updatedManual = await setManualReshipmentStatus(id, status);
      if (!updatedManual) {
        res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
        return;
      }
    }

    broadcastNotification({ type: "reshipment_updated", data: { id, status } });
    res.json({ ok: true, id, status });
  } catch (err) {
    console.error("Update reshipment status error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar reenvio." });
  }
});

export default router;
