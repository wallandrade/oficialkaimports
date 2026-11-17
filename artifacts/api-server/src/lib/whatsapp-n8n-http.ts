import { isHttpsWebhookUrl } from "./whatsapp-notices";

const TIMEOUT_MS = 8000;
const ATTEMPTS = 2;

export async function postN8nJson(url: string, payload: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!isHttpsWebhookUrl(url)) return false;
  const body = JSON.stringify(payload);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (response.ok) return true;
      console.warn("[WHATSAPP_N8N] POST recusou", { attempt, status: response.status });
    } catch (err) {
      console.warn("[WHATSAPP_N8N] POST falhou", {
        attempt,
        error: err instanceof Error ? err.name : "request_failed",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  return false;
}
