/**
 * Gateway Integration — APPCNPay
 * Endpoint: https://painel.appcnpay.com/api/v1/gateway/pix/receive
 * Auth:     x-public-key  (GATEWAY_IDENTIFIER)
 *           x-secret-key  (GATEWAY_SECRET)
 */
import crypto from "crypto";
import { getAppcnpayGatewayHeaders } from "./lib/pix-gateway-credentials";

export const GATEWAY_PIX_URL = "https://painel.appcnpay.com/api/v1/gateway/pix/receive";
export const DENTPEG_BASE_URL = "https://api.dentpeg.com/api/v1";
export const PIX_DURATION_MS = 15 * 60 * 1000; // 15 min
const DENTPEG_DEFAULT_MAX_AMOUNT_CENTS = 300000; // R$ 3.000,00

export type PixGatewayProvider = "appcnpay" | "dentpeg";

export function normalizePixGatewayProvider(raw: string | null | undefined): PixGatewayProvider {
  const normalized = String(raw || "").trim().toLowerCase();
  return normalized === "dentpeg" ? "dentpeg" : "appcnpay";
}

export async function getGatewayHeaders(tenantId?: string | null): Promise<Record<string, string>> {
  return getAppcnpayGatewayHeaders(tenantId);
}

export function getDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0]!;
}

export function genIdentifier(): string {
  return crypto.randomBytes(5).toString("base64url").slice(0, 10);
}

export interface GatewayPixResponse {
  transactionId: string;
  status: string;              // OK | FAILED | PENDING | REJECTED | CANCELED
  gatewayProvider?: PixGatewayProvider;
  fee?: number;
  order?: {
    id?: string;
    url?: string;
    receiptUrl?: string;
  };
  pix: {
    code: string;
    base64?: string;
    image?: string;
  };
  details?: string;
  errorDescription?: string;
}

export interface GatewayErrorResponse {
  statusCode?: number;
  errorCode?: string;
  message?: string;
  details?: {
    field?: string;
    value?: unknown;
    issue?: string;
  };
}

function getDentpegHeaders(): Record<string, string> {
  const apiKey = process.env["DENTPEG_API_KEY"] || "";
  if (!apiKey) {
    throw new Error("DENTPEG_API_KEY must be set.");
  }
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
  };
}

type DentpegDeposit = {
  id: string;
  status: string;
  amountInCents: number;
  feeCents?: number;
  qrCode?: string;
  qrImageUrl?: string;
};

function getDentpegMaxAmountCents(): number {
  const configuredMax = Number(process.env["DENTPEG_MAX_AMOUNT_CENTS"] || DENTPEG_DEFAULT_MAX_AMOUNT_CENTS);
  return Number.isFinite(configuredMax) && configuredMax > 0
    ? Math.floor(configuredMax)
    : DENTPEG_DEFAULT_MAX_AMOUNT_CENTS;
}

async function createDentpegPixCharge(payload: {
  amount: number;
}): Promise<GatewayPixResponse> {
  let headers: Record<string, string>;
  try {
    headers = getDentpegHeaders();
  } catch {
    throw new Error("DentPeg credentials not configured.");
  }

  const amountInCents = Math.round(Number(payload.amount || 0) * 100);
  if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
    throw new Error("Valor inválido para cobrança PIX.");
  }

  const maxAmountInCents = getDentpegMaxAmountCents();
  if (amountInCents > maxAmountInCents) {
    const maxFormatted = (maxAmountInCents / 100).toFixed(2).replace(".", ",");
    const currentFormatted = (amountInCents / 100).toFixed(2).replace(".", ",");
    throw new Error(`DentPeg aceita no máximo R$ ${maxFormatted} por PIX. Valor atual: R$ ${currentFormatted}.`);
  }

  const url = `${DENTPEG_BASE_URL}/deposits`;
  const body = { amountInCents };

  console.log("[DENTPEG] POST", url, JSON.stringify(body));
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  console.log(`[DENTPEG] Response ${res.status}:`, rawText.slice(0, 600));

  let data: { ok?: boolean; deposit?: DentpegDeposit; message?: string; error?: string };
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("Resposta inválida do gateway DentPeg.");
  }

  if (!res.ok || !data.deposit) {
    const msg = String(data.message || data.error || `Erro ${res.status} da DentPeg.`);
    if (msg.includes("amountInCents") && msg.includes("too_big")) {
      const maxMatch = msg.match(/"maximum"\s*:\s*(\d+)/i);
      const maxFromApi = maxMatch?.[1] ? Number(maxMatch[1]) : maxAmountInCents;
      const maxFormatted = (maxFromApi / 100).toFixed(2).replace(".", ",");
      throw new Error(`DentPeg rejeitou o valor: máximo permitido é R$ ${maxFormatted} por PIX.`);
    }
    throw new Error(msg);
  }

  if (!data.deposit.id) {
    throw new Error("DentPeg não retornou ID do depósito.");
  }

  if (!data.deposit.qrCode) {
    throw new Error("DentPeg não retornou o código PIX.");
  }

  return {
    transactionId: data.deposit.id,
    status: data.deposit.status || "pending",
    gatewayProvider: "dentpeg",
    fee: typeof data.deposit.feeCents === "number" ? data.deposit.feeCents / 100 : undefined,
    pix: {
      code: data.deposit.qrCode,
      image: data.deposit.qrImageUrl,
    },
  };
}

