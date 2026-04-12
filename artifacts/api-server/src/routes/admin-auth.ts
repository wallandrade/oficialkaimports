import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// In-memory session store: token -> { expiresAt, username, isPrimary }
const sessions = new Map<string, { expiresAt: number; username: string; isPrimary: boolean }>();

function purgeExpired() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(token);
  }
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
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const tokenFromQuery = (req.query as Record<string, string>)["token"];
  if (tokenFromQuery && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${tokenFromQuery}`;
  }

  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  purgeExpired();

  if (!token || !sessions.has(token)) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
    return;
  }
  next();
}

export function requirePrimaryAdmin(req: Request, res: Response, next: NextFunction): void {
  const tokenFromQuery = (req.query as Record<string, string>)["token"];
  if (tokenFromQuery && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${tokenFromQuery}`;
  }

  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  purgeExpired();

  const session = token ? sessions.get(token) : undefined;
  if (!session || !session.isPrimary) {
    res.status(403).json({ error: "FORBIDDEN", message: "Apenas o administrador principal pode realizar esta ação." });
    return;
  }
  next();
}

export function getSessionInfo(req: Request) {
  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return sessions.get(token);
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

    purgeExpired();
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { expiresAt: Date.now() + TOKEN_TTL_MS, username: user.username, isPrimary: user.isPrimary });

    res.json({ token, expiresIn: TOKEN_TTL_MS / 1000, isPrimary: user.isPrimary, username: user.username });
  } catch (err) {
    console.error("[AdminAuth] login error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao autenticar." });
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/logout
// --------------------------------------------------------------------------
router.post("/admin/logout", (req, res) => {
  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// GET /api/admin/verify
// --------------------------------------------------------------------------
router.get("/admin/verify", requireAdminAuth, (req, res) => {
  const session = getSessionInfo(req);
  res.json({ ok: true, isPrimary: session?.isPrimary ?? false, username: session?.username ?? "" });
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
