import { isYuryMetaAdsSyncConfigured } from "./meta-ads-spend";
import { pullYuryMetaAdsSpend } from "./meta-ads-sync";

const INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 20 * 1000;

async function runPull(reason: string): Promise<void> {
  if (!isYuryMetaAdsSyncConfigured()) return;
  try {
    const result = await pullYuryMetaAdsSpend();
    if (result.action === "log") {
      console.log("[YuryMetaAds] sem gravar", { reason, status: result.status, error: result.error });
      return;
    }
    if (result.action === "keep" || result.action === "idle") {
      console.error("[YuryMetaAds] sem gravar", { reason, cause: result.action === "keep" ? result.cause : "token ausente" });
      return;
    }
    console.log("[YuryMetaAds] pull ok", {
      reason,
      since: result.since,
      until: result.until,
      upserted: result.upserted,
      deleted: result.deleted,
    });
  } catch (error) {
    console.error("[YuryMetaAds] pull failed", { reason, error });
  }
}

export function startYuryMetaAdsSyncJob(): void {
  if (!isYuryMetaAdsSyncConfigured()) {
    console.log("[YuryMetaAds] Sync job idle (YURY_META_ADS_SYNC_TOKEN ausente).");
    return;
  }
  console.log("[YuryMetaAds] Sync job every 60 min.");
  setTimeout(() => void runPull("startup"), STARTUP_DELAY_MS);
  setInterval(() => {
    void runPull("cron");
  }, INTERVAL_MS);
}
