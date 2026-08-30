import { isYuryInventorySyncConfigured } from "./motoboy-yury-config";
import { pullYuryInventorySnapshot } from "./yury-inventory-sync";

const INTERVAL_MS = 3 * 60 * 1000;
const STARTUP_DELAY_MS = 20 * 1000;

async function runPull(reason: string): Promise<void> {
  if (!isYuryInventorySyncConfigured()) return;
  try {
    const result = await pullYuryInventorySnapshot();
    console.log("[YuryInventory] pull ok", { reason, ...result });
  } catch (error) {
    console.error("[YuryInventory] pull failed", { reason, error });
  }
}

export function startYuryInventorySyncJob(): void {
  if (!isYuryInventorySyncConfigured()) {
    console.log("[YuryInventory] Sync job idle (token ausente).");
    return;
  }

  console.log("[YuryInventory] Sync job every 3 min.");
  setTimeout(() => void runPull("startup"), STARTUP_DELAY_MS);
  setInterval(() => {
    void runPull("cron");
  }, INTERVAL_MS);
}
