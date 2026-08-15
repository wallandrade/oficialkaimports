const CUSTOMER_TOKEN_KEY = "customerToken";
const CUSTOMER_TOKEN_HASH_PREFIX = "customerToken=";

function consumeCustomerTokenFromLocation(): void {
  if (typeof window === "undefined") return;
  const hash = String(window.location.hash || "").replace(/^#/, "");
  if (!hash.startsWith(CUSTOMER_TOKEN_HASH_PREFIX)) return;
  const token = decodeURIComponent(hash.slice(CUSTOMER_TOKEN_HASH_PREFIX.length)).trim();
  if (!token) return;
  saveCustomerToken(token);
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function getCustomerToken(): string {
  if (typeof window === "undefined") return "";
  consumeCustomerTokenFromLocation();
  return sessionStorage.getItem(CUSTOMER_TOKEN_KEY) || localStorage.getItem(CUSTOMER_TOKEN_KEY) || "";
}

export function saveCustomerToken(token: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(CUSTOMER_TOKEN_KEY, token);
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
}

export function buildCustomerImpersonationUrl(basePath: string, token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const path = `${String(basePath || "").replace(/\/$/, "")}/minha-conta/pedidos`;
  return `${origin}${path}#${CUSTOMER_TOKEN_HASH_PREFIX}${encodeURIComponent(token)}`;
}

export function clearCustomerToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(CUSTOMER_TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
}

export function getCustomerAuthHeaders(): HeadersInit {
  const token = getCustomerToken();
  if (!token) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export type CustomerProfile = {
  id: string;
  name: string;
  email: string;
};

export async function fetchCustomerProfile(baseUrl: string): Promise<CustomerProfile | null> {
  const token = getCustomerToken();
  if (!token) return null;

  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: getCustomerAuthHeaders(),
  });

  if (!res.ok) {
    if (res.status === 401) clearCustomerToken();
    return null;
  }

  const data = (await res.json()) as { user?: CustomerProfile };
  return data.user || null;
}
