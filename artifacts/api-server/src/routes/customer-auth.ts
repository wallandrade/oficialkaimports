import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db, customerUsersTable, ordersTable, affiliatesTable } from "@workspace/db";
import { eq, sql, desc, inArray, and, asc, isNull, or } from "drizzle-orm";
import {
  createCustomerSession,
  generateSalt,
  getCustomerSession,
  hashPassword,
  removeCustomerSession,
  requireCustomerAuth,
} from "../middlewares/customer-auth";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { normalizeAffiliateCode, registerAffiliateLead, resolveAffiliateByCode } from "../lib/affiliates";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";

const router: IRouter = Router();

function buildOrdersTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }

  return eq(ordersTable.tenantId, tenantId);
}

function buildCustomerUsersTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(customerUsersTable.tenantId, tenantId), isNull(customerUsersTable.tenantId), eq(customerUsersTable.tenantId, ""));
  }

  return eq(customerUsersTable.tenantId, tenantId);
}

function buildAffiliatesTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(affiliatesTable.tenantId, tenantId), isNull(affiliatesTable.tenantId), eq(affiliatesTable.tenantId, ""));
  }

  return eq(affiliatesTable.tenantId, tenantId);
}

router.post("/auth/register", async (req, res) => {
  const tenantId = await resolvePublicTenantId(req as Request);
  const { name, email, password, affiliateCode } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    affiliateCode?: string;
  };

  if (!name || !email || !password) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Nome, e-mail e senha são obrigatórios." });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "INVALID_INPUT", message: "A senha deve ter pelo menos 8 caracteres." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existing = await db
      .select({ id: customerUsersTable.id })
      .from(customerUsersTable)
      .where(and(eq(customerUsersTable.tenantId, tenantId), eq(customerUsersTable.email, normalizedEmail)))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "CONFLICT", message: "Já existe uma conta com esse e-mail." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    const salt = generateSalt();

    await db.insert(customerUsersTable).values({
      id,
      tenantId,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(password, salt),
      salt,
      updatedAt: new Date(),
    });

    const normalizedAffiliateCode = normalizeAffiliateCode(affiliateCode);
    if (normalizedAffiliateCode) {
      const affiliate = await resolveAffiliateByCode(normalizedAffiliateCode, tenantId);
      if (affiliate && affiliate.userId !== id) {
        await registerAffiliateLead({
          tenantId,
          affiliateUserId: affiliate.userId,
          referredUserId: id,
          referredEmail: normalizedEmail,
        });
      }
    }

    const session = createCustomerSession({ tenantId, userId: id, email: normalizedEmail, name: name.trim() });

    res.status(201).json({
      token: session.token,
      expiresIn: session.expiresInSeconds,
      user: {
        id,
        name: name.trim(),
        email: normalizedEmail,
      },
    });
  } catch (err) {
    console.error("[CustomerAuth] register error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar conta." });
  }
});

router.post("/auth/login", async (req, res) => {
  const tenantId = await resolvePublicTenantId(req as Request);
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: "INVALID_INPUT", message: "E-mail e senha são obrigatórios." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const users = await db
      .select()
      .from(customerUsersTable)
      .where(and(eq(customerUsersTable.tenantId, tenantId), eq(customerUsersTable.email, normalizedEmail)))
      .limit(1);

    const user = users[0];
    if (!user) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." });
      return;
    }

    const candidateHash = hashPassword(password, user.salt);
    if (candidateHash !== user.passwordHash) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." });
      return;
    }

    const session = createCustomerSession({
      tenantId,
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    res.json({
      token: session.token,
      expiresIn: session.expiresInSeconds,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("[CustomerAuth] login error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao autenticar." });
  }
});

router.post("/auth/logout", (req, res) => {
  removeCustomerSession(req);
  res.json({ ok: true });
});

router.get("/auth/me", requireCustomerAuth, async (req, res) => {
  const session = getCustomerSession(req);

  if (!session) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return;
  }

  const users = await db
    .select({ id: customerUsersTable.id, name: customerUsersTable.name, email: customerUsersTable.email })
    .from(customerUsersTable)
    .where(and(eq(customerUsersTable.tenantId, session.tenantId), eq(customerUsersTable.id, session.userId)))
    .limit(1);

  const user = users[0];
  if (!user) {
    res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
    return;
  }

  res.json({ user });
});

