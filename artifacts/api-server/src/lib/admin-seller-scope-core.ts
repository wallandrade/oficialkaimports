export const SELLER_SCOPE_LINKED = "linked";
export const SELLER_SCOPE_CLEARED = "cleared";

export type ExplicitSellerScope = {
  status: "linked" | "cleared";
  tenantId: string;
  sellerCode: string | null;
  sellerValid: boolean;
};

export type SellerAccess = {
  hasGlobalAccess: boolean;
  sellerCode: string | null;
  tenantId: string;
  /** Sem vendedor e sem admin de loja: a sessão não entra no painel. */
  denied: boolean;
};

/**
 * Decide o acesso de um admin que não é o superadmin.
 * Vínculo gravado no painel ganha do mapa externo.
 * Vínculo removido não volta a usar o mapa.
 * Admin de filial, sem vínculo de vendedor, continua na loja inteira.
 */
export function resolveSellerAccess(input: {
  isPrimary: boolean;
  sessionTenantId: string;
  defaultTenantId: string;
  explicit: ExplicitSellerScope | null;
  legacySellerCode: string | null;
  storeAdminTenantId: string | null;
}): SellerAccess {
  const sessionTenant = String(input.sessionTenantId || "").trim() || input.defaultTenantId;
  if (input.isPrimary) {
    return { hasGlobalAccess: true, sellerCode: null, tenantId: sessionTenant, denied: false };
  }

  if (input.explicit?.status === SELLER_SCOPE_LINKED) {
    const sellerCode = String(input.explicit.sellerCode || "").trim().toLowerCase();
    if (!sellerCode || !input.explicit.sellerValid) {
      return {
        hasGlobalAccess: false,
        sellerCode: null,
        tenantId: String(input.explicit.tenantId || "").trim() || sessionTenant,
        denied: true,
      };
    }
    return {
      hasGlobalAccess: false,
      sellerCode,
      tenantId: String(input.explicit.tenantId || "").trim() || input.defaultTenantId,
      denied: false,
    };
  }

  if (input.explicit?.status === SELLER_SCOPE_CLEARED) {
    return storeAdminOrDeny(input.storeAdminTenantId, sessionTenant, input.defaultTenantId);
  }

  if (input.storeAdminTenantId && input.storeAdminTenantId !== input.defaultTenantId) {
    return { hasGlobalAccess: true, sellerCode: null, tenantId: input.storeAdminTenantId, denied: false };
  }
  if (sessionTenant !== input.defaultTenantId) {
    return { hasGlobalAccess: true, sellerCode: null, tenantId: sessionTenant, denied: false };
  }
  const legacy = String(input.legacySellerCode || "").trim().toLowerCase();
  if (legacy) {
    return { hasGlobalAccess: false, sellerCode: legacy, tenantId: input.defaultTenantId, denied: false };
  }
  return { hasGlobalAccess: false, sellerCode: null, tenantId: input.defaultTenantId, denied: true };
}

function storeAdminOrDeny(storeAdminTenantId: string | null, sessionTenant: string, defaultTenantId: string): SellerAccess {
  if (storeAdminTenantId && storeAdminTenantId !== defaultTenantId) {
    return { hasGlobalAccess: true, sellerCode: null, tenantId: storeAdminTenantId, denied: false };
  }
  return { hasGlobalAccess: false, sellerCode: null, tenantId: sessionTenant || defaultTenantId, denied: true };
}

export function sellerRowBelongsToTenant(rowTenant: string | null | undefined, tenantId: string, defaultTenantId: string): boolean {
  const row = String(rowTenant || "").trim() || defaultTenantId;
  const target = String(tenantId || "").trim() || defaultTenantId;
  return row === target;
}
