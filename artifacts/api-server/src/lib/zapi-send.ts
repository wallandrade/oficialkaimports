import { zapiMainCredentials } from "./whatsapp-group-campaign";
import {
  isFakeWhatsappPhone,
  maskWhatsappPhone,
  type WhatsappInstanceKey,
  type WhatsappOutboundKind,
} from "./whatsapp-outbound-policy";

const ZAPI_HOST = "https://api.z-api.io";

export type ZapiSendInput = {
  instance: WhatsappInstanceKey;
  phone: string;
  kind: WhatsappOutboundKind;
  message?: string | null;
  caption?: string | null;
  image?: string | null;
  optionList?: unknown;
  live?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

export type ZapiSendResult = {
  ok: boolean;
  status: number;
  error?: string;
  terminal?: boolean;
  dryRun?: boolean;
};

function readPart(env: NodeJS.ProcessEnv, name: string): string {
  return String(env[name] || "").trim();
}

function validPart(value: string): boolean {
  return Boolean(value) && !value.includes("/") && !/[\s?#]/.test(value);
}

export function zapiCredentials(
  instance: WhatsappInstanceKey,
  env: NodeJS.ProcessEnv = process.env,
): { instanceId: string; token: string; clientToken: string } | null {
  if (instance === "poly") {
    const instanceId = readPart(env, "ZAPI_POLY_INSTANCE_ID");
    const token = readPart(env, "ZAPI_POLY_TOKEN");
    const clientToken = readPart(env, "ZAPI_POLY_CLIENT_TOKEN") || readPart(env, "ZAPI_CLIENT_TOKEN");
    if (!validPart(instanceId) || !validPart(token) || !validPart(clientToken)) return null;
    return { instanceId, token, clientToken };
  }
  return zapiMainCredentials(env);
}

export function zapiDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = String(env.WHATSAPP_ZAPI_DRY_RUN || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function zapiFakeOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = String(env.WHATSAPP_ZAPI_FAKE_ONLY || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function zapiInstanceReady(instance: WhatsappInstanceKey, env: NodeJS.ProcessEnv = process.env): boolean {
  if (zapiDryRun(env)) return true;
  return zapiCredentials(instance, env) != null;
}

export function zapiOutboundRequest(input: {
  phone: string;
  kind: WhatsappOutboundKind;
  message?: string | null;
  caption?: string | null;
  image?: string | null;
  optionList?: unknown;
}): { suffix: string; body: Record<string, unknown> } | { error: string } {
  const phone = String(input.phone || "").trim();
  if (!phone) return { error: "missing_phone" };
  if (input.kind === "option_list") {
    let optionList: unknown = input.optionList ?? null;
    if (typeof optionList === "string" && optionList.trim()) {
      try {
        optionList = JSON.parse(optionList) as unknown;
      } catch {
        optionList = input.optionList;
      }
    }
    if (!optionList || typeof optionList !== "object") return { error: "missing_options" };
    return {
      suffix: "/send-option-list",
      body: { phone, message: String(input.message || ""), optionList },
    };
  }
  if (input.kind === "image") {
    const image = String(input.image || "").trim();
    if (!image.startsWith("https://")) return { error: "missing_image" };
    return {
      suffix: "/send-image",
      body: { phone, image, caption: String(input.caption || input.message || "") },
    };
  }
  const message = String(input.message || input.caption || "");
  if (!message.trim()) return { error: "missing_message" };
  return { suffix: "/send-text", body: { phone, message } };
}

function zapiAccepted(status: number, raw: string): boolean {
  if (status < 200 || status >= 300) return false;
  if (!raw.trim()) return true;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; erro?: unknown };
    if (parsed && typeof parsed === "object" && (parsed.error || parsed.erro)) return false;
  } catch {
    return true;
  }
  return true;
}

export async function sendZapiMessage(input: ZapiSendInput): Promise<ZapiSendResult> {
  const env = input.env ?? process.env;
  const request = zapiOutboundRequest(input);
  if ("error" in request) return { ok: false, status: 0, error: request.error, terminal: true };
  const phone = String(request.body.phone || "");
  if (zapiDryRun(env)) {
    console.info("[WhatsApp Z-API] dry-run", {
      instance: input.instance,
      kind: input.kind,
      phoneMask: maskWhatsappPhone(phone),
    });
    return { ok: true, status: 0, dryRun: true };
  }
  if (zapiFakeOnly(env) && !isFakeWhatsappPhone(phone)) {
    console.warn("[WhatsApp Z-API] número fora do modo de teste", {
      instance: input.instance,
      phoneMask: maskWhatsappPhone(phone),
    });
    return { ok: false, status: 0, error: "fake_only", terminal: true };
  }
  if (input.live !== true && !isFakeWhatsappPhone(phone)) {
    return { ok: false, status: 0, error: "live_not_confirmed", terminal: true };
  }
  const creds = zapiCredentials(input.instance, env);
  if (!creds) return { ok: false, status: 0, error: "zapi_not_configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const url = `${ZAPI_HOST}/instances/${encodeURIComponent(creds.instanceId)}/token/${encodeURIComponent(creds.token)}${request.suffix}`;
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Client-Token": creds.clientToken,
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (zapiAccepted(response.status, raw)) return { ok: true, status: response.status };
    return { ok: false, status: response.status, error: `http_${response.status || 0}` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, status: 0, error: aborted ? "timeout" : "request_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