// --------------------------------------------------------------------------
// GET /api/admin/customers  — list all buyers (registered + guest) (admin only)
// --------------------------------------------------------------------------
router.get("/admin/customers", requireAdminAuth, async (req, res) => {
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

    const emailOrders = await db
      .select({
        email: sql<string>`lower(${ordersTable.clientEmail})`.as("email"),
        name: sql<string>`max(${ordersTable.clientName})`.as("name"),
        phone: sql<string>`max(${ordersTable.clientPhone})`.as("phone"),
        firstOrderAt: sql<Date>`min(${ordersTable.createdAt})`.as("first_order_at"),
        orderCount: sql<number>`count(*)`.as("order_count"),
      })
      .from(ordersTable)
      .where(
        and(
          buildOrdersTenantWhere(adminScope.tenantId),
          adminScope.hasGlobalAccess ? undefined : eq(ordersTable.sellerCode, adminScope.sellerCode!),
          sql`coalesce(${ordersTable.clientEmail}, '') <> ''`,
        ),
      )
      .groupBy(sql`lower(${ordersTable.clientEmail})`);

    if (!adminScope.hasGlobalAccess && emailOrders.length === 0) {
      res.json({ customers: [] });
      return;
    }

    const scopedEmails = new Set(emailOrders.map((row) => String(row.email || "")).filter(Boolean));
    const emailStatsMap = new Map(
      emailOrders.map((row) => [String(row.email || ""), {
        name: String(row.name || ""),
        phone: String(row.phone || ""),
        firstOrderAt: row.firstOrderAt,
        orderCount: Number(row.orderCount || 0),
      }]),
    );

    const customers = await db
      .select({
        id: customerUsersTable.id,
        name: customerUsersTable.name,
        email: customerUsersTable.email,
        createdAt: customerUsersTable.createdAt,
      })
      .from(customerUsersTable)
      .where(buildCustomerUsersTenantWhere(adminScope.tenantId))
      .orderBy(desc(customerUsersTable.createdAt));

    const scopedCustomers = adminScope.hasGlobalAccess
      ? customers
      : customers.filter((c) => scopedEmails.has(String(c.email || "").toLowerCase()));

    // Fetch affiliate codes
    const scopedCustomerIds = scopedCustomers.map((c) => c.id);
    const affiliateRows = await db
      .select({ userId: affiliatesTable.userId, affiliateCode: affiliatesTable.affiliateCode })
      .from(affiliatesTable)
      .where(scopedCustomerIds.length > 0 ? and(buildAffiliatesTenantWhere(adminScope.tenantId), inArray(affiliatesTable.userId, scopedCustomerIds)) : and(buildAffiliatesTenantWhere(adminScope.tenantId)));

    const affiliateCodeMap = new Map<string, string>();
    for (const row of affiliateRows) {
      affiliateCodeMap.set(row.userId, row.affiliateCode);
    }

    const registeredEmailSet = new Set<string>();

    const registeredCustomers = scopedCustomers.map((c) => {
      const email = String(c.email || "").toLowerCase();
      registeredEmailSet.add(email);
      const stats = emailStatsMap.get(email);
      return {
        ...c,
        phone: stats?.phone || null,
        orderCount: stats?.orderCount ?? 0,
        affiliateCode: affiliateCodeMap.get(c.id) ?? null,
        hasAccount: true,
      };
    });

    const guestCustomers = emailOrders
      .filter((row) => !registeredEmailSet.has(String(row.email || "")))
      .map((row) => ({
        id: `guest:${String(row.email || "")}`,
        name: String(row.name || "Cliente"),
        email: String(row.email || ""),
        phone: String(row.phone || "") || null,
        createdAt: row.firstOrderAt,
        orderCount: Number(row.orderCount || 0),
        affiliateCode: null,
        hasAccount: false,
      }));

    const allCustomers = [...registeredCustomers, ...guestCustomers].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });

    res.json({ customers: allCustomers });
  } catch (err) {
    console.error("[Admin] list customers error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar clientes." });
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/customers/recurring — list recurring buyers (admin only)
// --------------------------------------------------------------------------
router.get("/admin/customers/recurring", requireAdminAuth, async (req, res) => {
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

    const customerKey = sql<string>`coalesce(nullif(lower(trim(${ordersTable.clientEmail})), ''), nullif(trim(${ordersTable.clientPhone}), ''), nullif(trim(${ordersTable.clientDocument}), ''))`;

    const parseProducts = (raw: unknown): Array<{ id: string; name: string; quantity: number; price?: number }> => {
      if (Array.isArray(raw)) return raw as Array<{ id: string; name: string; quantity: number; price?: number }>;
      if (typeof raw !== "string" || !raw.trim()) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as Array<{ id: string; name: string; quantity: number; price?: number }> : [];
      } catch {
        return [];
      }
    };

    const recurringCustomers = await db
      .select({
        id: customerKey.as("id"),
        name: sql<string>`max(${ordersTable.clientName})`.as("name"),
        email: sql<string>`max(${ordersTable.clientEmail})`.as("email"),
        phone: sql<string>`max(${ordersTable.clientPhone})`.as("phone"),
        firstOrderAt: sql<Date>`min(${ordersTable.createdAt})`.as("first_order_at"),
        lastOrderAt: sql<Date>`max(${ordersTable.createdAt})`.as("last_order_at"),
        orderCount: sql<number>`count(*)`.as("order_count"),
        totalSpent: sql<string>`coalesce(sum(cast(${ordersTable.total} as decimal(12,2))), 0)`.as("total_spent"),
        averageTicket: sql<string>`coalesce(avg(cast(${ordersTable.total} as decimal(12,2))), 0)`.as("average_ticket"),
      })
      .from(ordersTable)
      .where(
        and(
          buildOrdersTenantWhere(adminScope.tenantId),
          adminScope.hasGlobalAccess ? undefined : eq(ordersTable.sellerCode, adminScope.sellerCode!),
          sql`${customerKey} <> ''`,
        ),
      )
      .groupBy(customerKey)
      .having(sql`count(*) > 1`)
      .orderBy(asc(sql`max(${ordersTable.createdAt})`));

    const recurringCustomerRows = await db
      .select({
        customerId: customerKey.as("customer_id"),
        id: ordersTable.id,
        createdAt: ordersTable.createdAt,
        total: ordersTable.total,
        products: ordersTable.products,
        status: ordersTable.status,
      })
      .from(ordersTable)
      .where(
        and(
          buildOrdersTenantWhere(adminScope.tenantId),
          adminScope.hasGlobalAccess ? undefined : eq(ordersTable.sellerCode, adminScope.sellerCode!),
          sql`${customerKey} <> ''`,
        ),
      );

    const purchasesByCustomer = new Map<string, Array<{ id: string; createdAt: Date | null; total: number; status: string; products: Array<{ id: string; name: string; quantity: number; price?: number }> }>>();
    for (const row of recurringCustomerRows) {
      const customerId = String(row.customerId || "").trim();
      if (!customerId) continue;
      const purchase = {
        id: String(row.id || ""),
        createdAt: row.createdAt ?? null,
        total: Number(row.total || 0),
        status: String(row.status || ""),
        products: parseProducts(row.products),
      };
      const current = purchasesByCustomer.get(customerId) || [];
      current.push(purchase);
      purchasesByCustomer.set(customerId, current);
    }

    res.json({
      recurringCustomers: recurringCustomers.map((row) => ({
        id: String(row.id || ""),
        name: String(row.name || "Cliente"),
        email: String(row.email || ""),
        phone: String(row.phone || "") || null,
        firstOrderAt: row.firstOrderAt,
        lastOrderAt: row.lastOrderAt,
        orderCount: Number(row.orderCount || 0),
        totalSpent: Number(row.totalSpent || 0),
        averageTicket: Number(row.averageTicket || 0),
        purchases: (purchasesByCustomer.get(String(row.id || "").trim()) || []).map((purchase) => ({
          id: purchase.id,
          createdAt: purchase.createdAt?.toISOString() ?? null,
          total: purchase.total,
          status: purchase.status,
          products: purchase.products,
        })),
      })),
    });
  } catch (err) {
    console.error("[Admin] list recurring customers error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar clientes recorrentes." });
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/customers/:id/impersonate — create customer session (admin)
// --------------------------------------------------------------------------
router.post("/admin/customers/:id/impersonate", requireAdminAuth, async (req, res) => {
  try {
    const customerId = String(req.params.id || "").trim();
    if (!customerId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Cliente inválido." });
      return;
    }

    const adminScope = getAdminScope(req);
    if (!adminScope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    // Impersonação é sensível: permitido apenas para admin com acesso global.
    if (!adminScope.hasGlobalAccess) {
      res.status(403).json({ error: "FORBIDDEN", message: "Apenas administrador principal pode usar este recurso." });
      return;
    }

    const users = await db
      .select({ id: customerUsersTable.id, name: customerUsersTable.name, email: customerUsersTable.email })
      .from(customerUsersTable)
      .where(eq(customerUsersTable.id, customerId))
      .limit(1);

    const user = users[0];
    if (!user) {
      res.status(404).json({ error: "NOT_FOUND", message: "Cliente não encontrado." });
      return;
    }

    const hasOrders = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.userId, user.id))
      .limit(1);

    // Opcionalmente mantemos esse aviso para auditoria operacional.
    if (hasOrders.length === 0) {
      console.warn(`[Admin] impersonating customer without linked orders: ${user.id}`);
    }

    const session = createCustomerSession({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    res.json({
      token: session.token,
      expiresIn: session.expiresInSeconds,
      user,
    });
  } catch (err) {
    console.error("[Admin] customer impersonation error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao entrar na conta do cliente." });
  }
});

export default router;
