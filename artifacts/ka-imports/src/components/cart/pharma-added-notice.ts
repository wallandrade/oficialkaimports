/** Faixa compacta no celular. O desktop fica um pouco mais tempo para dar tempo de ler. */
export const CART_ADDED_NOTICE_COMPACT_MS = 2800;
export const CART_ADDED_NOTICE_REGULAR_MS = 4000;

const COMPACT_MAX_WIDTH_PX = 768;

/**
 * O drawer já mostra o item. O aviso só fica na tela com o carrinho fechado,
 * para não cobrir Finalizar Pedido nem o botão de comprar.
 */
export function shouldShowCartAddedNotice(hasNotice: boolean, cartDrawerOpen: boolean): boolean {
  return hasNotice && !cartDrawerOpen;
}

export function cartAddedNoticeDismissMs(viewportWidth: number): number {
  return viewportWidth < COMPACT_MAX_WIDTH_PX
    ? CART_ADDED_NOTICE_COMPACT_MS
    : CART_ADDED_NOTICE_REGULAR_MS;
}

/** Abaixo do header e da safe-area do iOS, o que ficar mais baixo. */
export function cartAddedNoticeTopPx(headerBottomPx: number, safeAreaTopPx: number): number {
  const belowHeader = Math.max(0, headerBottomPx) + 8;
  const belowSafeArea = Math.max(0, safeAreaTopPx) + 12;
  return Math.round(Math.max(belowHeader, belowSafeArea));
}

export function readSafeAreaTopPx(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = "env(safe-area-inset-top, 0px)";
  document.body.appendChild(probe);
  const value = Number.parseFloat(window.getComputedStyle(probe).paddingTop);
  probe.remove();
  return Number.isFinite(value) ? value : 0;
}
