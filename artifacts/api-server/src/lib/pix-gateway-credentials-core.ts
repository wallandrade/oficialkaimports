export const PIX_GATEWAY_SETTING_KEYS = {
  publicKey: "gateway_appcnpay_public_key",
  secretKey: "gateway_appcnpay_secret_key",
} as const;

export type AppcnpayCredentialPair = {
  publicKey: string;
  secretKey: string;
  source: "tenant" | "env";
};

function trimKey(value: unknown): string {
  return String(value || "").trim();
}

export function isMaskedGatewaySecret(value: unknown): boolean {
  const text = trimKey(value);
  if (!text) return false;
  return /^\*+/.test(text) || text.includes("•");
}

export function maskGatewaySecret(value: string): string {
  const trimmed = trimKey(value);
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

export function pickAppcnpayCredentialPair(input: {
  tenantPublicKey?: string | null;
  tenantSecretKey?: string | null;
  envPublicKey?: string | null;
  envSecretKey?: string | null;
}): AppcnpayCredentialPair {
  const tenantPublicKey = trimKey(input.tenantPublicKey);
  const tenantSecretKey = trimKey(input.tenantSecretKey);
  if (tenantPublicKey && tenantSecretKey) {
    return { publicKey: tenantPublicKey, secretKey: tenantSecretKey, source: "tenant" };
  }
  if (tenantPublicKey || tenantSecretKey) {
    throw new Error("Configure a chave pública e a chave secreta APPCNPay desta loja.");
  }

  const envPublicKey = trimKey(input.envPublicKey);
  const envSecretKey = trimKey(input.envSecretKey);
  if (envPublicKey && envSecretKey) {
    return { publicKey: envPublicKey, secretKey: envSecretKey, source: "env" };
  }

  throw new Error("GATEWAY_IDENTIFIER and GATEWAY_SECRET must be set.");
}
