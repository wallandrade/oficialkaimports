import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { db, adminUsersTable, adminSessionsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Utilitário para limpar sessões expiradas do banco
async function purgeExpiredSessions() {
  const now = new Date();
  await db.delete(adminSessionsTable).where(
    lt(adminSessionsTable.expiresAt, now)
  );
}

// --------------------------------------------------------------------------
// Password hashing (using built-in crypto — no external deps)
// --------------------------------------------------------------------------
function hashPassword(password: string, salt: string): string {
  return crypto.createHash("sha256").update(password + salt).digest("hex");
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

// --------------------------------------------------------------------------
// Seed admin users from env vars on first run
// --------------------------------------------------------------------------
async function seedFromEnvIfEmpty() {
  const existing = await db.select({ id: adminUsersTable.id }).from(adminUsersTable).limit(1);
  if (existing.length > 0) return; // already seeded

  const usersToSeed: Array<{ username: string; password: string; isPrimary: boolean }> = [];

  if (process.env["ADMIN_USERNAME"] && process.env["ADMIN_PASSWORD"]) {
    usersToSeed.push({ username: process.env["ADMIN_USERNAME"], password: process.env["ADMIN_PASSWORD"], isPrimary: true });
  }
  if (process.env["ADMIN_USERNAME_2"] && process.env["ADMIN_PASSWORD_2"]) {
    usersToSeed.push({ username: process.env["ADMIN_USERNAME_2"], password: process.env["ADMIN_PASSWORD_2"], isPrimary: false });
  }

  for (const u of usersToSeed) {
    const existingUser = await db.select({ id: adminUsersTable.id }).from(adminUsersTable).where(eq(adminUsersTable.username, u.username.trim())).limit(1);
    if (existingUser.length > 0) continue;

    const salt = generateSalt();
    await db.insert(adminUsersTable).values({
      id:           crypto.randomBytes(8).toString("hex"),
      username:     u.username.trim(),
      passwordHash: hashPassword(u.password, salt),
      salt,
      isPrimary:    u.isPrimary,
    });
  }

  if (usersToSeed.length > 0) {
    console.log(`[AdminAuth] Seeded ${usersToSeed.length} admin user(s) from env vars.`);
  }
}

// Run seed on startup
seedFromEnvIfEmpty().catch(console.error);

// --------------------------------------------------------------------------
// Middleware
// --------------------------------------------------------------------------
export async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const tokenFromQuery = (req.query as Record<string, string>)["token"];
  if (tokenFromQuery && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${tokenFromQuery}`;
  }

  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  await purgeExpiredSessions();

  if (!token) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
    return;
  }
  const session = await db.select().from(adminSessionsTable).where(adminSessionsTable.token.eq(token)).limit(1);
  if (!session[0]) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
    return;
  }
  // Anexa info da sessão para downstream
  (req as any).adminSession = session[0];
  next();
}

export async function requirePrimaryAdmin(req: Request, res: Response, next: NextFunction) {
  const tokenFromQuery = (req.query as Record<string, string>)["token"];
  if (tokenFromQuery && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${tokenFromQuery}`;
  }

  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  await purgeExpiredSessions();

  if (!token) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
    return;
  }
  const session = await db.select().from(adminSessionsTable).where(adminSessionsTable.token.eq(token)).limit(1);
  if (!session[0] || !session[0].isPrimary) {
    res.status(403).json({ error: "FORBIDDEN", message: "Apenas o administrador principal pode realizar esta ação." });
    return;
  }
  (req as any).adminSession = session[0];
  next();
}

export async function getSessionInfo(req: Request) {
  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return undefined;
  const session = await db.select().from(adminSessionsTable).where(adminSessionsTable.token.eq(token)).limit(1);
  return session[0];
}

