export type AffiliateBuyerIdentity = {
  id: string;
  createdAt: Date | string | null;
  tenantId?: string | null;
  userId?: string | null;
  clientEmail?: string | null;
  clientDocument?: string | null;
};

export type SellerLinkOrder = AffiliateBuyerIdentity & {
  sellerCode?: string | null;
  sellerSource?: string | null;
};

export function normalizeCustomerEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizeCustomerDocument(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 || digits.length === 14) return digits;
  return "";
}

export function sameStoreTenant(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => {
    const tenantId = String(value || "").trim();
    return tenantId || "tenant_loja1";
  };
  return normalize(left) === normalize(right);
}

/** Qualquer pedido pago com vendedor: link ou rodízio. */
export function isSellerLinkOrder(sellerCode: unknown, _sellerSource?: unknown): boolean {
  return Boolean(String(sellerCode || "").trim());
}

export function sharesBuyerIdentity(left: AffiliateBuyerIdentity, right: AffiliateBuyerIdentity): boolean {
  const leftEmail = normalizeCustomerEmail(left.clientEmail);
  const rightEmail = normalizeCustomerEmail(right.clientEmail);
  if (leftEmail && leftEmail === rightEmail) return true;

  const leftUserId = String(left.userId || "").trim();
  const rightUserId = String(right.userId || "").trim();
  if (leftUserId && leftUserId === rightUserId) return true;

  const leftDocument = normalizeCustomerDocument(left.clientDocument);
  const rightDocument = normalizeCustomerDocument(right.clientDocument);
  return Boolean(leftDocument && leftDocument === rightDocument);
}

export function isEarlierOrder(prior: AffiliateBuyerIdentity, current: AffiliateBuyerIdentity): boolean {
  if (prior.id === current.id) return false;
  const priorMs = new Date(prior.createdAt || 0).getTime();
  const currentMs = new Date(current.createdAt || 0).getTime();
  if (!Number.isFinite(priorMs) || !Number.isFinite(currentMs)) return false;
  return priorMs < currentMs;
}

/** Vendedor do pedido pago anterior mais recente, quando veio do link. */
export function priorSellerLinkCode(current: AffiliateBuyerIdentity, candidates: SellerLinkOrder[]): string | null {
  let best: { code: string; at: number } | null = null;
  for (const candidate of candidates) {
    if (!sameStoreTenant(candidate.tenantId, current.tenantId)) continue;
    if (!isSellerLinkOrder(candidate.sellerCode, candidate.sellerSource)) continue;
    if (!sharesBuyerIdentity(current, candidate)) continue;
    if (!isEarlierOrder(candidate, current)) continue;
    const at = new Date(candidate.createdAt || 0).getTime();
    if (!best || at > best.at) {
      best = { code: String(candidate.sellerCode || "").trim(), at };
    }
  }
  return best?.code || null;
}
