import { createHmac, randomUUID } from "crypto";
import { db, siteSettingsTable, tenantSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";

type OutboundEventType = "new_order" | "order_paid" | "test";

const EVENT_KEY_MAP: Record<Exclude<OutboundEventType, "test">, string> = {
  new_order: "outbound_webhook_event_new_order",
  order_paid: "outbound_webhook_event_order_paid",
};

async function getSettingValue(key: string, tenantId = DEFAULT_TENANT_ID): Promise<string> {
  const tenantRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);
  if (tenantRows[0]?.value != null) return String(tenantRows[0].value || "").trim();

  const legacyRows = tenantId === DEFAULT_TENANT_ID
    ? await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1)
    : [];
  return String(legacyRows[0]?.value || "").trim();
}

function isEnabledValue(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function isPushcutApiUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase() === "api.pushcut.io";
  } catch {
    return false;
  }
}

function isPushcutLegacyTokenPath(pathname: string): boolean {
  // Legacy Pushcut URLs look like: /<token>/notifications/<name>
  return /^\/[A-Za-z0-9_-]+\/notifications\/.+/.test(pathname);
}

function normalizePushcutUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== "api.pushcut.io") return value;
    // Keep legacy token-based paths untouched.
    if (isPushcutLegacyTokenPath(parsed.pathname)) {
      return parsed.toString();
    }
    if (!parsed.pathname.startsWith("/v1/")) {
      parsed.pathname = `/v1${parsed.pathname.startsWith("/") ? "" : "/"}${parsed.pathname}`;
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

async function postWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendOutboundWebhook(
  eventType: OutboundEventType,
  data: Record<string, unknown>,
  options?: { force?: boolean; tenantId?: string },
): Promise<{ sent: boolean; status?: number; error?: string }> {
  try {
    const tenantId = String(options?.tenantId || "").trim() || DEFAULT_TENANT_ID;
    const rawUrl = await getSettingValue("outbound_webhook_url", tenantId);
    if (!rawUrl) {
      return { sent: false, error: "webhook_url_not_configured" };
    }
    const url = isPushcutApiUrl(rawUrl) ? normalizePushcutUrl(rawUrl) : rawUrl;
    const pushcutV1Api = (() => {
      if (!isPushcutApiUrl(url)) return false;
      try {
        const parsed = new URL(url);
        return parsed.pathname.startsWith("/v1/");
      } catch {
        return false;
      }
    })();

    const enabled = isEnabledValue(await getSettingValue("outbound_webhook_enabled", tenantId));
    if (!options?.force && !enabled) {
      return { sent: false, error: "webhook_disabled" };
    }

    if (!options?.force && eventType !== "test") {
      const eventSettingKey = EVENT_KEY_MAP[eventType as Exclude<OutboundEventType, "test">];
      if (eventSettingKey) {
        const eventEnabled = isEnabledValue(await getSettingValue(eventSettingKey, tenantId));
        if (!eventEnabled) {
          return { sent: false, error: `event_disabled:${eventType}` };
        }
      }
    }

    const secret = await getSettingValue("outbound_webhook_secret", tenantId);
    const webhookId = randomUUID();
    const timestamp = new Date().toISOString();
    const payload = {
      id: webhookId,
      event: eventType,
      timestamp,
      data,
    };
    const body = JSON.stringify(payload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-KA-Webhook-Id": webhookId,
      "X-KA-Webhook-Event": eventType,
      "X-KA-Webhook-Timestamp": timestamp,
    };
    if (secret && pushcutV1Api) {
      headers["API-Key"] = secret;
    }
    if (secret && !pushcutV1Api) {
      headers["X-KA-Webhook-Signature"] = signPayload(secret, timestamp, body);
    }

    const maxAttempts = 3;
    let lastError = "unknown_error";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await postWithTimeout(url, {
          method: "POST",
          headers,
          body,
        }, 5000);

        if (response.ok) {
          return { sent: true, status: response.status };
        }

        lastError = `http_${response.status}`;
        if (attempt < maxAttempts) {
          await sleep(attempt * 700);
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : "request_failed";
        if (attempt < maxAttempts) {
          await sleep(attempt * 700);
        }
      }
    }

    console.error("[OUTBOUND_WEBHOOK] Failed to deliver event", {
      eventType,
      error: lastError,
      url,
    });
    return { sent: false, error: lastError };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unexpected_error";
    console.error("[OUTBOUND_WEBHOOK] Unexpected error", { eventType, error: message });
    return { sent: false, error: message };
  }
}
