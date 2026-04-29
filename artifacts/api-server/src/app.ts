import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { exec } from "child_process";
import crypto from "crypto";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://ka-imports.com",
  "https://www.ka-imports.com",
];

const SECURITY_ORIGIN_ENFORCE = String(process.env.SECURITY_ORIGIN_ENFORCE || "false").toLowerCase() === "true";
const SECURITY_REQUIRE_CHECKOUT_TOKEN_SECRET =
  String(process.env.SECURITY_REQUIRE_CHECKOUT_TOKEN_SECRET || "false").toLowerCase() === "true";

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.trim();
  }
}

function getAllowedOrigins(): Set<string> {
  const fromEnv = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeOrigin);
  const values = fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
  return new Set(values);
}

const allowedOrigins = getAllowedOrigins();

function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) return true;
  return allowedOrigins.has(normalizeOrigin(origin));
}

function getRefererOrigin(referer?: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

const sensitivePublicWritePaths = new Set([
  "/api/orders",
  "/api/checkout/pix",
  "/api/custom-charges",
  "/api/support/orders-by-cpf",
  "/api/support/tickets",
]);

const sensitivePublicWritePathPatterns = [
  /^\/api\/raffles\/reservations\/[^/]+\/refresh-pix$/,
  /^\/api\/kyc\/[^/]+$/,
];

const sensitivePublicReadPaths = new Set([
  "/api/raffles/reservations/lookup",
]);

const sensitivePublicReadPathPatterns = [
  /^\/api\/kyc\/check-cpf\/[^/]+$/,
  /^\/api\/kyc\/[^/]+$/,
];

const CHECKOUT_TOKEN_TTL_MS = Number(process.env.CHECKOUT_TOKEN_TTL_MS || 5 * 60 * 1000);
const CHECKOUT_TOKEN_SECRET = process.env.CHECKOUT_TOKEN_SECRET || "";

type CheckoutTokenPayload = {
  ts: number;
  nonce: string;
  uaHash: string;
};

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

function hashUserAgent(ua: string): string {
  return crypto.createHash("sha256").update(ua || "unknown").digest("hex");
}

function signCheckoutPayload(payloadB64: string): string {
  const effectiveSecret = CHECKOUT_TOKEN_SECRET || "unsafe-dev-secret-change-me";
  return toBase64Url(
    crypto.createHmac("sha256", effectiveSecret).update(payloadB64).digest(),
  );
}

function createCheckoutToken(userAgent: string): string {
  const payload: CheckoutTokenPayload = {
    ts: Date.now(),
    nonce: crypto.randomBytes(8).toString("hex"),
    uaHash: hashUserAgent(userAgent),
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = signCheckoutPayload(payloadB64);
  return `${payloadB64}.${signature}`;
}

function verifyCheckoutToken(token: string, userAgent: string): boolean {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return false;

  const expectedSignature = signCheckoutPayload(payloadB64);
  if (signature !== expectedSignature) return false;

  let payload: CheckoutTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64).toString("utf8")) as CheckoutTokenPayload;
  } catch {
    return false;
  }

  if (!payload?.ts || !payload?.uaHash) return false;
  const age = Date.now() - Number(payload.ts);
  if (age < 0 || age > CHECKOUT_TOKEN_TTL_MS) return false;
  if (payload.uaHash !== hashUserAgent(userAgent)) return false;
  return true;
}

type RateLimitRule = {
  windowMs: number;
  max: number;
};

type RateBucket = {
  count: number;
  resetAt: number;
};

const publicWriteRateRules: Record<string, RateLimitRule> = {
  "/api/orders": {
    windowMs: Number(process.env.RL_PUBLIC_ORDERS_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_ORDERS_MAX || 40),
  },
  "/api/checkout/pix": {
    windowMs: Number(process.env.RL_PUBLIC_CHECKOUT_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_CHECKOUT_MAX || 40),
  },
  "/api/custom-charges": {
    windowMs: Number(process.env.RL_PUBLIC_CUSTOM_CHARGES_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_CUSTOM_CHARGES_MAX || 25),
  },
  "/api/support/orders-by-cpf": {
    windowMs: Number(process.env.RL_PUBLIC_SUPPORT_LOOKUP_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_SUPPORT_LOOKUP_MAX || 40),
  },
  "/api/support/tickets": {
    windowMs: Number(process.env.RL_PUBLIC_SUPPORT_TICKETS_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_SUPPORT_TICKETS_MAX || 20),
  },
  "/api/raffles/reservations/:id/refresh-pix": {
    windowMs: Number(process.env.RL_PUBLIC_RAFFLE_REFRESH_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_RAFFLE_REFRESH_MAX || 12),
  },
  "/api/kyc/:orderId": {
    windowMs: Number(process.env.RL_PUBLIC_KYC_SUBMIT_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_KYC_SUBMIT_MAX || 12),
  },
};

