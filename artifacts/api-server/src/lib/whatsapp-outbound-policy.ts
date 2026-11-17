/** Ritmo da fila antiga do n8n: 1 mensagem a cada 10 minutos e no máximo 10 por hora, por número. */
export const WHATSAPP_SEND_GAP_MS = 10 * 60 * 1000;
export const WHATSAPP_HOURLY_CAP = 10;
export const WHATSAPP_MAX_ATTEMPTS = 8;
export const WHATSAPP_STALE_SENDING_MS = 15 * 60 * 1000;
export const WHATSAPP_AUTOMATION_SENDER = "5535992119139";

export const WHATSAPP_CHANNEL_SETTING = {
  paid: "zapi_channel_order_paid",
  filmagem: "zapi_channel_filmagem",
  tracking: "zapi_channel_tracking",
  posted: "zapi_channel_posted",
  out_for_delivery: "zapi_channel_out_for_delivery",
  delivered: "zapi_channel_delivered",
  support: "zapi_channel_support",
  support_menu: "zapi_channel_support_menu",
  recovery: "zapi_channel_recovery",
  delivery_correction: "zapi_channel_delivery_correction",
  shopee_route: "zapi_channel_shopee_route",
} as const;

export const WHATSAPP_CHANNEL_SETTING_KEYS = Object.values(WHATSAPP_CHANNEL_SETTING);

export type WhatsappNoticeOrigin = keyof typeof WHATSAPP_CHANNEL_SETTING;
export type WhatsappChannel = "direto" | "n8n";
export type WhatsappInstanceKey = "main" | "poly";
export type WhatsappOutboundKind = "text" | "image" | "option_list";

const ORIGIN_BY_SETTING = new Map<string, WhatsappNoticeOrigin>(
  (Object.entries(WHATSAPP_CHANNEL_SETTING) as Array<[WhatsappNoticeOrigin, string]>).map(([origin, key]) => [key, origin]),
);

/** Vazio fica no n8n. A Rota Shopee já sai pela Z-API, então o vazio dela continua direto. */
export function parseWhatsappChannel(origin: WhatsappNoticeOrigin, raw: string | null | undefined): WhatsappChannel {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "direto" || value === "n8n") return value;
  return origin === "shopee_route" ? "direto" : "n8n";
}

export function whatsappChannelSettingOrigin(key: string): WhatsappNoticeOrigin | null {
  return ORIGIN_BY_SETTING.get(key) ?? null;
}

export function normalizeWhatsappChannelSetting(key: string, value: string): WhatsappChannel | null {
  const origin = whatsappChannelSettingOrigin(key);
  if (!origin) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "direto" || normalized === "n8n") return normalized;
  return null;
}

export function whatsappBackoffMs(attempts: number): number {
  const step = Math.min(Math.max(1, Math.floor(attempts) || 1), 6);
  return Math.min(WHATSAPP_SEND_GAP_MS * 2 ** (step - 1), 60 * 60 * 1000);
}

export function whatsappInstanceCanSend(input: {
  sentInLastHour: number;
  sentInLastGap: boolean;
}): { ok: true } | { ok: false; reason: "gap" | "hourly" } {
  if (input.sentInLastHour >= WHATSAPP_HOURLY_CAP) return { ok: false, reason: "hourly" };
  if (input.sentInLastGap) return { ok: false, reason: "gap" };
  return { ok: true };
}

export function maskWhatsappPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  const tail = (digits || String(phone || "")).slice(-4);
  return tail ? `***${tail}` : "***";
}

/** Número de teste. 550000… não é um celular brasileiro real. */
export function isFakeWhatsappPhone(phone: string): boolean {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("550000") && digits.length >= 12 && digits.length <= 15;
}

export function whatsappInstanceKey(value: unknown): WhatsappInstanceKey {
  return String(value || "").trim().toLowerCase() === "poly" ? "poly" : "main";
}
