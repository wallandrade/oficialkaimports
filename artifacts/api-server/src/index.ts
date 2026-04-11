import app from "./app";
import { startReconciliationJob } from "./reconciliation";
import { ensureRuntimeSchema } from "./runtime-schema";
import { startRaffleExpiryJob } from "./raffle-expiry";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Prevent unhandled promise rejections from crashing the server
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Server] Unhandled Rejection at:", promise, "reason:", reason);
});

// Prevent uncaught exceptions from crashing the server
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught Exception:", err.message, err.stack);
  // Do NOT exit — keep the server running
});

async function bootstrap(): Promise<void> {
  await ensureRuntimeSchema();

  app.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
    startReconciliationJob();
    startRaffleExpiryJob();
  });
}

void bootstrap();
