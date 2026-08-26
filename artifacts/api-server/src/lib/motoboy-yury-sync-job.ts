import { isYuryMotoboySyncConfigured } from "./motoboy-yury-config";
import { pullYuryMotoboyCoverage } from "./motoboy-yury-sync";

const INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 2 * 60 * 1000;

async function runPull(reason: string): Promise<void> {
  if (!isYuryMotoboySyncConfigured()) return;
  try {
    const result = await pullYuryMotoboyCoverage();
    console.log("[YuryMotoboy] pull ok", { reason, ...result });
  } catch (error) {
    console.error("[YuryMotoboy] pull failed", { reason, error });
  }
}

export function startYuryMotoboyCoverageSyncJob(): void {
  if (!isYuryMotoboySyncConfigured()) {
    console.log("[YuryMotoboy] Coverage sync job idle (YURY_MOTOBOY_SYNC_TOKEN ausente).");
    return;
  }

  console.log("[YuryMotoboy] Coverage sync job every 15 min.");
  setTimeout(() => void runPull("startup"), STARTUP_DELAY_MS);
  setInterval(() => {
    void runPull("cron");
  }, INTERVAL_MS);
}
