export const GUEST_CUSTOMER_PREFIX = "guest:";
export const UNSET_PASSWORD_SALT_PREFIX = "nopass:";

export function isUnsetCustomerPassword(salt: unknown): boolean {
  return String(salt || "").startsWith(UNSET_PASSWORD_SALT_PREFIX);
}

export function parseGuestCustomerEmail(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw.toLowerCase().startsWith(GUEST_CUSTOMER_PREFIX)) return null;
  const email = raw.slice(GUEST_CUSTOMER_PREFIX.length).trim().toLowerCase();
  if (!isPlausibleEmail(email)) return null;
  return email;
}

function isPlausibleEmail(email: string): boolean {
  if (email.length < 3 || email.length > 255) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at >= email.length - 1) return false;
  return true;
}

export function pickTenantCustomer<T extends { tenantId?: string | null }>(rows: T[], tenantId: string): T | undefined {
  const exact = rows.find((row) => String(row.tenantId || "").trim() === tenantId);
  if (exact) return exact;
  const legacy = rows.find((row) => !String(row.tenantId || "").trim());
  return legacy || rows[0];
}
