export const LEGACY_DEFAULT_TENANT_ID = "tenant_loja1";

export type TenantSettingRow = {
  tenantId: string | null;
  key: string;
  value: string;
};

/**
 * Rank da linha na leitura da loja.
 * 2 = tenant exato. 1 = residual NULL ou '' só da loja padrão. 0 = outra loja.
 */
export function tenantSettingRowRank(
  rowTenantId: string | null | undefined,
  preferredTenantId: string,
  legacyTenantId: string = LEGACY_DEFAULT_TENANT_ID,
): number {
  if (rowTenantId === preferredTenantId) return 2;
  if (preferredTenantId === legacyTenantId && (rowTenantId == null || rowTenantId === "")) return 1;
  return 0;
}

/**
 * Monta o mapa da loja. A linha do tenant exato ganha de NULL e de ''.
 * Empate no mesmo rank fica com a primeira linha. Filial não herda residual da loja 1.
 */
export function mergeTenantSettingRows(
  rows: readonly TenantSettingRow[],
  preferredTenantId: string,
  legacyTenantId: string = LEGACY_DEFAULT_TENANT_ID,
): Record<string, string> {
  const out: Record<string, string> = {};
  const rankByKey = new Map<string, number>();
  for (const row of rows) {
    const rank = tenantSettingRowRank(row.tenantId, preferredTenantId, legacyTenantId);
    if (rank === 0) continue;
    const current = rankByKey.get(row.key) ?? 0;
    if (rank > current) {
      out[row.key] = row.value;
      rankByKey.set(row.key, rank);
    }
  }
  return out;
}
