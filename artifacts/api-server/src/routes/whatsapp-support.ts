import { Router, type IRouter } from "express";
import { handleWhatsappSupportInbound } from "../lib/whatsapp-support";

const router: IRouter = Router();

router.post("/whatsapp/support/inbound", async (req, res) => {
  try {
    const queryToken = typeof req.query.token === "string" ? req.query.token : "";
    const headerToken = String(req.get("x-whatsapp-support-token") || "");
    const result = await handleWhatsappSupportInbound(req.body, headerToken || queryToken);
    res.status(result.status).json(result.status === 401 ? { error: "UNAUTHORIZED" } : { ok: true });
  } catch (err) {
    console.warn("[WHATSAPP_SUPPORT] Falha ao receber mensagem", err);
    res.status(200).json({ ok: true });
  }
});

export default router;
