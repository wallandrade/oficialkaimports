import { Router, type IRouter, type Request, type Response } from "express";
import {
  affiliateCommissionsTable,
  affiliateCreditUsesTable,
  affiliateReferralsTable,
  affiliatesTable,
  customerUsersTable,
  db,
  ordersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { getCustomerSession, requireCustomerAuth } from "../middlewares/customer-auth";
import { getAffiliateAvailableCreditByUserId, getOrCreateAffiliateByUserId, priorSellerLinkCodesByOrderId } from "../lib/affiliates";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { getAdminScope, requireAdminAuth, type AdminScope } from "./admin-auth";

const router: IRouter = Router();

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function getStorefrontOrigin(req: Request): string {
  const explicitOrigin =
    process.env.STOREFRONT_URL ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_SITE_URL ||
    "https://www.ka-imports.com";

  if (explicitOrigin) {
    return normalizeOrigin(String(explicitOrigin));
  }

  const forwardedHost = String(req.get("x-forwarded-host") || "").trim();
  const forwardedProto = String(req.get("x-forwarded-proto") || req.protocol || "http").trim();
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const origin = String(req.get("origin") || "").trim();
  if (origin) {
    return normalizeOrigin(origin);
  }

  const referer = String(req.get("referer") || "").trim();
  if (referer) {
    try {
      const parsed = new URL(referer);
      return normalizeOrigin(parsed.origin);
    } catch {
      // Ignore invalid referer and fallback to request host.
    }
  }

  return `${req.protocol}://${req.get("host")}`;
}

router.get("/me/affiliate/dashboard", requireCustomerAuth, async (req, res) => {
  try {
    const session = getCustomerSession(req);
    if (!session) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const tenantId = session.tenantId || DEFAULT_TENANT_ID;
    const affiliate = await getOrCreateAffiliateByUserId(session.userId, tenantId);

    const commissions = await db
      .select({
        status: affiliateCommissionsTable.status,
        commissionAmount: affiliateCommissionsTable.commissionAmount,
      })
      .from(affiliateCommissionsTable)
      .where(and(eq(affiliateCommissionsTable.tenantId, tenantId), eq(affiliateCommissionsTable.affiliateUserId, session.userId)));

    let pending = 0;
    let released = 0;

    for (const row of commissions) {
      const value = Number(row.commissionAmount || 0);
      if (!Number.isFinite(value)) continue;

      if (row.status === "released") released += value;
      else if (row.status === "pending") pending += value;
    }

    const referrals = await db
      .select({
        hasConverted: affiliateReferralsTable.hasConverted,
      })
      .from(affiliateReferralsTable)
      .where(and(eq(affiliateReferralsTable.tenantId, tenantId), eq(affiliateReferralsTable.affiliateUserId, session.userId)));

    const activeReferrals = referrals.filter((r) => r.hasConverted).length;
    const inactiveReferrals = Math.max(0, referrals.length - activeReferrals);

    const origin = getStorefrontOrigin(req);

    res.json({
      summary: {
        commissionsReleased: Number(released.toFixed(2)),
        commissionsPending: Number(pending.toFixed(2)),
        referralsActive: activeReferrals,
        referralsInactive: inactiveReferrals,
      },
      affiliate: {
        code: affiliate.affiliateCode,
        referralLink: `${origin}/r/${affiliate.affiliateCode}`,
        facebookPixelId: affiliate.facebookPixelId || "",
      },
    });
  } catch (err) {
    console.error("[Affiliate] dashboard error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar dados de afiliação." });
  }
});

router.patch("/me/affiliate/facebook-pixel", requireCustomerAuth, async (req, res) => {
  try {
    const session = getCustomerSession(req);
    if (!session) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const tenantId = session.tenantId || DEFAULT_TENANT_ID;
    const pixelId = String((req.body as { pixelId?: string }).pixelId || "").trim();

    const affiliate = await getOrCreateAffiliateByUserId(session.userId, tenantId);

    await db
      .update(affiliatesTable)
      .set({ facebookPixelId: pixelId || null, updatedAt: new Date() })
      .where(and(eq(affiliatesTable.tenantId, tenantId), eq(affiliatesTable.id, affiliate.id), eq(affiliatesTable.userId, session.userId)));

    res.json({ ok: true, facebookPixelId: pixelId });
  } catch (err) {
    console.error("[Affiliate] update pixel error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar pixel." });
  }
});

