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
    const { dateFrom, dateTo, sellerCode } = req.query as Record<string, string>;
    const conditions = [];
    // Função para converter data local (BRT) para UTC
    function toUTC(dateStr, hour, minute, second) {
      // Cria data no fuso BRT (UTC-3)
      const local = new Date(`${dateStr}T${hour}:${minute}:${second}-03:00`);
      return new Date(local.toISOString());
    }
    if (dateFrom) conditions.push(gte(ordersTable.createdAt, toUTC(dateFrom, "00", "00", "00")));
    if (dateTo) conditions.push(lte(ordersTable.createdAt, toUTC(dateTo, "23", "59", "59")));
    // Considera apenas pedidos pagos
    conditions.push(inArray(ordersTable.status, ["paid", "completed"]));
    if (sellerCode) {
      conditions.push(ordersTable.sellerCode === sellerCode);
    }
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


    // Cálculo robusto do custo total dos produtos
    let totalCost = 0;
    for (const order of orders) {
      // Log do campo bruto para depuração
      console.log(`[CUSTO:RAW] Pedido: ${order.id} | products bruto:`, order.products);
      let products = [];
      if (typeof order.products === "string") {
        try { products = JSON.parse(order.products); } catch { products = []; }
      } else if (Array.isArray(order.products)) {
        products = order.products;
      }
      // Filtra produtos válidos
      const validProducts = products.filter(item => {
        const qty = Number(item.quantity) || 0;
        const cost = Number(item.costPrice) || 0;
        return qty > 0 && cost > 0;
      });
      let orderTotal = 0;
      for (const item of validProducts) {
        const qty = Number(item.quantity) || 0;
        const cost = Number(item.costPrice) || 0;
        const subtotal = qty * cost;
        console.log(`[CUSTO] Pedido: ${order.id} | Produto: ${item.name || item.id} | Qtd: ${qty} | Custo: ${cost} | Subtotal: ${subtotal}`);
        orderTotal += subtotal;
      }
      console.log(`[CUSTO:TOTAL] Pedido: ${order.id} | Produtos considerados:`, validProducts, '| Total do pedido:', orderTotal);
      totalCost += orderTotal;
    }

    // Cálculo robusto da comissão do vendedor
    let totalCommission = 0;
    for (const order of orders) {
      const amount = parseFloat(order.total || "0");
      let rate = 0;
      if (order.sellerCommissionRateSnapshot !== undefined && order.sellerCommissionRateSnapshot !== null) {
        rate = Number(order.sellerCommissionRateSnapshot) || 0;
      } else if (order.sellerCommissionRate !== undefined && order.sellerCommissionRate !== null) {
        rate = Number(order.sellerCommissionRate) || 0;
      }
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
