const DEFAULT_TENANT_ID = "tenant_loja1";

export function pickPreferredAdminTenant<T extends { tenantId: string; role: string }>(
  rows: T[],
): (T & { tenantId: string; role: string }) | null {
  const normalized = rows
    .map((row) => ({
      ...row,
      tenantId: String(row.tenantId || "").trim(),
      role: String(row.role || "").trim().toLowerCase(),
    }))
    .filter((row) => row.tenantId.length > 0);

  if (normalized.length === 0) return null;

  const nonDefaultOwner = normalized.find((row) => row.tenantId !== DEFAULT_TENANT_ID && row.role === "owner");
  if (nonDefaultOwner) return nonDefaultOwner;

  const nonDefault = normalized.find((row) => row.tenantId !== DEFAULT_TENANT_ID);
  if (nonDefault) return nonDefault;

  return normalized[0];
}