/**
 * Call the gateway to create a PIX charge.
 * Returns the parsed response or throws with a user-friendly message.
 */
export async function createPixCharge(payload: {
  identifier: string;
  amount: number;
  client: { name: string; email: string; phone: string; document: string };
  products?: Array<{ id: string; name: string; quantity?: number; price: number; physical?: boolean }>;
  dueDate?: string;
  metadata?: Record<string, string>;
  callbackUrl?: string;
  tenantId?: string | null;
}): Promise<GatewayPixResponse> {
  let headers: Record<string, string>;
  try {
    headers = await getGatewayHeaders(payload.tenantId);
  } catch (err) {
    throw new Error("Gateway credentials not configured.");
  }

  // products is optional per the API spec — omit to avoid catalog validation errors
  const body: Record<string, unknown> = {
    identifier: payload.identifier,
    amount:     Number(payload.amount),
    client:     payload.client,
    dueDate:    payload.dueDate || getDueDate(),
    metadata:   payload.metadata,
    callbackUrl: payload.callbackUrl,
  };

  // Only include products if explicitly provided and non-empty
  if (payload.products && payload.products.length > 0) {
    body["products"] = payload.products;
  }

  console.log("[GATEWAY] POST", GATEWAY_PIX_URL, JSON.stringify({
    ...body,
    callbackUrl: body.callbackUrl ? "[redacted]" : undefined,
  }));

  const res = await fetch(GATEWAY_PIX_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  console.log(`[GATEWAY] Response ${res.status}:`, rawText.slice(0, 600));

  let data: GatewayPixResponse & GatewayErrorResponse;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("Resposta inválida do gateway de pagamento.");
  }

  if (!res.ok) {
    const msg = data.message || data.errorDescription || `Erro ${res.status} do gateway.`;
    throw new Error(msg);
  }

  if (!data.transactionId) {
    throw new Error("Gateway não retornou ID da transação.");
  }

  if (!data.pix?.code) {
    throw new Error("Gateway não retornou o código PIX. Tente novamente.");
  }

  return {
    ...(data as GatewayPixResponse),
    gatewayProvider: "appcnpay",
  };
}

export async function createPixChargeWithProvider(payload: {
  identifier: string;
  amount: number;
  client: { name: string; email: string; phone: string; document: string };
  products?: Array<{ id: string; name: string; quantity?: number; price: number; physical?: boolean }>;
  dueDate?: string;
  metadata?: Record<string, string>;
  callbackUrl?: string;
  provider: PixGatewayProvider;
  tenantId?: string | null;
}): Promise<GatewayPixResponse> {
  if (payload.provider === "dentpeg") {
    const amountInCents = Math.round(Number(payload.amount || 0) * 100);
    const maxDentpegAmount = getDentpegMaxAmountCents();

    if (amountInCents > maxDentpegAmount) {
      console.warn(`[GATEWAY] DentPeg limit exceeded (${amountInCents} > ${maxDentpegAmount}). Falling back to APPCNPay.`);
      const fallback = await createPixCharge(payload);
      return {
        ...fallback,
        gatewayProvider: "appcnpay",
      };
    }

    try {
      return await createDentpegPixCharge({ amount: payload.amount });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTooBig = message.includes("amountInCents") && message.includes("too_big");
      if (isTooBig) {
        console.warn("[GATEWAY] DentPeg returned too_big. Falling back to APPCNPay.");
        const fallback = await createPixCharge(payload);
        return {
          ...fallback,
          gatewayProvider: "appcnpay",
        };
      }
      throw err;
    }
  }

  return createPixCharge(payload);
}