router.get("/me/affiliate/credit-balance", requireCustomerAuth, async (req, res) => {
  try {
    const session = getCustomerSession(req);
    if (!session) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const availableCredit = await getAffiliateAvailableCreditByUserId(session.userId, session.tenantId || DEFAULT_TENANT_ID);
    res.json({ availableCredit });
  } catch (err) {
    console.error("[Affiliate] credit balance error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar saldo disponível." });
  }
});

function buildTenantWhere(tenantId: string, column: AnyColumn): SQL {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(column, tenantId), isNull(column), eq(column, ""))!;
  }
  return eq(column, tenantId);
}

function roundMoney(value: unknown): number {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function availableCredit(released: number, used: number): number {
  const available = roundMoney(released) - roundMoney(used);
  if (!Number.isFinite(available) || available <= 0) return 0;
  return roundMoney(available);
}

type AffiliateBuyer = {
  email: string;
  name: string;
  phone: string;
  orderCount: number;
  totalSpent: number;
  commissionTotal: number;
  orders: Array<{
    id: string;
    orderNumber: number | null;
    createdAt: string | null;
    status: string;
    total: number;
    commissionAmount: number;
    excludedSellerCode: string | null;
  }>;
};

async function listAffiliateBuyers(tenantId: string, affiliateUserId: string): Promise<AffiliateBuyer[]> {
  const orderRows = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      createdAt: ordersTable.createdAt,
      status: ordersTable.status,
      total: ordersTable.total,
      clientName: ordersTable.clientName,
      clientEmail: ordersTable.clientEmail,
      clientPhone: ordersTable.clientPhone,
      clientDocument: ordersTable.clientDocument,
      userId: ordersTable.userId,
      tenantId: ordersTable.tenantId,
    })
    .from(ordersTable)
    .where(and(
      buildTenantWhere(tenantId, ordersTable.tenantId),
      eq(ordersTable.affiliateUserId, affiliateUserId),
      inArray(ordersTable.status, ["paid", "completed"]),
      or(isNull(ordersTable.userId), ne(ordersTable.userId, affiliateUserId)),
    ))
    .orderBy(desc(ordersTable.createdAt));

  const orderIds = orderRows.map((row) => row.id);
  const commissionRows = orderIds.length === 0
    ? []
    : await db
      .select({
        orderId: affiliateCommissionsTable.orderId,
        commissionAmount: affiliateCommissionsTable.commissionAmount,
      })
      .from(affiliateCommissionsTable)
      .where(and(
        buildTenantWhere(tenantId, affiliateCommissionsTable.tenantId),
        eq(affiliateCommissionsTable.affiliateUserId, affiliateUserId),
        inArray(affiliateCommissionsTable.orderId, orderIds),
      ));

  const commissionByOrder = new Map(commissionRows.map((row) => [row.orderId, roundMoney(row.commissionAmount)]));
  const excludedByOrder = await priorSellerLinkCodesByOrderId(orderRows.map((order) => ({
    id: order.id,
    createdAt: order.createdAt,
    tenantId: order.tenantId || tenantId,
    userId: order.userId,
    clientEmail: order.clientEmail,
    clientDocument: order.clientDocument,
  })));
  const buyers = new Map<string, Omit<AffiliateBuyer, "orderCount" | "totalSpent" | "commissionTotal">>();

  for (const order of orderRows) {
    const email = String(order.clientEmail || "").trim().toLowerCase();
    const key = email || `order:${order.id}`;
    const current = buyers.get(key) || {
      email,
      name: String(order.clientName || "Cliente"),
      phone: String(order.clientPhone || ""),
      orders: [],
    };
    const excludedSellerCode = excludedByOrder.get(order.id) || null;
    current.orders.push({
      id: order.id,
      orderNumber: order.orderNumber ?? null,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
      status: String(order.status || ""),
      total: roundMoney(order.total),
      commissionAmount: excludedSellerCode ? 0 : (commissionByOrder.get(order.id) || 0),
      excludedSellerCode,
    });
    buyers.set(key, current);
  }

  return Array.from(buyers.values()).map((buyer) => ({
    ...buyer,
    orderCount: buyer.orders.length,
    totalSpent: roundMoney(buyer.orders.reduce((sum, order) => sum + order.total, 0)),
    commissionTotal: roundMoney(buyer.orders.reduce((sum, order) => sum + order.commissionAmount, 0)),
  }));
}

router.get("/me/affiliate/buyers", requireCustomerAuth, async (req, res) => {
  try {
    const session = getCustomerSession(req);
    if (!session) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const buyers = await listAffiliateBuyers(session.tenantId || DEFAULT_TENANT_ID, session.userId);
    res.json({ buyers });
  } catch (err) {
    console.error("[Affiliate] buyers error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar compras do link." });
  }
});

