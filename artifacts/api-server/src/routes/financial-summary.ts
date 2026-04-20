import { Router, type IRouter } from "express";
import { db, ordersTable, productsTable, sellersTable, siteSettingsTable } from "@workspace/db";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getAdminScope, requireAdminAuth } from "./admin-auth";

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

function parseOrderProducts(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
    } catch {
      return [];
    }
  }
  return [];
}

// GET /api/admin/financial-summary
router.get("/admin/financial-summary", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = getAdminScope(req);
    if (!adminScope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    if (!adminScope.hasGlobalAccess && !adminScope.sellerCode) {
      res.status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
      return;
    }

    const { dateFrom, dateTo, sellerCode } = req.query as Record<string, string>;
    const conditions = [];
    // Função para converter data local (BRT) para UTC
    function toUTC(dateStr: string, hour: string, minute: string, second: string) {
      // Cria data no fuso BRT (UTC-3)
      const local = new Date(`${dateStr}T${hour}:${minute}:${second}-03:00`);
      return new Date(local.toISOString());
    }
    if (dateFrom) conditions.push(gte(ordersTable.createdAt, toUTC(dateFrom, "00", "00", "00")));
    if (dateTo) conditions.push(lte(ordersTable.createdAt, toUTC(dateTo, "23", "59", "59")));
    // Considera apenas pedidos pagos
    conditions.push(inArray(ordersTable.status, ["paid", "completed"]));
    if (!adminScope.hasGlobalAccess) {
      if (sellerCode && sellerCode !== adminScope.sellerCode) {
        res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para acessar outro seller." });
        return;
      }
      conditions.push(eq(ordersTable.sellerCode, adminScope.sellerCode!));
    } else if (sellerCode) {
      conditions.push(eq(ordersTable.sellerCode, sellerCode));
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
    // Cálculo do custo total dos produtos:
    // 1) usa costPrice salvo no item do pedido, quando existir
    // 2) fallback para costPrice atual da tabela de produtos
    let totalCost = 0;

    const productIds = new Set<string>();
    for (const order of orders) {
      const products = parseOrderProducts(order.products);
      for (const item of products) {
        const id = String(item.id ?? item.productId ?? "").trim();
        if (id) productIds.add(id);
      }
    }

    let productCostMap = new Map<string, number>();
    if (productIds.size > 0) {
      const rows = await db
        .select({ id: productsTable.id, costPrice: productsTable.costPrice })
        .from(productsTable)
        .where(inArray(productsTable.id, Array.from(productIds)));
      productCostMap = new Map(rows.map((row) => [String(row.id), Number(row.costPrice || 0)]));
    }

    for (const order of orders) {
      const products = parseOrderProducts(order.products);

      let orderTotal = 0;
      for (const item of products) {
        const qty = Number(item.quantity ?? item.qty ?? 0);
        if (qty <= 0) continue;

        const productId = String(item.id ?? item.productId ?? "").trim();
        const itemCost = Number(item.costPrice ?? item.costprice ?? item.cost ?? NaN);
        const fallbackCost = productId ? Number(productCostMap.get(productId) ?? 0) : 0;
        const cost = Number.isFinite(itemCost) && itemCost > 0 ? itemCost : fallbackCost;

        if (cost <= 0) continue;
        orderTotal += qty * cost;
      }

      totalCost += orderTotal;
    }

    // Cálculo robusto da comissão do vendedor: só desconta se tem sellerCode e taxa > 0
    const sellerCodes = Array.from(new Set(
      orders
        .map((order) => String(order.sellerCode ?? "").trim().toLowerCase())
        .filter(Boolean),
    ));

    let sellerRateMap = new Map<string, number>();
    if (sellerCodes.length > 0) {
      const sellerRows = await db
        .select({
          slug: sellersTable.slug,
          hasCommission: sellersTable.hasCommission,
          commissionRate: sellersTable.commissionRate,
        })
        .from(sellersTable)
        .where(inArray(sellersTable.slug, sellerCodes));

      sellerRateMap = new Map(
        sellerRows.map((seller) => [
          String(seller.slug).toLowerCase(),
          seller.hasCommission ? Number(seller.commissionRate ?? 0) : 0,
        ]),
      );
    }

    let totalCommission = 0;
    for (const order of orders) {
      const amount = parseFloat(order.total || "0");
      let rate = 0;

      // Prioriza snapshot histórico (não altera pedidos que já têm taxa travada)
      if (order.sellerCommissionRateSnapshot !== undefined && order.sellerCommissionRateSnapshot !== null) {
        rate = Number(order.sellerCommissionRateSnapshot) || 0;
      } else if (order.sellerCode) {
        // Fallback apenas para pedidos antigos sem snapshot
        rate = sellerRateMap.get(String(order.sellerCode).toLowerCase()) ?? 0;
      }

      // Só desconta comissão se tem sellerCode e taxa > 0
      if (order.sellerCode && rate > 0) {
        totalCommission += amount * (rate / 100);
      }
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