/**
 * Build the callback URL for the current request.
 * Priority:
 *   1. REPLIT_DOMAINS env var (most reliable in Replit hosted environment)
 *   2. x-forwarded-host header (set by reverse proxies)
 *   3. host header (fallback)
 *   4. localhost (last resort — gateway won't be able to reach this)
 */
export function buildCallbackUrl(req: {
  headers: Record<string, string | string[] | undefined>;
}, path: string): string {
  const replitDomains = process.env["REPLIT_DOMAINS"];
  if (replitDomains) {
    // REPLIT_DOMAINS may be a comma-separated list; take the first one
    const primaryDomain = replitDomains.split(",")[0]?.trim();
    if (primaryDomain) {
      return `https://${primaryDomain}/api${path}`;
    }
  }
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}/api${path}`;
}

/**
 * Determine if a gateway status string means the payment was confirmed.
 * Covers both the PIX creation response (OK) and the transactions API (COMPLETED).
 */
export function isPaymentConfirmed(status: string): boolean {
  const s = (status || "").toUpperCase();
  const confirmed = [
    "OK", "PAID", "APPROVED", "CONFIRMED", "COMPLETED", "SUCCESS",
    "DEPIX_SENT",
    // Portuguese variants from APPCNPay
    "PAGO", "PAGA", "CONCLUIDO", "CONCLUÍDA", "CONCLUIDA",
    "APROVADO", "APROVADA",
  ];
  return confirmed.some((c) => s === c || s.includes(c));
}

export const GATEWAY_TRANSACTIONS_URL =
  "https://painel.appcnpay.com/api/v1/gateway/transactions";

/**
 * Fetch a transaction's current status directly from the gateway.
 * Returns null if the request fails or the transaction is not found.
 */
export async function fetchTransactionStatus(
  transactionId: string,
  tenantId?: string | null,
): Promise<{ status: string; payedAt?: string | null } | null> {
  let headers: Record<string, string>;
  try {
    headers = await getGatewayHeaders(tenantId);
  } catch {
    return null;
  }

  try {
    const url = `${GATEWAY_TRANSACTIONS_URL}?id=${encodeURIComponent(transactionId)}`;
    const res = await fetch(url, { method: "GET", headers });
    const rawBody = await res.text();
    if (!res.ok) {
      console.warn(`[GATEWAY] fetchTransactionStatus ${res.status} for ${transactionId} — body: ${rawBody.slice(0, 300)}`);
      // Try alternate param name "transactionId"
      const url2 = `${GATEWAY_TRANSACTIONS_URL}?transactionId=${encodeURIComponent(transactionId)}`;
      const res2 = await fetch(url2, { method: "GET", headers });
      const raw2 = await res2.text();
      if (!res2.ok) {
        console.warn(`[GATEWAY] fetchTransactionStatus (alt) ${res2.status} — body: ${raw2.slice(0, 300)}`);
        return null;
      }
      const data2 = JSON.parse(raw2) as { status?: string; payedAt?: string | null };
      if (!data2?.status) return null;
      return { status: data2.status, payedAt: data2.payedAt ?? null };
    }
    const data = JSON.parse(rawBody) as { status?: string; payedAt?: string | null };
    if (!data?.status) return null;
    return { status: data.status, payedAt: data.payedAt ?? null };
  } catch (err) {
    console.error("[GATEWAY] fetchTransactionStatus error:", err);
    return null;
  }
}

export async function fetchDentpegDepositStatus(
  depositId: string,
): Promise<{ status: string } | null> {
  let headers: Record<string, string>;
  try {
    headers = getDentpegHeaders();
  } catch {
    return null;
  }

  try {
    const res = await fetch(`${DENTPEG_BASE_URL}/deposits/${encodeURIComponent(depositId)}`, {
      method: "GET",
      headers,
    });
    const raw = await res.text();
    if (!res.ok) {
      console.warn(`[DENTPEG] fetchDepositStatus ${res.status} for ${depositId} — body: ${raw.slice(0, 300)}`);
      return null;
    }

    const data = JSON.parse(raw) as { deposit?: { status?: string } };
    if (!data.deposit?.status) return null;
    return { status: data.deposit.status };
  } catch (err) {
    console.error("[DENTPEG] fetchDepositStatus error:", err);
    return null;
  }
}
