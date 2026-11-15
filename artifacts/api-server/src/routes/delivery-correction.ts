import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { orderTenantWhere, readDeliveryCorrection, resendDeliveryCorrection, saveDeliveryCorrection } from "../lib/delivery-correction";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";

const router: IRouter = Router();
const hits = new Map<string, number[]>();

function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [stored, times] of hits) {
      if (times.every((at) => now - at >= windowMs)) hits.delete(stored);
    }
  }
  return true;
}

function clientIp(req: { ip?: string; get(name: string): string | undefined }): string {
  const realIp = String(req.get("x-real-ip") || "").split(",")[0]?.trim();
  if (realIp) return realIp;
  const forwarded = String(req.get("x-forwarded-for") || "").split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return String(req.ip || "").trim() || "unknown";
}

router.get("/delivery-correction/:token", async (req, res) => {
  if (!allow(`get:${clientIp(req)}`, 40, 10 * 60 * 1000)) {
    res.status(429).json({ ok: false, message: "Muitas consultas. Espere um pouco e tente de novo." });
    return;
  }
  const result = await readDeliveryCorrection(String(req.params.token || ""));
  if (!result.ok) {
    res.status(result.status).json({ ok: false, message: result.message });
    return;
  }
  res.json({ ok: true, ...result.correction });
});

router.post("/delivery-correction/:token", async (req, res) => {
  if (!allow(`post:${clientIp(req)}`, 8, 10 * 60 * 1000)) {
    res.status(429).json({ ok: false, message: "Muitas tentativas. Espere um pouco e tente de novo." });
    return;
  }
  const result = await saveDeliveryCorrection(String(req.params.token || ""), req.body || {});
  if (!result.ok) {
    res.status(result.status).json({ ok: false, message: result.message });
    return;
  }
  res.json({ ok: true, message: "Dados atualizados. Já pode fechar esta página." });
});

router.post("/admin/orders/:id/delivery-correction/resend", requireAdminAuth, async (req, res) => {
  const scope = getAdminScope(req);
  if (!scope?.hasGlobalAccess) {
    res.status(403).json({ ok: false, message: "Sem permissão para reenviar." });
    return;
  }
  const orderId = String(req.params.id || "").trim();
  const tenantId = scope.tenantId || DEFAULT_TENANT_ID;
  const [order] = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), orderTenantWhere(tenantId)))
    .limit(1);
  if (!order) {
    res.status(404).json({ ok: false, message: "Não há link aberto para reenviar." });
    return;
  }
  const notice = await resendDeliveryCorrection(order.id);
  if (!notice) {
    res.status(404).json({ ok: false, message: "Não há link aberto para reenviar." });
    return;
  }
  res.json({ ok: true, deliveryCorrection: notice });
});

export default router;
