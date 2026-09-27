import { Router, type IRouter } from "express";
import { ENVIOECOM_STANDARD_PACKAGE } from "../lib/envioecom-package";
import {
  ENVIOECOM_ENV_ACCOUNT_ID,
  createEnvioEcomClientForAccount,
  getEnvioEcomAccount,
  isEnvioEcomAccountConfigured,
} from "../lib/envioecom-accounts";
import { getTenantSettingsMap } from "../lib/envioecom-config";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";
import {
  CHECKOUT_CARRIER_PRIORITY_KEY,
  EMPTY_CHECKOUT_DELIVERY,
  checkoutDeliveryCacheKey,
  parseCheckoutCarrierPriority,
  pickCheckoutDelivery,
  readCheckoutDeliveryCache,
  takeCheckoutQuoteSlot,
  writeCheckoutDeliveryCache,
  type CheckoutDeliveryEstimate,
} from "../lib/checkout-carrier-priority";

const router: IRouter = Router();

function digitsOnly(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function clientIp(req: { get(name: string): string | undefined; ip?: string }): string {
  const forwarded = String(req.get("x-forwarded-for") || "").split(",")[0]?.trim();
  return forwarded || req.ip || "unknown";
}

function standardQuoteProduct() {
  return {
    weight: ENVIOECOM_STANDARD_PACKAGE.weightKg,
    length: ENVIOECOM_STANDARD_PACKAGE.lengthCm,
    height: ENVIOECOM_STANDARD_PACKAGE.heightCm,
    width: ENVIOECOM_STANDARD_PACKAGE.widthCm,
    quantity: 1,
    price: ENVIOECOM_STANDARD_PACKAGE.declaredValue,
  };
}

/** GET /api/shipping/delivery-estimate?cep=01310100 — público, sem token de checkout. */
router.get("/shipping/delivery-estimate", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const sendEmpty = () => {
    res.json(EMPTY_CHECKOUT_DELIVERY);
  };

  try {
    const cep = digitsOnly(req.query.cep).slice(0, 8);
    if (cep.length !== 8) {
      sendEmpty();
      return;
    }

    const tenantId = await resolvePublicTenantId(req);
    const settings = await getTenantSettingsMap(tenantId);
    const parsed = parseCheckoutCarrierPriority(settings[CHECKOUT_CARRIER_PRIORITY_KEY]);
    const carriers = parsed.ok ? parsed.carriers : [];
    if (!carriers.length) {
      sendEmpty();
      return;
    }

    const cacheKey = checkoutDeliveryCacheKey(cep, carriers);
    const cached = readCheckoutDeliveryCache(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const account = await getEnvioEcomAccount(DEFAULT_TENANT_ID, ENVIOECOM_ENV_ACCOUNT_ID);
    if (!account || !isEnvioEcomAccountConfigured(account)) {
      sendEmpty();
      return;
    }

    const slot = takeCheckoutQuoteSlot(clientIp(req));
    if (!slot.allowed) {
      res.setHeader("Retry-After", String(slot.retryAfterSec));
      res.status(429).json({
        error: "RATE_LIMITED",
        message: "Muitas consultas de prazo. Tente novamente em instantes.",
        retryAfterSec: slot.retryAfterSec,
      });
      return;
    }

    const payload: Record<string, unknown> = {
      postal_code_destination: cep,
      carriers,
      products: [standardQuoteProduct()],
      aviso_recebimento: false,
    };
    if (account.originCep.length === 8) payload.postal_code_origin = account.originCep;

    const quoted = await createEnvioEcomClientForAccount(DEFAULT_TENANT_ID, account).quote(payload);
    const picked = pickCheckoutDelivery(carriers, quoted);
    const body: CheckoutDeliveryEstimate = picked
      ? { carrier: picked.carrier, deliveryTimeDays: picked.deliveryTimeDays }
      : EMPTY_CHECKOUT_DELIVERY;
    writeCheckoutDeliveryCache(cacheKey, body);
    res.json(body);
  } catch (error) {
    console.error("[CheckoutDeliveryEstimate]", error);
    if (!res.headersSent) sendEmpty();
  }
});

export default router;
