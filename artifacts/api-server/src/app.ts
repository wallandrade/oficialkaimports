import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { exec } from "child_process";

const app: Express = express();

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

export default app;
