import { Router, type IRouter, type Request, type Response } from "express";
import { getYuryMotoboyWebhookSecret, isYuryMotoboyWebhookConfigured } from "../lib/motoboy-yury-config";
import { isYuryMotoboyTimestampFresh, verifyYuryMotoboySignature } from "../lib/motoboy-yury-hmac";
import { handleYuryMotoboyCoverageEvent } from "../lib/motoboy-yury-webhook";

const router: IRouter = Router();

function rawBody(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

async function receiveYuryMotoboyCoverage(req: Request, res: Response): Promise<void> {
  if (!isYuryMotoboyWebhookConfigured()) {
    res.status(503).json({ error: "SYNC_DISABLED", message: "Webhook Motoboy Yury sem secret." });
    return;
  }

  const raw = rawBody(req);
  const secret = getYuryMotoboyWebhookSecret();
  if (!verifyYuryMotoboySignature(secret, raw, req.get("x-yury-signature"))) {
    res.status(401).json({ error: "INVALID_SIGNATURE" });
    return;
  }
  if (!isYuryMotoboyTimestampFresh(req.get("x-yury-timestamp"))) {
    res.status(401).json({ error: "STALE_TIMESTAMP" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "INVALID_JSON" });
    return;
  }

  try {
    const result = await handleYuryMotoboyCoverageEvent(parsed);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (message === "INVALID_EVENT") {
      res.status(400).json({ error: "INVALID_EVENT" });
      return;
    }
    console.error("[YuryMotoboy] webhook error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

router.post("/", receiveYuryMotoboyCoverage);

export default router;
export { receiveYuryMotoboyCoverage };
