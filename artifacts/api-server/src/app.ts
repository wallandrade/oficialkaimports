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

const app: Express = express();

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