const publicReadRateRules: Record<string, RateLimitRule> = {
  "/api/raffles/reservations/lookup": {
    windowMs: Number(process.env.RL_PUBLIC_RAFFLE_LOOKUP_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_RAFFLE_LOOKUP_MAX || 25),
  },
  "/api/kyc/check-cpf/:cpf": {
    windowMs: Number(process.env.RL_PUBLIC_KYC_CHECK_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_KYC_CHECK_MAX || 40),
  },
  "/api/kyc/:orderId": {
    windowMs: Number(process.env.RL_PUBLIC_KYC_LOOKUP_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RL_PUBLIC_KYC_LOOKUP_MAX || 25),
  },
};

const rateBuckets = new Map<string, RateBucket>();
const readRateBuckets = new Map<string, RateBucket>();

function isSensitivePublicWritePath(path: string): boolean {
  if (sensitivePublicWritePaths.has(path)) return true;
  return sensitivePublicWritePathPatterns.some((pattern) => pattern.test(path));
}

function isSensitivePublicReadPath(path: string): boolean {
  if (sensitivePublicReadPaths.has(path)) return true;
  return sensitivePublicReadPathPatterns.some((pattern) => pattern.test(path));
}

function resolvePublicWriteRule(path: string): RateLimitRule | undefined {
  const direct = publicWriteRateRules[path];
  if (direct) return direct;
  if (/^\/api\/raffles\/reservations\/[^/]+\/refresh-pix$/.test(path)) {
    return publicWriteRateRules["/api/raffles/reservations/:id/refresh-pix"];
  }
  if (/^\/api\/kyc\/[^/]+$/.test(path)) {
    return publicWriteRateRules["/api/kyc/:orderId"];
  }
  return undefined;
}

function resolvePublicReadRule(path: string): RateLimitRule | undefined {
  const direct = publicReadRateRules[path];
  if (direct) return direct;
  if (/^\/api\/kyc\/check-cpf\/[^/]+$/.test(path)) {
    return publicReadRateRules["/api/kyc/check-cpf/:cpf"];
  }
  if (/^\/api\/kyc\/[^/]+$/.test(path)) {
    return publicReadRateRules["/api/kyc/:orderId"];
  }
  return undefined;
}

function verifyCheckoutTokenOrReject(req: express.Request, res: express.Response): boolean {
  if (SECURITY_REQUIRE_CHECKOUT_TOKEN_SECRET && !CHECKOUT_TOKEN_SECRET) {
    res.status(503).json({
      error: "SECURITY_MISCONFIGURED",
      message: "Configuração de segurança incompleta.",
    });
    return false;
  }

  const checkoutToken = req.get("x-checkout-token") || "";
  if (!checkoutToken || !verifyCheckoutToken(checkoutToken, req.get("user-agent") || "")) {
    console.warn("[SECURITY] Missing/invalid checkout token", {
      path: req.path,
      ip: getIp(req),
      origin: req.get("origin"),
      ua: req.get("user-agent"),
    });
    res.status(403).json({
      error: "INVALID_CHECKOUT_TOKEN",
      message: "Sessão de checkout inválida. Recarregue a página e tente novamente.",
    });
    return false;
  }
  return true;
}

function getIp(req: express.Request): string {
  const xf = String(req.get("x-forwarded-for") || "").split(",")[0]?.trim();
  return xf || req.ip || "unknown";
}

function cleanupExpiredRateBuckets(now: number): void {
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateBuckets.delete(key);
    }
  }
}

const app: Express = express();
app.set("trust proxy", 1);

if (!process.env.CORS_ALLOWED_ORIGINS) {
  console.warn("[SECURITY] CORS_ALLOWED_ORIGINS não definido. Usando fallback interno.");
}
if (!CHECKOUT_TOKEN_SECRET) {
  console.warn("[SECURITY] CHECKOUT_TOKEN_SECRET não definido. Defina no ambiente para proteção máxima.");
}
if (SECURITY_REQUIRE_CHECKOUT_TOKEN_SECRET && !CHECKOUT_TOKEN_SECRET) {
  console.error("[SECURITY] SECURITY_REQUIRE_CHECKOUT_TOKEN_SECRET=true, mas CHECKOUT_TOKEN_SECRET não está definido.");
}

// Selective logging middleware - only log sensitive paths and errors
const VERBOSE_LOG_PATHS = new Set([
  "/api/orders",
  "/api/admin",
  "/api/checkout/pix",
  "/api/kyc",
  "/api/raffles/reservations",
  "/api/custom-charges",
]);

app.use((req, res, next) => {
  // Only log if it's a sensitive path or if we're in development
  const shouldLog = process.env.NODE_ENV === "development" || 
                   Array.from(VERBOSE_LOG_PATHS).some(path => req.path.startsWith(path));
  
  if (shouldLog) {
    const safeHeaders = {
      ...req.headers,
      authorization: req.headers.authorization ? "[REDACTED]" : undefined,
      cookie: req.headers.cookie ? "[REDACTED]" : undefined,
    };
    console.log(`[REQ] ${req.method} ${req.originalUrl} | headers:`, safeHeaders);
  }
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS_ORIGIN_DENIED"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.get("/api/security/checkout-token", (req, res) => {
  if (SECURITY_REQUIRE_CHECKOUT_TOKEN_SECRET && !CHECKOUT_TOKEN_SECRET) {
    res.status(503).json({ error: "SECURITY_MISCONFIGURED", message: "Configuração de segurança incompleta." });
    return;
  }

  const origin = req.get("origin");
  if (origin && !isOriginAllowed(origin)) {
    res.status(403).json({ error: "FORBIDDEN_ORIGIN", message: "Origem não autorizada." });
    return;
  }

  const token = createCheckoutToken(req.get("user-agent") || "");
  res.json({ token, expiresInMs: CHECKOUT_TOKEN_TTL_MS });
});

