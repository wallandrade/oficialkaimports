import { Router, type IRouter } from "express";
import { db, ordersTable, siteSettingsTable } from "@workspace/db";
import { and, gte, lte, inArray } from "drizzle-orm";
import { requireAdminAuth } from "./admin-auth";

const router: IRouter = Router();

// Utilitário para ler settings do banco
async function getGatewayFees() {
  const rows = await db.select().from(siteSettingsTable);
  const get = (key: string) => {
    const found = rows.find((r) => r.key === key);
    return found ? parseFloat(found.value) || 0 : 0;
  };
  return {
    feePercent: get("gateway_fee_percent"),
    feeFixed: get("gateway_fee_fixed"),
    feeMin: get("gateway_fee_min"),
    withdrawPercent: get("gateway_withdraw_percent"),
    withdrawFixed: get("gateway_withdraw_fixed"),
  };
}

// GET /api/admin/financial-summary
router.get("/admin/financial-summary", requireAdminAuth, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const conditions = [];
    if (dateFrom) conditions.push(gte(ordersTable.createdAt, new Date(dateFrom + "T00:00:00.000Z")));
    if (dateTo) conditions.push(lte(ordersTable.createdAt, new Date(dateTo + "T23:59:59.999Z")));
    // Considera apenas pedidos pagos
    conditions.push(inArray(ordersTable.status, ["paid", "completed"]));
    const orders = await db.select().from(ordersTable).where(and(...conditions));

    // Lê taxas do settings
    const fees = await getGatewayFees();

    // Calcula taxas de transação
    let totalGatewayFees = 0;
    for (const order of orders) {
      const amount = parseFloat(order.total || "0");
      let fee = (amount * (fees.feePercent / 100)) + fees.feeFixed;
      if (fee < fees.feeMin) fee = fees.feeMin;
      totalGatewayFees += fee;
    }

    // Cálculo do custo total dos produtos
    let totalCost = 0;
    for (const order of orders) {
      const products = Array.isArray(order.products) ? order.products : [];
      for (const item of products) {
        const qty = Number(item.quantity) || 0;
        const cost = Number(item.costPrice) || 0;
        totalCost += qty * cost;
      }
    }

    // Cálculo da comissão total
    let totalCommission = 0;
    for (const order of orders) {
      const amount = parseFloat(order.total || "0");
      const rate = Number(order.sellerCommissionRateSnapshot) || 0;
      totalCommission += amount * (rate / 100);
    }

    // TODO: calcular taxas de saque se houver tabela de saques
    let totalWithdrawFees = 0; // implementar se necessário

    const totalPaid = orders.reduce((sum, o) => sum + parseFloat(o.total || "0"), 0);
    const realNetRevenue = totalPaid - totalCost - totalCommission - totalGatewayFees - totalWithdrawFees;

    res.json({
      totalPaid,
      totalGatewayFees,
      totalWithdrawFees,
      totalCost,
      totalCommission,
      realNetRevenue,
      fees,
      ordersCount: orders.length,
    });
  } catch (err) {
    console.error("[FinancialSummary] Error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
