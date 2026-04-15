const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TokenCache = {
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

export async function getCheckoutToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > now + 10_000) {
    return tokenCache.token;
  }

  const res = await fetch(`${BASE}/api/security/checkout-token`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error("checkout_token_fetch_failed");
  }

  const data = await res.json() as { token?: string; expiresInMs?: number };
  if (!data.token) {
    throw new Error("checkout_token_missing");
  }

  const ttl = Number(data.expiresInMs) > 0 ? Number(data.expiresInMs) : 5 * 60 * 1000;
  tokenCache = {
    token: data.token,
    expiresAt: now + ttl,
  };

  return data.token;
}

export async function getCheckoutSecurityHeaders(additional?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getCheckoutToken();
  return {
    "Content-Type": "application/json",
    "x-checkout-token": token,
    ...(additional || {}),
  };
}
