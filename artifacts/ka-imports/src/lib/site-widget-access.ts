/**
 * Widgets globais da vitrine (prova social, promoção relâmpago) só montam
 * com o site aberto. Enquanto a senha bloqueia, ou enquanto
 * GET /api/is-protected ainda não respondeu, eles ficam desmontados.
 * O sorteio da relâmpago grava a visita única no POST /api/flash-offers/draw;
 * sem montar o host, essa visita não é gasta na tela de senha.
 */

const PAYMENT_PATHS = ["/checkout", "/pix/", "/pix", "/success", "/pagamento", "/payment-link"];

export function isPaymentPath(location: string): boolean {
  return PAYMENT_PATHS.some((p) => location === p || location.startsWith(`${p}/`) || location.startsWith(`${p}?`));
}

export function isDeliveryCorrectionPath(location: string): boolean {
  const path = location.split("?")[0] || "";
  return path === "/corrigir-entrega" || path.startsWith("/corrigir-entrega/");
}

/** Rotas que o SitePasswordGate já deixava passar sem esperar a senha do site. */
export function isSitePasswordExemptPath(location: string): boolean {
  return location.startsWith("/admin")
    || location.startsWith("/kyc")
    || isPaymentPath(location)
    || isDeliveryCorrectionPath(location);
}

export function shouldMountStorefrontWidgets(input: {
  location: string;
  sessionUnlocked: boolean;
  /** null enquanto GET /api/is-protected não voltou. true = site bloqueado. */
  siteProtected: boolean | null;
}): boolean {
  if (isSitePasswordExemptPath(input.location) || input.sessionUnlocked) return true;
  if (input.siteProtected === null) return false;
  return input.siteProtected === false;
}
