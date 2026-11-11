import { Router, type IRouter, type Request } from "express";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { isMainStoreDeliveryCorrectionTenant } from "../lib/freight-data-error";
import { readDeliveryCorrection, resendDeliveryCorrection, saveDeliveryCorrection } from "../lib/delivery-correction";

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

function clientIp(req: Request): string {
  const forwarded = String(req.get("x-forwarded-for") || "").split(",")[0]?.trim();
  return forwarded || String(req.get("x-real-ip") || "").trim() || req.ip || "unknown";
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
  const tenantId = scope?.tenantId || DEFAULT_TENANT_ID;
  if (!isMainStoreDeliveryCorrectionTenant(tenantId)) {
    res.status(404).json({ ok: false, message: "Não há link aberto para reenviar." });
    return;
  }
  const notice = await resendDeliveryCorrection(String(req.params.id || ""), tenantId);
  if (!notice) {
    res.status(404).json({ ok: false, message: "Não há link aberto para reenviar." });
    return;
  }
  res.json({ ok: true, deliveryCorrection: notice });
});

export default router;
