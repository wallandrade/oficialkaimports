import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { exec } from "child_process";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://ka-imports.com",
  "https://www.ka-imports.com",
];

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

const sensitivePublicWritePaths = new Set([
  "/api/orders",
  "/api/checkout/pix",
  "/api/custom-charges",
  "/api/support/orders-by-cpf",
  "/api/support/tickets",
]);

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
};

const rateBuckets = new Map<string, RateBucket>();

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

// Log global de todas as requisições
app.use((req, res, next) => {
  const safeHeaders = {
    ...req.headers,
    authorization: req.headers.authorization ? "[REDACTED]" : undefined,
    cookie: req.headers.cookie ? "[REDACTED]" : undefined,
  };
  console.log(`[REQ] ${req.method} ${req.originalUrl} | headers:`, safeHeaders);
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

// Emergency anti-clone gate: reject non-official browser origins on public write routes.
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  if (!sensitivePublicWritePaths.has(req.path)) {
    next();
    return;
  }

  const origin = req.get("origin");
  if (origin && !isOriginAllowed(origin)) {
    console.warn("[SECURITY] Blocked public write by untrusted origin", {
      path: req.path,
      origin,
      ip: req.ip,
      ua: req.get("user-agent"),
    });
    res.status(403).json({ error: "FORBIDDEN_ORIGIN", message: "Origem não autorizada." });
    return;
  }

  next();
});

// Emergency anti-abuse limiter for public write endpoints.
app.use((req, res, next) => {
  if (!sensitivePublicWritePaths.has(req.path) || req.method !== "POST") {
    next();
    return;
  }

  const rule = publicWriteRateRules[req.path];
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
