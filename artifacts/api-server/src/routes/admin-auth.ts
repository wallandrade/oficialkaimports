import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { db, adminUsersTable, adminSessionsTable } from "@workspace/db";
import { lt, eq } from "drizzle-orm";

const router: IRouter = Router();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const ADMIN_AUTH_VERBOSE_LOGS = String(process.env.ADMIN_AUTH_VERBOSE_LOGS || "false").toLowerCase() === "true";
const ADMIN_ALLOW_QUERY_TOKEN = String(process.env.ADMIN_ALLOW_QUERY_TOKEN || "true").toLowerCase() === "true";
const ADMIN_LOGIN_RATE_WINDOW_MS = Number(process.env.ADMIN_LOGIN_RATE_WINDOW_MS || 10 * 60 * 1000);
const ADMIN_LOGIN_RATE_MAX_ATTEMPTS = Number(process.env.ADMIN_LOGIN_RATE_MAX_ATTEMPTS || 8);
const ADMIN_LOGIN_RATE_BLOCK_MS = Number(process.env.ADMIN_LOGIN_RATE_BLOCK_MS || 15 * 60 * 1000);
const ADMIN_SESSION_COOKIE_NAME = String(process.env.ADMIN_SESSION_COOKIE_NAME || "admin_session").trim();
const ADMIN_SESSION_COOKIE_SAMESITE = (() => {
  const raw = String(process.env.ADMIN_SESSION_COOKIE_SAMESITE || (process.env.NODE_ENV === "production" ? "none" : "lax")).trim().toLowerCase();
  if (raw === "none" || raw === "lax" || raw === "strict") return raw as "none" | "lax" | "strict";
  return process.env.NODE_ENV === "production" ? "none" : "lax";
})();
const ADMIN_SESSION_COOKIE_SECURE = (() => {
  const configured = String(process.env.ADMIN_SESSION_COOKIE_SECURE || (process.env.NODE_ENV === "production" ? "true" : "false")).toLowerCase() === "true";
  // Browsers require Secure when SameSite=None.
  return configured || ADMIN_SESSION_COOKIE_SAMESITE === "none";
})();

type AdminSessionRecord = {
  username: string;
  isPrimary: number | boolean;
};

export type AdminScope = {
  username: string;
  isPrimary: boolean;
  hasGlobalAccess: boolean;
  sellerCode: string | null;
};

let adminSellerScopeMapCache: Record<string, string> | null = null;
const adminLoginRateBuckets = new Map<string, { count: number; resetAt: number; blockedUntil: number }>();

function respondInternalError(res: Response, message: string, err: unknown) {
  if (!IS_PRODUCTION) {
    res.status(500).json({ error: "INTERNAL_ERROR", message, details: String(err) });
    return;
  }
  res.status(500).json({ error: "INTERNAL_ERROR", message });
}

function getRequestIp(req: Request): string {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return xf || req.ip || "unknown";
}

function cleanupExpiredAdminLoginBuckets(now: number): void {
  for (const [key, bucket] of adminLoginRateBuckets.entries()) {
    if (bucket.blockedUntil <= now && bucket.resetAt <= now) {
      adminLoginRateBuckets.delete(key);
    }
  }
}

function getAdminLoginBucket(ip: string, now: number): { count: number; resetAt: number; blockedUntil: number } {
  const existing = adminLoginRateBuckets.get(ip);
  if (!existing || existing.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + ADMIN_LOGIN_RATE_WINDOW_MS, blockedUntil: 0 };
    adminLoginRateBuckets.set(ip, fresh);
    return fresh;
  }
  return existing;
}

function registerAdminLoginFailure(ip: string, now: number): void {
  const bucket = getAdminLoginBucket(ip, now);
  bucket.count += 1;
  if (bucket.count >= ADMIN_LOGIN_RATE_MAX_ATTEMPTS) {
    bucket.blockedUntil = Math.max(bucket.blockedUntil, now + ADMIN_LOGIN_RATE_BLOCK_MS);
  }
}

function clearAdminLoginFailures(ip: string): void {
  adminLoginRateBuckets.delete(ip);
}

function redactToken(token: string): string {
  if (!token) return "";
  if (token.length <= 12) return "[REDACTED]";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function sanitizeHeadersForLog(headers: Request["headers"]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => {
      const normalized = key.toLowerCase();
      if (normalized === "authorization" || normalized === "cookie") {
        return [key, "[REDACTED]"];
      }
      return [key, value];
    }),
  );
}

function getTokenFromRequest(req: Request): string {
  const auth = req.headers.authorization || "";
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearerToken) return bearerToken;

  const cookieToken = String((req as any).cookies?.[ADMIN_SESSION_COOKIE_NAME] || "").trim();
  if (cookieToken) return cookieToken;

  const tokenFromQuery = String((req.query as Record<string, string>)?.token || "").trim();
  if (tokenFromQuery && ADMIN_ALLOW_QUERY_TOKEN) {
    if (ADMIN_AUTH_VERBOSE_LOGS) {
      console.warn("[AdminAuth] Token via query string (legacy mode) usado em", req.path);
    }
    return tokenFromQuery;
  }

  return "";
}

