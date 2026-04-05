const CUSTOMER_TOKEN_KEY = "customerToken";

export function getCustomerToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(CUSTOMER_TOKEN_KEY) || "";
}

export function saveCustomerToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
}

export function clearCustomerToken(): void {
  if (typeof window === "undefined") return;
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
