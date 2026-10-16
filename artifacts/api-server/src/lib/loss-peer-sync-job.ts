import { isYuryLossPullConfigured, yuryLossPullBlockReason } from "./loss-sync-config";
import { pullYuryLossSnapshot } from "./loss-peer-sync";

const INTERVAL_MS = 10 * 60 * 1000;
const STARTUP_DELAY_MS = 20 * 1000;

async function runPull(reason: string): Promise<void> {
  if (!isYuryLossPullConfigured()) return;
  try {
    const result = await pullYuryLossSnapshot();
    console.log("[YuryLoss] pull ok", { reason, ...result });
  } catch (error) {
    console.error("[YuryLoss] pull failed", { reason, error });
  }
}

export function startYuryLossSyncJob(): void {
  const block = yuryLossPullBlockReason();
  if (block) {
    console.log("[YuryLoss] Sync job idle.", block);
    return;
  }
  console.log("[YuryLoss] Sync job every 10 min.");
  setTimeout(() => void runPull("startup"), STARTUP_DELAY_MS);
  setInterval(() => {
    void runPull("cron");
  }, INTERVAL_MS);
}
