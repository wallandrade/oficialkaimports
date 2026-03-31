/**
 * Gateway Integration — APPCNPay
 * Endpoint: https://painel.appcnpay.com/api/v1/gateway/pix/receive
 * Auth:     x-public-key  (GATEWAY_IDENTIFIER)
 *           x-secret-key  (GATEWAY_SECRET)
 */
import crypto from "crypto";

export const GATEWAY_PIX_URL = "https://painel.appcnpay.com/api/v1/gateway/pix/receive";
export const PIX_DURATION_MS = 15 * 60 * 1000; // 15 min

export function getGatewayHeaders(): Record<string, string> {
  const publicKey  = process.env["GATEWAY_IDENTIFIER"] || "";
  const secretKey  = process.env["GATEWAY_SECRET"] || "";

  if (!publicKey || !secretKey) {
    throw new Error("GATEWAY_IDENTIFIER and GATEWAY_SECRET must be set.");
  }

  return {
    "Content-Type": "application/json",
    "x-public-key": publicKey,
    "x-secret-key": secretKey,
  };
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
}): Promise<GatewayPixResponse> {
  let headers: Record<string, string>;
  try {
    headers = getGatewayHeaders();
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

  return data as GatewayPixResponse;
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
): Promise<{ status: string; payedAt?: string | null } | null> {
  let headers: Record<string, string>;
  try {
    headers = getGatewayHeaders();
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
