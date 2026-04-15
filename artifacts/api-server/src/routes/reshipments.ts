import { Router, type IRouter } from "express";
import { requireAdminAuth } from "./admin-auth";
import {
  getInventoryOverview,
  listReshipments,
  registerInventoryEntry,
  releasePendingReshipments,
  setReshipmentStatus,
} from "../lib/reshipments";
import { broadcastNotification } from "./notifications";

const router: IRouter = Router();

router.get("/admin/inventory/overview", requireAdminAuth, async (_req, res) => {
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

router.post("/admin/inventory/entries", requireAdminAuth, async (req, res) => {
  try {
    const productId = String(req.body?.productId ?? "").trim();
    const quantity = Number(req.body?.quantity || 0);
    const reason = String(req.body?.reason ?? "").trim() || "Entrada manual de estoque";

    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Produto e quantidade devem ser válidos." });
      return;
    }

    await registerInventoryEntry({ productId, quantity, reason });
    const releasedCount = await releasePendingReshipments();

    if (releasedCount > 0) {
      broadcastNotification({ type: "reshipment_stock_released", data: { releasedCount } });
    }

    res.status(201).json({ ok: true, releasedCount });
  } catch (err) {
    console.error("Inventory entry error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao registrar entrada de estoque." });
  }
});

router.get("/admin/reshipments", requireAdminAuth, async (req, res) => {
  try {
    const status = String(req.query?.status ?? "all");
    const reshipments = await listReshipments(status);
    res.json({ reshipments });
  } catch (err) {
    console.error("List reshipments error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar reenvios." });
  }
});

router.patch("/admin/reshipments/:id/status", requireAdminAuth, async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();
    const status = String(req.body?.status ?? "").trim() as
      | "reenvio_aguardando_estoque"
      | "reenvio_pronto_para_envio"
      | "reenvio_enviado";

    if (!id || !["reenvio_aguardando_estoque", "reenvio_pronto_para_envio", "reenvio_enviado"].includes(status)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Status de reenvio inválido." });
      return;
    }

    const updated = await setReshipmentStatus(id, status);
    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Reenvio não encontrado." });
      return;
    }

    broadcastNotification({ type: "reshipment_updated", data: { id, status } });
    res.json({ ok: true, id, status });
  } catch (err) {
    console.error("Update reshipment status error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar reenvio." });
  }
});

export default router;
