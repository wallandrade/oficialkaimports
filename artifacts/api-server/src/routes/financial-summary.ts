import { Router, type IRouter } from "express";
import { db, filialPurchaseRequestsTable, marketingExpensesTable, ordersTable, productsTable, sellersTable, siteSettingsTable, tenantSettingsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getAdminScope, requireAdminAuth } from "./admin-auth";

const router: IRouter = Router();
const DEFAULT_TENANT_ID = "tenant_loja1";

// Utilitário para ler settings do banco
async function getGatewayFees(tenantId: string) {
  const tenantRows = await db.select().from(tenantSettingsTable).where(eq(tenantSettingsTable.tenantId, tenantId));
  const legacyRows = tenantId === DEFAULT_TENANT_ID ? await db.select().from(siteSettingsTable) : [];
  const rows = tenantRows.length > 0 ? tenantRows : legacyRows;
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

function toUTC(dateStr: string, hour: string, minute: string, second: string) {
  // Cria data no fuso BRT (UTC-3)
  const local = new Date(`${dateStr}T${hour}:${minute}:${second}-03:00`);
  return new Date(local.toISOString());
}

function normalizeCustomerKey(order: {
  clientDocument?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
}): string | null {
  const doc = String(order.clientDocument || "").replace(/\D/g, "").trim();
  if (doc) return `doc:${doc}`;

  const email = String(order.clientEmail || "").trim().toLowerCase();
  if (email) return `email:${email}`;

  const phone = String(order.clientPhone || "").replace(/\D/g, "").trim();
  if (phone) return `phone:${phone}`;

  return null;
}

function normalizeSellerCode(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
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

    const tenantId = adminScope.tenantId || DEFAULT_TENANT_ID;
    const { dateFrom, dateTo, sellerCode, repasseDateBasis } = req.query as Record<string, string>;
    const normalizedRepasseDateBasis = String(repasseDateBasis || "purchaseRecordedAt").trim() === "createdAt"
      ? "createdAt"
      : "purchaseRecordedAt";
    const conditions = [];
    conditions.push(eq(ordersTable.tenantId, tenantId));
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

    // Customer recurrence in selected period
    const periodCustomerKeys = new Set<string>();
    for (const order of orders) {
      const key = normalizeCustomerKey(order);
      if (key) periodCustomerKeys.add(key);
    }

    let recurringCustomers = 0;
    let newCustomers = periodCustomerKeys.size;

    if (dateFrom && periodCustomerKeys.size > 0) {
      const historyConditions = [
        eq(ordersTable.tenantId, tenantId),
        inArray(ordersTable.status, ["paid", "completed"]),
        lt(ordersTable.createdAt, toUTC(dateFrom, "00", "00", "00")),
      ];

      if (!adminScope.hasGlobalAccess) {
        historyConditions.push(eq(ordersTable.sellerCode, adminScope.sellerCode!));
      } else if (sellerCode) {
        historyConditions.push(eq(ordersTable.sellerCode, sellerCode));
      }

      const historicalOrders = await db
        .select({
          clientDocument: ordersTable.clientDocument,
          clientEmail: ordersTable.clientEmail,
          clientPhone: ordersTable.clientPhone,
        })
        .from(ordersTable)
        .where(and(...historyConditions));

      const historyCustomerKeys = new Set<string>();
      for (const order of historicalOrders) {
        const key = normalizeCustomerKey(order);
        if (key) historyCustomerKeys.add(key);
      }

      for (const key of periodCustomerKeys) {
        if (historyCustomerKeys.has(key)) recurringCustomers += 1;
      }
      newCustomers = Math.max(0, periodCustomerKeys.size - recurringCustomers);
    }

    const totalUniqueCustomers = periodCustomerKeys.size;
    const recurringRate = totalUniqueCustomers > 0
      ? Number(((recurringCustomers / totalUniqueCustomers) * 100).toFixed(2))
      : 0;
    const newRate = totalUniqueCustomers > 0
      ? Number(((newCustomers / totalUniqueCustomers) * 100).toFixed(2))
      : 0;

    // Lê taxas do settings
    const fees = await getGatewayFees(tenantId);

    // Calcula taxas de transação, separando economia WhatsApp
    let totalGatewayFees = 0;
    let whatsappEconomy = 0; // economia por nao cobrar taxa nos pedidos WhatsApp
    for (const order of orders) {
      const amount = parseFloat(order.total || "0");
      let fee = (amount * (fees.feePercent / 100)) + fees.feeFixed;
      if (fee < fees.feeMin) fee = fees.feeMin;
      // Se for WhatsApp, acumula a economia; senao, acumula a taxa real
      if (order.paymentMethod === "whatsapp_pix") {
        whatsappEconomy += fee;
      } else {
        totalGatewayFees += fee;
      }
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
        .where(and(eq(productsTable.tenantId, tenantId), inArray(productsTable.id, Array.from(productIds))));
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
        .where(and(eq(sellersTable.tenantId, tenantId), inArray(sellersTable.slug, sellerCodes)));

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

    const expenseConditions = [];
    expenseConditions.push(eq(marketingExpensesTable.tenantId, tenantId));
    if (dateFrom) {
      expenseConditions.push(sql`DATE(DATE_SUB(COALESCE(${marketingExpensesTable.expenseEndDate}, ${marketingExpensesTable.expenseDate}), INTERVAL 3 HOUR)) >= ${dateFrom}`);
    }
    if (dateTo) {
      expenseConditions.push(sql`DATE(DATE_SUB(COALESCE(${marketingExpensesTable.expenseStartDate}, ${marketingExpensesTable.expenseDate}), INTERVAL 3 HOUR)) <= ${dateTo}`);
    }

    if (!adminScope.hasGlobalAccess) {
      expenseConditions.push(or(eq(marketingExpensesTable.sellerCode, adminScope.sellerCode!), isNull(marketingExpensesTable.sellerCode)));
    } else if (sellerCode) {
      expenseConditions.push(or(eq(marketingExpensesTable.sellerCode, normalizeSellerCode(sellerCode)), isNull(marketingExpensesTable.sellerCode)));
    }

    const expenseRows = await db
      .select()
      .from(marketingExpensesTable)
      .where(and(...expenseConditions))
      .orderBy(desc(marketingExpensesTable.expenseDate), desc(marketingExpensesTable.createdAt), desc(marketingExpensesTable.id));

    const marketingExpenses = expenseRows.map((row) => ({
      id: row.id,
      sellerCode: row.sellerCode ?? null,
      expenseDate: row.expenseDate?.toISOString?.() ?? new Date().toISOString(),
      expenseStartDate: row.expenseStartDate?.toISOString?.() ?? row.expenseDate?.toISOString?.() ?? new Date().toISOString(),
      expenseEndDate: row.expenseEndDate?.toISOString?.() ?? row.expenseDate?.toISOString?.() ?? new Date().toISOString(),
      channel: row.channel,
      amount: Number(row.amount || 0),
      note: row.note ?? null,
      createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
    }));

    const totalMarketingExpenses = marketingExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const marketingExpensesByChannelMap = new Map<string, number>();
    for (const expense of marketingExpenses) {
      const key = String(expense.channel || "Sem canal").trim() || "Sem canal";
      marketingExpensesByChannelMap.set(key, (marketingExpensesByChannelMap.get(key) || 0) + Number(expense.amount || 0));
    }

    const marketingExpensesByChannel = Array.from(marketingExpensesByChannelMap.entries())
      .map(([channelName, channelTotal]) => ({ channel: channelName, total: channelTotal }))
      .sort((a, b) => b.total - a.total);

    const totalPaid = orders.reduce((sum, o) => sum + parseFloat(o.total || "0"), 0);
    const realNetRevenue = totalPaid - totalCost - totalCommission - totalGatewayFees - totalWithdrawFees - totalMarketingExpenses;

    let affiliateRepasseNetProfit = 0;
    let affiliateRepasseTotal = 0;
    let affiliateRepasseRealCostTotal = 0;
    let affiliateRepasseCount = 0;

    // Only Loja 1 global admins should see matrix profit over affiliate repasses.
    if (tenantId === DEFAULT_TENANT_ID && adminScope.hasGlobalAccess) {
      const repasseDateColumn = normalizedRepasseDateBasis === "createdAt"
        ? filialPurchaseRequestsTable.createdAt
        : filialPurchaseRequestsTable.purchaseRecordedAt;

      const repasseConditions = [
        inArray(filialPurchaseRequestsTable.status, ["compra_registrada", "estoque_lancado_filial", "finalizado"]),
      ];
      if (dateFrom) repasseConditions.push(gte(repasseDateColumn, toUTC(dateFrom, "00", "00", "00")));
      if (dateTo) repasseConditions.push(lte(repasseDateColumn, toUTC(dateTo, "23", "59", "59")));

      const repasseRows = await db
        .select({
          id: filialPurchaseRequestsTable.id,
          repasseTotal: filialPurchaseRequestsTable.repasseTotal,
          loja1RealCostTotal: filialPurchaseRequestsTable.loja1RealCostTotal,
          loja1RealProfit: filialPurchaseRequestsTable.loja1RealProfit,
        })
        .from(filialPurchaseRequestsTable)
        .where(and(...repasseConditions));

      affiliateRepasseCount = repasseRows.length;
      for (const row of repasseRows) {
        const repasse = Number(row.repasseTotal || 0);
        const realCost = Number(row.loja1RealCostTotal || 0);
        const realProfit = Number(row.loja1RealProfit || (repasse - realCost));
        affiliateRepasseTotal += repasse;
        affiliateRepasseRealCostTotal += realCost;
        affiliateRepasseNetProfit += realProfit;
      }

      affiliateRepasseTotal = Number(affiliateRepasseTotal.toFixed(2));
      affiliateRepasseRealCostTotal = Number(affiliateRepasseRealCostTotal.toFixed(2));
      affiliateRepasseNetProfit = Number(affiliateRepasseNetProfit.toFixed(2));
    }

    res.json({
      totalPaid,
      totalGatewayFees,
      whatsappEconomy,
      totalWithdrawFees,
      totalCost,
      totalCommission,
      totalMarketingExpenses,
      marketingExpenses,
      marketingExpensesByChannel,
      realNetRevenue,
      affiliateRepasseNetProfit,
      affiliateRepasseTotal,
      affiliateRepasseRealCostTotal,
      affiliateRepasseCount,
      repasseDateBasis: normalizedRepasseDateBasis,
      customerRecurrence: {
        totalUniqueCustomers,
        recurringCustomers,
        newCustomers,
        recurringRate,
        newRate,
      },
      fees,
      ordersCount: orders.length,
    });
  } catch (err) {
    console.error("[FinancialSummary] Error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
