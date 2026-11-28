import { Router, type IRouter } from "express";
import { handleWhatsappSupportInbound } from "../lib/whatsapp-support";
import { readWhatsappSupportToken, whatsappWebhookAllowsQueryToken } from "../lib/whatsapp-support-token";

const router: IRouter = Router();

router.post("/whatsapp/support/inbound", async (req, res) => {
  try {
    const token = readWhatsappSupportToken({
      headerToken: req.get("x-whatsapp-support-token"),
      queryToken: req.query.token,
      allowQueryToken: whatsappWebhookAllowsQueryToken(),
    });
    const result = await handleWhatsappSupportInbound(req.body, token);
    res.status(result.status).json(result.status === 401 ? { error: "UNAUTHORIZED" } : { ok: true });
  } catch (err) {
    console.warn("[WHATSAPP_SUPPORT] Falha ao receber mensagem", err);
    res.status(200).json({ ok: true });
  }
});

export default router;