function normalizeSellerCode(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function getAdminSellerScopeMap(): Record<string, string> {
  if (adminSellerScopeMapCache) return adminSellerScopeMapCache;

  const raw = process.env["ADMIN_SELLER_SCOPE_MAP"];
  if (!raw) {
    adminSellerScopeMapCache = {};
    return adminSellerScopeMapCache;
  }

  try {
    const parsed = JSON.parse(raw);
    const map: Record<string, string> = {};

    if (parsed && typeof parsed === "object") {
      for (const [username, sellerCode] of Object.entries(parsed as Record<string, unknown>)) {
        const normalizedUsername = String(username).trim().toLowerCase();
        const normalizedSeller = normalizeSellerCode(sellerCode);
        if (normalizedUsername && normalizedSeller) {
          map[normalizedUsername] = normalizedSeller;
        }
      }
    }

    adminSellerScopeMapCache = map;
    return map;
  } catch (err) {
    console.error("[AdminAuth] ADMIN_SELLER_SCOPE_MAP inválido. Use JSON no formato {\"usuario\":\"seller-slug\"}.", err);
    adminSellerScopeMapCache = {};
    return adminSellerScopeMapCache;
  }
}

export function resolveAdminScopeFromSession(session: AdminSessionRecord): AdminScope {
  const username = String(session.username || "").trim().toLowerCase();
  const isPrimary = !!session.isPrimary;
  if (isPrimary) {
    return {
      username,
      isPrimary,
      hasGlobalAccess: true,
      sellerCode: null,
    };
  }

  const sellerCode = getAdminSellerScopeMap()[username] ?? null;
  return {
    username,
    isPrimary,
    hasGlobalAccess: false,
    sellerCode,
  };
}

export function getAdminScope(req: Request): AdminScope | null {
  const session = (req as any).adminSession;
  if (!session) return null;
  return {
    username: String(session.username || "").trim().toLowerCase(),
    isPrimary: !!session.isPrimary,
    hasGlobalAccess: !!session.hasGlobalAccess,
    sellerCode: normalizeSellerCode(session.sellerCode),
  };
}

export async function verifyCurrentAdminPassword(req: Request, password: string): Promise<boolean> {
  const plain = String(password || "");
  if (!plain) return false;

  const session = (req as any).adminSession as { username?: string } | undefined;
  const sessionUsername = String(session?.username || "").trim().toLowerCase();
  if (!sessionUsername) return false;

  let user = (
    await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.username, sessionUsername))
      .limit(1)
  )[0];

  if (!user) {
    const allUsers = await db.select().from(adminUsersTable);
    user = allUsers.find((u) => u.username.toLowerCase() === sessionUsername);
  }

  if (!user) return false;
  const hash = hashPassword(plain, user.salt);
  return hash === user.passwordHash;
}

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
  try {
    if (ADMIN_AUTH_VERBOSE_LOGS) {
      console.log('[requireAdminAuth] INICIO', { headers: sanitizeHeadersForLog(req.headers), query: req.query });
    }
    const token = getTokenFromRequest(req);
    await purgeExpiredSessions();

    if (!token) {
      if (ADMIN_AUTH_VERBOSE_LOGS) {
        console.log('[requireAdminAuth] Sem token');
      }
      res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
      return;
    }
    const sessionRows = await db.select().from(adminSessionsTable).where(eq(adminSessionsTable.token, token)).limit(1);
    if (!sessionRows[0]) {
      if (ADMIN_AUTH_VERBOSE_LOGS) {
        console.log('[requireAdminAuth] Sessão não encontrada para token', redactToken(token));
      }
      res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
      return;
    }
    const scope = resolveAdminScopeFromSession(sessionRows[0]);

    if (!scope.hasGlobalAccess && !scope.sellerCode) {
      res.status(403).json({
        error: "FORBIDDEN",
        message: "Usuário admin sem seller vinculado. Configure ADMIN_SELLER_SCOPE_MAP.",
      });
      return;
    }

    // Anexa info da sessão para downstream
    (req as any).adminSession = { ...sessionRows[0], ...scope };
    if (ADMIN_AUTH_VERBOSE_LOGS) {
      console.log('[requireAdminAuth] Sessão OK', {
        username: scope.username,
        isPrimary: scope.isPrimary,
        hasGlobalAccess: scope.hasGlobalAccess,
        sellerCode: scope.sellerCode,
        expiresAt: sessionRows[0].expiresAt,
      });
    }
    next();
  } catch (err) {
    console.error('[requireAdminAuth] Erro:', err);
    respondInternalError(res, "Erro interno na autenticação.", err);
  }
}

