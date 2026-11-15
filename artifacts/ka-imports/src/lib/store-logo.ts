import { isMainStoreFromSettings } from "./store-theme-preset";

/** Wordmark horizontal da loja principal. Fundo transparente, texto escuro. */
export const MAIN_STORE_WORDMARK = "/brand/ka/header.svg";
/** O mesmo wordmark com o texto em branco, para header escuro. */
export const MAIN_STORE_WORDMARK_ON_DARK = "/brand/ka/header-on-dark.svg";
/** PNG 1200×630 para og:image quando a loja principal não tem logo no admin. */
export const MAIN_STORE_SHARE_IMAGE = "/brand/ka/og.png";
/** Ícone da notificação do admin da loja principal. Filial continua em `/favicon.svg`. */
export const MAIN_STORE_NOTIFICATION_ICON = "/brand/ka/icon-192.png";
export const BRANCH_FAVICON = "/favicon.svg";

export type StoreLogoSettings = Record<string, string | undefined> | null | undefined;

export type ResolvedStoreLogo = {
  src: string | null;
  /** True só quando a imagem é o wordmark padrão, não um arquivo do admin. */
  isDefault: boolean;
};

export function configuredStoreLogo(settings: StoreLogoSettings): string {
  return String(settings?.logo ?? "").trim();
}

/**
 * Logo do header.
 * Arquivo salvo em Configurações (`logo`) vence em qualquer loja.
 * Sem arquivo, só a loja principal recebe o wordmark novo.
 */
export function resolveStoreLogo(
  settings: StoreLogoSettings,
  options?: { onDark?: boolean; hostname?: string },
): ResolvedStoreLogo {
  const configured = configuredStoreLogo(settings);
  if (configured) return { src: configured, isDefault: false };
  if (!isMainStoreFromSettings(settings, options?.hostname)) {
    return { src: null, isDefault: false };
  }
  return {
    src: options?.onDark ? MAIN_STORE_WORDMARK_ON_DARK : MAIN_STORE_WORDMARK,
    isDefault: true,
  };
}

/** Caminho da imagem de compartilhamento padrão. Null se houver logo no admin ou se não for a loja principal. */
export function mainStoreShareImage(
  settings: StoreLogoSettings,
  hostname?: string,
): string | null {
  if (configuredStoreLogo(settings)) return null;
  if (!isMainStoreFromSettings(settings, hostname)) return null;
  return MAIN_STORE_SHARE_IMAGE;
}

export function storeNotificationIcon(
  settings: StoreLogoSettings,
  hostname?: string,
): string {
  if (!isMainStoreFromSettings(settings, hostname)) return BRANCH_FAVICON;
  return MAIN_STORE_NOTIFICATION_ICON;
}
