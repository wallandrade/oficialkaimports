import { Router, type IRouter } from "express";
import { db, tenantSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { recoverySnapshot, sendNextRecovery } from "../lib/whatsapp-recovery";

const router: IRouter = Router();

function canManage(req: Parameters<typeof getAdminScope>[0]): { tenantId: string } | null {
  const scope = getAdminScope(req);
  if (!scope) return null;
  if (!scope.isPrimary && scope.tenantId === DEFAULT_TENANT_ID && !scope.hasGlobalAccess) return null;
  return { tenantId: scope.tenantId || DEFAULT_TENANT_ID };
}

async function saveSetting(tenantId: string, key: string, value: string): Promise<void> {
  const existing = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(tenantSettingsTable)
      .set({ value, updatedAt: new Date() })
      .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)));
    return;
  }
  await db.insert(tenantSettingsTable).values({ tenantId, key, value, updatedAt: new Date() });
}

router.get("/admin/whatsapp-recovery", requireAdminAuth, async (req, res) => {
  const scope = canManage(req);
  if (!scope) {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }
  res.json(await recoverySnapshot(scope.tenantId));
});

router.put("/admin/whatsapp-recovery", requireAdminAuth, async (req, res) => {
  const scope = canManage(req);
  if (!scope) {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }
  const body = req.body as { enabled?: boolean; days?: number; dailyLimit?: number; message?: string };
  const days = Math.min(365, Math.max(1, Number(body.days) || 40));
  const dailyLimit = Math.min(200, Math.max(1, Number(body.dailyLimit) || 40));
  await saveSetting(scope.tenantId, "n8n_recovery_enabled", body.enabled ? "1" : "0");
  await saveSetting(scope.tenantId, "n8n_recovery_days", String(days));
  await saveSetting(scope.tenantId, "n8n_recovery_daily_limit", String(dailyLimit));
  await saveSetting(scope.tenantId, "n8n_recovery_message", String(body.message || "").trim());
  res.json(await recoverySnapshot(scope.tenantId));
});

router.post("/admin/whatsapp-recovery/send-one", requireAdminAuth, async (req, res) => {
  const scope = canManage(req);
  if (!scope) {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }
  const result = await sendNextRecovery({ tenantId: scope.tenantId, ignoreHours: true });
  const snapshot = await recoverySnapshot(scope.tenantId);
  res.json({ ...result, ...snapshot });
});

export default router;
