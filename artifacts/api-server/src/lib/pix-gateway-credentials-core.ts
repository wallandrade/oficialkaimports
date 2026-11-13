export const PIX_GATEWAY_SETTING_KEYS = {
  publicKey: "gateway_appcnpay_public_key",
  secretKey: "gateway_appcnpay_secret_key",
} as const;

export const PIX_NOT_CONFIGURED_FOR_STORE = "PIX não configurado para esta loja";
export const MAIN_STORE_TENANT_ID = "tenant_loja1";

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

/** Conta global (env APPCNPay ou a única conta DentPeg) só vale para a loja principal. Tenant vazio = legado da loja 1. */
export function canUseSharedPixAccount(
  tenantId: string | null | undefined,
  mainTenantId = MAIN_STORE_TENANT_ID,
): boolean {
  const resolved = String(tenantId || "").trim() || mainTenantId;
  return resolved === mainTenantId;
}

export function pickAppcnpayCredentialPair(input: {
  tenantPublicKey?: string | null;
  tenantSecretKey?: string | null;
  envPublicKey?: string | null;
  envSecretKey?: string | null;
  allowEnvFallback?: boolean;
}): AppcnpayCredentialPair {
  const tenantPublicKey = trimKey(input.tenantPublicKey);
  const tenantSecretKey = trimKey(input.tenantSecretKey);
  if (tenantPublicKey && tenantSecretKey) {
    return { publicKey: tenantPublicKey, secretKey: tenantSecretKey, source: "tenant" };
  }
  if (tenantPublicKey || tenantSecretKey) {
    throw new Error("Configure a chave pública e a chave secreta APPCNPay desta loja.");
  }

  if (input.allowEnvFallback) {
    const envPublicKey = trimKey(input.envPublicKey);
    const envSecretKey = trimKey(input.envSecretKey);
    if (envPublicKey && envSecretKey) {
      return { publicKey: envPublicKey, secretKey: envSecretKey, source: "env" };
    }
    throw new Error("GATEWAY_IDENTIFIER and GATEWAY_SECRET must be set.");
  }

  throw new Error(PIX_NOT_CONFIGURED_FOR_STORE);
}

/** Cobrança de diferença: tenant do pedido; se o legado estiver vazio, o da sessão admin. */
export function resolveDifferenceChargeTenantId(
  orderTenantId: string | null | undefined,
  adminTenantId: string | null | undefined,
): string {
  const fromOrder = String(orderTenantId || "").trim();
  if (fromOrder) return fromOrder;
  const fromAdmin = String(adminTenantId || "").trim();
  return fromAdmin || MAIN_STORE_TENANT_ID;
}
