import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { exec } from "child_process";


const app: Express = express();

// Log global de todas as requisições
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl} | headers:`, req.headers);
  next();
});

app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.get("/force-migrate", (req, res) => {
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
