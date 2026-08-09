import { Router, type IRouter } from "express";
import { getOrderLogisticsForecast } from "../lib/order-logistics";
import { resolvePublicTenantId } from "../lib/tenant-context";

const router: IRouter = Router();

router.get("/shipping-logistics/forecast", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req);
    const forecast = await getOrderLogisticsForecast(tenantId);
    res.json({
      availableSlots: forecast.availableSlots,
      promisedHours: forecast.promisedHours,
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