import { Router, type IRouter } from "express";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { listWhatsappOutboundQueue } from "../lib/whatsapp-outbound-queue";

const router: IRouter = Router();

router.get("/admin/whatsapp/outbound-queue", requireAdminAuth, async (req, res) => {
  const scope = getAdminScope(req);
  if (!scope?.hasGlobalAccess) {
    res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para ver a fila do WhatsApp." });
    return;
  }
  try {
    const tenantId = scope.isPrimary ? null : scope.tenantId;
    const view = await listWhatsappOutboundQueue(tenantId);
    res.set("Cache-Control", "no-store");
    res.json(view);
  } catch {
    console.warn("[WhatsApp fila] leitura falhou");
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Não foi possível ler a fila." });
  }
});

export default router;
