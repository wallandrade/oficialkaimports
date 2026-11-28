export function whatsappWebhookAllowsQueryToken(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.WHATSAPP_WEBHOOK_ALLOW_QUERY_TOKEN || "true").trim().toLowerCase() === "true";
}

export function readWhatsappSupportToken(input: {
  headerToken?: string | null;
  queryToken?: unknown;
  allowQueryToken: boolean;
}): string {
  const headerToken = String(input.headerToken || "").trim();
  if (headerToken) return headerToken;
  if (!input.allowQueryToken || typeof input.queryToken !== "string") return "";
  return input.queryToken.trim();
}