function requireGlobalAdmin(req: Request, res: Response): AdminScope | null {
  const scope = getAdminScope(req);
  if (!scope) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return null;
  }
  if (!scope.hasGlobalAccess) {
    res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para ver afiliados." });
    return null;
  }
  return scope;
}

router.get("/admin/affiliates", requireAdminAuth, async (req, res) => {
  try {
    const scope = requireGlobalAdmin(req, res);
    if (!scope) return;
    const tenantId = scope.tenantId || DEFAULT_TENANT_ID;

    const releasedRows = await db
      .select({
        userId: affiliateCommissionsTable.affiliateUserId,
        released: sql<string>`COALESCE(SUM(${affiliateCommissionsTable.commissionAmount}), 0)`,
      })
      .from(affiliateCommissionsTable)
      .where(and(
        buildTenantWhere(tenantId, affiliateCommissionsTable.tenantId),
        eq(affiliateCommissionsTable.status, "released"),
      ))
      .groupBy(affiliateCommissionsTable.affiliateUserId);

    const userIds = releasedRows.map((row) => row.userId).filter(Boolean);
    if (userIds.length === 0) {
      res.json({ affiliates: [] });
      return;
    }

    const [usedRows, affiliateRows, customerRows] = await Promise.all([
      db
        .select({
          userId: affiliateCreditUsesTable.affiliateUserId,
          used: sql<string>`COALESCE(SUM(${affiliateCreditUsesTable.amount}), 0)`,
        })
        .from(affiliateCreditUsesTable)
        .where(and(
          buildTenantWhere(tenantId, affiliateCreditUsesTable.tenantId),
          inArray(affiliateCreditUsesTable.affiliateUserId, userIds),
        ))
        .groupBy(affiliateCreditUsesTable.affiliateUserId),
      db
        .select({
          userId: affiliatesTable.userId,
          affiliateCode: affiliatesTable.affiliateCode,
        })
        .from(affiliatesTable)
        .where(and(
          buildTenantWhere(tenantId, affiliatesTable.tenantId),
          inArray(affiliatesTable.userId, userIds),
        )),
      db
        .select({
          id: customerUsersTable.id,
          name: customerUsersTable.name,
          email: customerUsersTable.email,
        })
        .from(customerUsersTable)
        .where(and(
          buildTenantWhere(tenantId, customerUsersTable.tenantId),
          inArray(customerUsersTable.id, userIds),
        )),
    ]);

    const usedByUser = new Map(usedRows.map((row) => [row.userId, roundMoney(row.used)]));
    const codeByUser = new Map(affiliateRows.map((row) => [row.userId, row.affiliateCode]));
    const customerByUser = new Map(customerRows.map((row) => [row.id, row]));

    const affiliates = releasedRows.map((row) => {
      const released = roundMoney(row.released);
      const used = usedByUser.get(row.userId) || 0;
      const customer = customerByUser.get(row.userId);
      return {
        userId: row.userId,
        name: customer?.name || "Cliente",
        email: customer?.email || "",
        affiliateCode: codeByUser.get(row.userId) || null,
        released,
        used,
        available: availableCredit(released, used),
      };
    }).sort((a, b) => b.available - a.available || a.name.localeCompare(b.name, "pt-BR"));

    res.json({ affiliates });
  } catch (err) {
    console.error("[Affiliate] admin list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar afiliados." });
  }
});

router.get("/admin/affiliates/:userId", requireAdminAuth, async (req, res) => {
  try {
    const scope = requireGlobalAdmin(req, res);
    if (!scope) return;
    const tenantId = scope.tenantId || DEFAULT_TENANT_ID;
    const userId = String(req.params.userId || "").trim();
    if (!userId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe o afiliado." });
      return;
    }

    const [affiliate] = await db
      .select({ userId: affiliateCommissionsTable.affiliateUserId })
      .from(affiliateCommissionsTable)
      .where(and(
        buildTenantWhere(tenantId, affiliateCommissionsTable.tenantId),
        eq(affiliateCommissionsTable.affiliateUserId, userId),
        eq(affiliateCommissionsTable.status, "released"),
      ))
      .limit(1);

    if (!affiliate) {
      res.status(404).json({ error: "NOT_FOUND", message: "Afiliado não encontrado." });
      return;
    }

    res.json({ buyers: await listAffiliateBuyers(tenantId, userId) });
  } catch (err) {
    console.error("[Affiliate] admin detail error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar indicações." });
  }
});

export default router;
