import { Router, type IRouter, type Request, type Response } from "express";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { isYuryInventorySyncConfigured, isYuryMotoboyWebhookConfigured } from "../lib/motoboy-yury-config";
import {
  getYuryInventoryLastSyncedAt,
  listYuryInventoryBalances,
  pullYuryInventorySnapshot,
} from "../lib/yury-inventory-sync";

const router: IRouter = Router();

function requireInventoryAccess(req: Request, res: Response) {
  const scope = getAdminScope(req);
  if (!scope) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return null;
  }
  const scopeTenantId = String(scope.tenantId || "").trim() || DEFAULT_TENANT_ID;
  const canManageInventory = scope.isPrimary || scopeTenantId !== DEFAULT_TENANT_ID;
  if (!canManageInventory) {
    res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para acessar estoque." });
    return null;
  }
  return scope;
}

router.get("/admin/yury-inventory", requireAdminAuth, async (req, res) => {
  try {
    if (!requireInventoryAccess(req, res)) return;
    const [balances, lastSyncedAt] = await Promise.all([
      listYuryInventoryBalances(),
      getYuryInventoryLastSyncedAt(),
    ]);
    res.json({
      configured: isYuryInventorySyncConfigured(),
      webhookConfigured: isYuryMotoboyWebhookConfigured(),
      lastSyncedAt,
      balances,
    });
  } catch (error) {
    console.error("[YuryInventory] list error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar estoque Yury." });
  }
});

router.post("/admin/yury-inventory/sync", requireAdminAuth, async (req, res) => {
  try {
    if (!requireInventoryAccess(req, res)) return;
    if (!isYuryInventorySyncConfigured()) {
      res.status(503).json({
        error: "SYNC_DISABLED",
        message: "Configure YURY_MOTOBOY_SYNC_TOKEN para puxar o estoque da Yury.",
      });
      return;
    }
    const result = await pullYuryInventorySnapshot();
    const balances = await listYuryInventoryBalances();
    res.json({
      ...result,
      configured: true,
      lastSyncedAt: result.syncedAt,
      balances,
    });
  } catch (error) {
    console.error("[YuryInventory] admin pull error:", error);
    res.status(502).json({
      error: "YURY_SYNC_FAILED",
      message: error instanceof Error ? error.message : "Falha ao sincronizar estoque Yury.",
    });
  }
});

export default router;