// --------------------------------------------------------------------------
// POST /api/admin/login
// --------------------------------------------------------------------------
router.post("/admin/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Usuário e senha são obrigatórios." });
    return;
  }

  try {
    const users = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.username, username.trim().toLowerCase()))
      .limit(1);

    // Also try case-insensitive via all users (small table)
    let user = users[0];
    if (!user) {
      const allUsers = await db.select().from(adminUsersTable);
      user = allUsers.find(
        (u) => u.username.toLowerCase() === username.trim().toLowerCase()
      );
    }

    if (!user) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Usuário ou senha incorretos." });
      return;
    }

    const hash = hashPassword(password, user.salt);
    if (hash !== user.passwordHash) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Usuário ou senha incorretos." });
      return;
    }

    await purgeExpiredSessions();
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await db.insert(adminSessionsTable).values({
      token,
      username: user.username,
      isPrimary: user.isPrimary ? 1 : 0,
      expiresAt,
      createdAt: new Date(),
    });
    res.json({ token, expiresIn: TOKEN_TTL_MS / 1000, isPrimary: user.isPrimary, username: user.username });
  } catch (err) {
    console.error("[AdminAuth] login error:", err, JSON.stringify(err, Object.getOwnPropertyNames(err)));
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao autenticar.", details: String(err) });
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/logout
// --------------------------------------------------------------------------
router.post("/admin/logout", async (req, res) => {
  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token) {
    await db.delete(adminSessionsTable).where(adminSessionsTable.token.eq(token));
  }
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// GET /api/admin/verify
// --------------------------------------------------------------------------
router.get("/admin/verify", requireAdminAuth, async (req, res) => {
  const session = (req as any).adminSession;
  res.json({ ok: true, isPrimary: !!session?.isPrimary, username: session?.username ?? "" });
});

// --------------------------------------------------------------------------
// GET /api/admin/users  — list all users (primary admin only)
// --------------------------------------------------------------------------
router.get("/admin/users", requirePrimaryAdmin, async (_req, res) => {
  try {
    const users = await db
      .select({ id: adminUsersTable.id, username: adminUsersTable.username, isPrimary: adminUsersTable.isPrimary, createdAt: adminUsersTable.createdAt })
      .from(adminUsersTable)
      .orderBy(adminUsersTable.createdAt);

    res.json({ users });
  } catch (err) {
    console.error("[AdminAuth] list users error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar usuários." });
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/users  — create a new user (primary admin only)
// --------------------------------------------------------------------------
router.post("/admin/users", requirePrimaryAdmin, async (req, res) => {
  const { username, password, fullAccess } = req.body as {
    username?: string; password?: string; fullAccess?: boolean;
  };

  if (!username || !password) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Usuário e senha são obrigatórios." });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Senha deve ter pelo menos 6 caracteres." });
    return;
  }

  try {
    const salt = generateSalt();
    const id   = crypto.randomBytes(8).toString("hex");
    const grantPrimary = fullAccess === true;

    await db.insert(adminUsersTable).values({
      id,
      username:     username.trim().toLowerCase(),
      passwordHash: hashPassword(password, salt),
      salt,
      isPrimary:    grantPrimary,
    });

    res.status(201).json({ id, username: username.trim().toLowerCase(), isPrimary: grantPrimary });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "CONFLICT", message: "Usuário já existe." });
    } else {
      console.error("[AdminAuth] create user error:", err);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar usuário." });
    }
  }
});

// --------------------------------------------------------------------------
// PATCH /api/admin/users/:id/access  — toggle full access (primary admin only)
// --------------------------------------------------------------------------
router.patch("/admin/users/:id/access", requirePrimaryAdmin, async (req, res) => {
  const { id } = req.params;
  // Garante que id é string
  const userId = Array.isArray(id) ? id[0] : id;
  const { fullAccess } = req.body as { fullAccess?: boolean };

  if (typeof fullAccess !== "boolean") {
    res.status(400).json({ error: "INVALID_INPUT", message: "fullAccess (boolean) é obrigatório." });
    return;
  }

  try {
    const existing = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, userId))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
      return;
    }

    // Prevent removing the last primary admin
    if (!fullAccess && existing[0].isPrimary) {
      const primaryCount = await db
        .select({ id: adminUsersTable.id })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.isPrimary, true));
      if (primaryCount.length <= 1) {
        res.status(400).json({ error: "INVALID_OP", message: "Deve existir pelo menos um administrador com acesso total." });
        return;
      }
    }

    await db
      .update(adminUsersTable)
      .set({ isPrimary: fullAccess })
      .where(eq(adminUsersTable.id, userId));

    res.json({ ok: true, id, isPrimary: fullAccess });
  } catch (err) {
    console.error("[AdminAuth] toggle access error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao alterar acesso." });
  }
});

// --------------------------------------------------------------------------
// PATCH /api/admin/users/:id/password  — change own password or (primary) any
// --------------------------------------------------------------------------
router.patch("/admin/users/:id/password", requireAdminAuth, async (req, res) => {
  const { id }       = req.params;
  const userId = Array.isArray(id) ? id[0] : id;
  const { password } = req.body as { password?: string };
  const session      = getSessionInfo(req);

  if (!password || password.length < 6) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Senha deve ter pelo menos 6 caracteres." });
    return;
  }

  try {
    const existing = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, userId))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
      return;
    }

    // Only allow if primary admin OR changing own account
    if (!session?.isPrimary && existing[0].username !== session?.username) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para alterar esta senha." });
      return;
    }

    const salt = generateSalt();
    await db
      .update(adminUsersTable)
      .set({ passwordHash: hashPassword(password, salt), salt })
      .where(eq(adminUsersTable.id, userId));

    res.json({ ok: true });
  } catch (err) {
    console.error("[AdminAuth] change password error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao alterar senha." });
  }
});

// --------------------------------------------------------------------------
// DELETE /api/admin/users/:id  — delete non-primary user (primary admin only)
// --------------------------------------------------------------------------
router.delete("/admin/users/:id", requirePrimaryAdmin, async (req, res) => {
  const { id } = req.params;
  const userId = Array.isArray(id) ? id[0] : id;

  try {
    const existing = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, userId))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
      return;
    }

    if (existing[0].isPrimary) {
      res.status(400).json({ error: "INVALID_OP", message: "Não é possível remover o administrador principal." });
      return;
    }

    await db.delete(adminUsersTable).where(eq(adminUsersTable.id, userId));
    res.json({ ok: true });
  } catch (err) {
    console.error("[AdminAuth] delete user error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao remover usuário." });
  }
});

export default router;
