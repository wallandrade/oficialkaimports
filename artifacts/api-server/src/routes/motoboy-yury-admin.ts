import { Router, type IRouter } from "express";
import { isYuryMotoboySyncConfigured, isYuryMotoboyWebhookConfigured } from "../lib/motoboy-yury-config";
import { getMotoboyYuryLastSyncedAt, pullYuryMotoboyCoverage } from "../lib/motoboy-yury-sync";
import { requireAdminAuth } from "./admin-auth";

const router: IRouter = Router();

router.get("/admin/motoboy-coverage/yury", requireAdminAuth, async (_req, res) => {
  try {
    const lastSyncedAt = await getMotoboyYuryLastSyncedAt();
    res.json({
      configured: isYuryMotoboySyncConfigured(),
      webhookConfigured: isYuryMotoboyWebhookConfigured(),
      lastSyncedAt,
    });
  } catch (error) {
    console.error("[YuryMotoboy] status error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao consultar sync Yury." });
  }
});

router.post("/admin/motoboy-coverage/yury/sync", requireAdminAuth, async (_req, res) => {
  try {
    if (!isYuryMotoboySyncConfigured()) {
      res.status(503).json({
        error: "SYNC_DISABLED",
        message: "Configure YURY_MOTOBOY_SYNC_TOKEN para puxar a cobertura da Yury.",
      });
      return;
    }
    const result = await pullYuryMotoboyCoverage();
    res.json(result);
  } catch (error) {
    console.error("[YuryMotoboy] admin pull error:", error);
    res.status(502).json({
      error: "YURY_SYNC_FAILED",
      message: error instanceof Error ? error.message : "Falha ao sincronizar cobertura Yury.",
    });
  }
});

export default router;
