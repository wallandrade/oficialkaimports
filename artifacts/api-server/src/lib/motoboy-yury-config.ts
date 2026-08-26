const DEFAULT_YURY_API_BASE = "https://api.yury-imports.com";
const LAST_SYNC_SETTING_KEY = "motoboy_yury_last_synced_at";

export function getYuryMotoboyApiBase(): string {
  return String(process.env.YURY_API_BASE || DEFAULT_YURY_API_BASE).trim().replace(/\/$/, "") || DEFAULT_YURY_API_BASE;
}

export function getYuryMotoboySyncToken(): string {
  return String(process.env.YURY_MOTOBOY_SYNC_TOKEN || "").trim();
}

export function getYuryMotoboyWebhookSecret(): string {
  return String(process.env.YURY_MOTOBOY_WEBHOOK_SECRET || "").trim();
}

export function isYuryMotoboySyncConfigured(): boolean {
  return Boolean(getYuryMotoboySyncToken());
}

export function isYuryMotoboyWebhookConfigured(): boolean {
  return Boolean(getYuryMotoboyWebhookSecret());
}

export { LAST_SYNC_SETTING_KEY };