export async function requirePrimaryAdmin(req: Request, res: Response, next: NextFunction) {
  const token = getTokenFromRequest(req);
  await purgeExpiredSessions();

  if (!token) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
    return;
  }
  const sessionRows = await db.select().from(adminSessionsTable).where(eq(adminSessionsTable.token, token)).limit(1);
  if (!sessionRows[0] || !sessionRows[0].isPrimary) {
    res.status(403).json({ error: "FORBIDDEN", message: "Apenas o administrador principal pode realizar esta ação." });
    return;
  }
  const scope = resolveAdminScopeFromSession(sessionRows[0]);
  (req as any).adminSession = { ...sessionRows[0], ...scope };
  next();
}

export async function getSessionInfo(req: Request) {
  const token = getTokenFromRequest(req);
  if (!token) return undefined;
  const sessionRows = await db.select().from(adminSessionsTable).where(eq(adminSessionsTable.token, token)).limit(1);
  if (!sessionRows[0]) return undefined;
  return { ...sessionRows[0], ...resolveAdminScopeFromSession(sessionRows[0]) };
}

// --------------------------------------------------------------------------
// POST /api/admin/login
// --------------------------------------------------------------------------
router.post("/admin/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  const ip = getRequestIp(req);
  const now = Date.now();

  cleanupExpiredAdminLoginBuckets(now);
  const bucket = getAdminLoginBucket(ip, now);
  if (bucket.blockedUntil > now) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({
      error: "RATE_LIMITED",
      message: "Muitas tentativas de login. Tente novamente em instantes.",
      retryAfterSec,
    });
    return;
  }

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
      registerAdminLoginFailure(ip, now);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Usuário ou senha incorretos." });
      return;
    }

    const hash = hashPassword(password, user.salt);
    if (hash !== user.passwordHash) {
      registerAdminLoginFailure(ip, now);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Usuário ou senha incorretos." });
      return;
    }

    clearAdminLoginFailures(ip);

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
    res.cookie(ADMIN_SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: ADMIN_SESSION_COOKIE_SECURE,
      sameSite: ADMIN_SESSION_COOKIE_SAMESITE,
      path: "/api",
      maxAge: TOKEN_TTL_MS,
    });
    const sellerCode = resolveAdminScopeFromSession({ username: user.username, isPrimary: user.isPrimary }).sellerCode;
    res.json({ token, expiresIn: TOKEN_TTL_MS / 1000, isPrimary: user.isPrimary, username: user.username, sellerCode });
  } catch (err) {
    console.error("[AdminAuth] login error:", err, JSON.stringify(err, Object.getOwnPropertyNames(err)));
    respondInternalError(res, "Erro ao autenticar.", err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/logout
// --------------------------------------------------------------------------
router.post("/admin/logout", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
      return;
    }

    const sessionRows = await db.select().from(adminSessionsTable).where(eq(adminSessionsTable.token, token)).limit(1);
    if (!sessionRows[0]) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
      return;
    }

    await db.delete(adminSessionsTable).where(eq(adminSessionsTable.token, token));
    res.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: ADMIN_SESSION_COOKIE_SECURE,
      sameSite: ADMIN_SESSION_COOKIE_SAMESITE,
      path: "/api",
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[AdminAuth] logout error:", err);
    respondInternalError(res, "Erro ao encerrar sessão.", err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/verify
// --------------------------------------------------------------------------
router.get("/admin/verify", requireAdminAuth, async (req, res) => {
  try {
    console.log('[admin/verify] INICIO', {
      username: (req as any).adminSession?.username,
      isPrimary: !!(req as any).adminSession?.isPrimary,
      sellerCode: (req as any).adminSession?.sellerCode ?? null,
    });
    const session = (req as any).adminSession;
    res.json({ ok: true, isPrimary: !!session?.isPrimary, username: session?.username ?? "" });
    console.log('[admin/verify] SUCESSO', { username: session?.username });
  } catch (err) {
    console.error('[admin/verify] Erro:', err);
    respondInternalError(res, "Erro interno no endpoint /admin/verify.", err);
  }
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
// PATCH /api/admin/users/:id/password  — change own password (primary admin) or any user (super)
// --------------------------------------------------------------------------
router.patch("/admin/users/:id/password", requireAdminAuth, async (req, res) => {
  const { id }       = req.params;
  const userId = Array.isArray(id) ? id[0] : id;
  const { password } = req.body as { password?: string };
  const session      = await getSessionInfo(req);

  if (!password || password.length < 6) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Senha deve ter pelo menos 6 caracteres." });
    return;
  }

  if (!session) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Acesso não autorizado." });
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

    const targetUsername = String(existing[0].username || "").trim().toLowerCase();
    const actorUsername = String(session.username || "").trim().toLowerCase();

    // Allow password change if actor is primary admin or is changing their own account.
    if (!session.isPrimary && targetUsername !== actorUsername) {
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
