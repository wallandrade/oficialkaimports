export const MAIN_STORE_TENANT_ID = "tenant_loja1";

/** Tenant vazio é a loja principal (linhas legadas). */
export function resolveStoreTenantId(
  tenantId: string | null | undefined,
  mainTenantId = MAIN_STORE_TENANT_ID,
): string {
  return String(tenantId || "").trim() || mainTenantId;
}

export function isMainStoreTenant(
  tenantId: string | null | undefined,
  mainTenantId = MAIN_STORE_TENANT_ID,
): boolean {
  return resolveStoreTenantId(tenantId, mainTenantId) === mainTenantId;
}

/**
 * Env do processo (N8N_*) só vale para a loja principal.
 * Filial ignora o env e fica só com o setting dela.
 * Tenant vazio conta como loja principal.
 */
export function whatsappServerEnv(
  tenantId: string | null | undefined,
  envValue: unknown,
  mainTenantId = MAIN_STORE_TENANT_ID,
): string {
  if (!isMainStoreTenant(tenantId, mainTenantId)) return "";
  return String(envValue ?? "").trim();
}

/**
 * Catálogo na edição/troca do pedido: loja gravada no pedido.
 * Pedido legado sem loja usa a loja da sessão admin.
 */
export function orderCatalogTenantId(
  orderTenantId: string | null | undefined,
  adminTenantId: string | null | undefined,
  mainTenantId = MAIN_STORE_TENANT_ID,
): string {
  const fromOrder = String(orderTenantId || "").trim();
  if (fromOrder) return fromOrder;
  return String(adminTenantId || "").trim() || mainTenantId;
}
