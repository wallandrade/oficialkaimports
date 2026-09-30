import { Router, type IRouter } from "express";
import { getTenantSettingsMap } from "../lib/envioecom-config";
import { getOrderLogisticsForecast } from "../lib/order-logistics";
import {
  resolveCheckoutDeadlineHours,
  SHIPPING_QUEUE_MANUAL_ENABLED_KEY,
  SHIPPING_QUEUE_MANUAL_HOURS_KEY,
} from "../lib/shipping-queue-deadline";
import { resolvePublicTenantId } from "../lib/tenant-context";

const router: IRouter = Router();

router.get("/shipping-logistics/forecast", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    const tenantId = await resolvePublicTenantId(req);
    const forecast = await getOrderLogisticsForecast(tenantId);
    let promisedHours = forecast.promisedHours;
    try {
      const settings = await getTenantSettingsMap(tenantId);
      promisedHours = resolveCheckoutDeadlineHours(
        forecast.promisedHours,
        settings[SHIPPING_QUEUE_MANUAL_ENABLED_KEY],
        settings[SHIPPING_QUEUE_MANUAL_HOURS_KEY],
      );
    } catch (error) {
      console.error("[OrderLogistics] manual deadline settings error:", error);
    }
    res.json({
      availableSlots: forecast.availableSlots,
      promisedHours,
      dispatchDate: forecast.dispatchDate,
      dispatchDeadline: forecast.deadlineAt.toISOString(),
      capacity: forecast.capacity,
    });
  } catch (error) {
    console.error("[OrderLogistics] forecast error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao consultar o prazo de postagem." });
  }
});

export default router;