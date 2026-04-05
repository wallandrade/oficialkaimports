import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db, customerUsersTable, ordersTable, affiliatesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import {
  createCustomerSession,
  generateSalt,
  getCustomerSession,
  hashPassword,
  removeCustomerSession,
  requireCustomerAuth,
} from "../middlewares/customer-auth";
import { requireAdminAuth } from "./admin-auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
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
      .where(eq(customerUsersTable.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "CONFLICT", message: "Já existe uma conta com esse e-mail." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    const salt = generateSalt();

    await db.insert(customerUsersTable).values({
      id,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(password, salt),
      salt,
      updatedAt: new Date(),
    });

    const session = createCustomerSession({ userId: id, email: normalizedEmail, name: name.trim() });

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
      .where(eq(customerUsersTable.email, normalizedEmail))
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
    .where(eq(customerUsersTable.id, session.userId))
    .limit(1);

  const user = users[0];
  if (!user) {
    res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
    return;
  }

  res.json({ user });
});

// --------------------------------------------------------------------------
// GET /api/admin/customers  — list all registered customers (admin only)
// --------------------------------------------------------------------------
router.get("/admin/customers", requireAdminAuth, async (req, res) => {
  try {
    const customers = await db
      .select({
        id: customerUsersTable.id,
        name: customerUsersTable.name,
        email: customerUsersTable.email,
        createdAt: customerUsersTable.createdAt,
      })
      .from(customerUsersTable)
      .orderBy(desc(customerUsersTable.createdAt));

    // Count orders per customer
    const orderCounts = await db
      .select({
        userId: ordersTable.userId,
        orderCount: sql<number>`count(*)`.as("order_count"),
      })
      .from(ordersTable)
      .groupBy(ordersTable.userId);

    const orderCountMap = new Map<string, number>();
    for (const row of orderCounts) {
      if (row.userId) orderCountMap.set(row.userId, Number(row.orderCount));
    }

    // Fetch affiliate codes
    const affiliateRows = await db
      .select({ userId: affiliatesTable.userId, affiliateCode: affiliatesTable.affiliateCode })
      .from(affiliatesTable);

    const affiliateCodeMap = new Map<string, string>();
    for (const row of affiliateRows) {
      affiliateCodeMap.set(row.userId, row.affiliateCode);
    }

    const enriched = customers.map((c) => ({
      ...c,
      orderCount: orderCountMap.get(c.id) ?? 0,
      affiliateCode: affiliateCodeMap.get(c.id) ?? null,
    }));

    res.json({ customers: enriched });
  } catch (err) {
    console.error("[Admin] list customers error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar clientes." });
  }
});

export default router;