// Emergency anti-clone gate: reject non-official browser origins on public write routes.
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  if (!isSensitivePublicWritePath(req.path)) {
    next();
    return;
  }

  const origin = req.get("origin");
  const referer = req.get("referer");
  const refererOrigin = getRefererOrigin(referer);

  const hasSuspiciousOrigin = Boolean(origin && !isOriginAllowed(origin));
  const hasSuspiciousReferer = Boolean(refererOrigin && !isOriginAllowed(refererOrigin));

  if (hasSuspiciousOrigin || hasSuspiciousReferer) {
    const logPayload = {
      path: req.path,
      origin,
      referer,
      refererOrigin,
      ip: req.ip,
      ua: req.get("user-agent"),
    };

    if (SECURITY_ORIGIN_ENFORCE) {
      console.warn("[SECURITY] Blocked public write by suspicious origin/referer", logPayload);
      res.status(403).json({ error: "FORBIDDEN_ORIGIN", message: "Origem não autorizada." });
      return;
    }

    console.warn("[SECURITY] Suspicious origin/referer detected (monitor mode)", logPayload);
  }

  next();
});

// Emergency anti-abuse limiter for public write endpoints.
app.use((req, res, next) => {
  if (!isSensitivePublicWritePath(req.path) || req.method !== "POST") {
    next();
    return;
  }

  // Authenticated admin/customer writes do not require checkout token.
  if (req.get("authorization")) {
    next();
    return;
  }

  if (!verifyCheckoutTokenOrReject(req, res)) return;

  const rule = resolvePublicWriteRule(req.path);
  if (!rule || rule.max <= 0 || rule.windowMs <= 0) {
    next();
    return;
  }

  const now = Date.now();
  cleanupExpiredRateBuckets(now);

  const ip = getIp(req);
  const bucketKey = `${req.path}|${ip}`;
  const current = rateBuckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
    next();
    return;
  }

  if (current.count >= rule.max) {
    const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    console.warn("[SECURITY] Rate limit exceeded", {
      path: req.path,
      ip,
      count: current.count,
      max: rule.max,
      retryAfterSec,
      ua: req.get("user-agent"),
    });
    res.status(429).json({
      error: "RATE_LIMITED",
      message: "Muitas tentativas. Tente novamente em instantes.",
      retryAfterSec,
    });
    return;
  }

  current.count += 1;
  next();
});

// Protection for sensitive public read endpoints that expose customer-linked records.
app.use((req, res, next) => {
  if (req.method !== "GET" || !isSensitivePublicReadPath(req.path)) {
    next();
    return;
  }

  if (!verifyCheckoutTokenOrReject(req, res)) return;

  const rule = resolvePublicReadRule(req.path);
  if (!rule || rule.max <= 0 || rule.windowMs <= 0) {
    next();
    return;
  }

  const now = Date.now();
  cleanupExpiredRateBuckets(now);
  for (const [key, bucket] of readRateBuckets.entries()) {
    if (bucket.resetAt <= now) readRateBuckets.delete(key);
  }

  const ip = getIp(req);
  const bucketKey = `${req.path}|${ip}`;
  const current = readRateBuckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    readRateBuckets.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
    next();
    return;
  }

  if (current.count >= rule.max) {
    const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({
      error: "RATE_LIMITED",
      message: "Muitas tentativas. Tente novamente em instantes.",
      retryAfterSec,
    });
    return;
  }

  current.count += 1;
  next();
});

app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.get("/force-migrate", (req, res) => {
  if (process.env.ENABLE_FORCE_MIGRATE !== "true") {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }

  const maintenanceKey = process.env.FORCE_MIGRATE_KEY;
  const providedKey = req.get("x-maintenance-key");
  if (!maintenanceKey || providedKey !== maintenanceKey) {
    res.status(403).json({ error: "FORBIDDEN", message: "Acesso negado." });
    return;
  }

  exec(
    "cd ../../lib/db && npx --yes drizzle-kit push --force --config ./drizzle.config.ts",
    { cwd: process.cwd() },
    (error, stdout, stderr) => {
      res.json({ error: error?.message, stdout, stderr, cwd: process.cwd(), date: new Date().toISOString() });
    }
  );
});

app.get("/health", (req, res) => {
  res.send("OK");
});


app.use("/api", router);

// Middleware global de tratamento de erros
app.use((err, req, res, next) => {
  console.error("[GLOBAL ERROR]", err);
  res.status(err.status || 500).json({
    error: true,
    message: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

export default app;
