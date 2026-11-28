export const SITE_PASSWORD_ACTIVE_LABEL = "Proteção ativa";
export const SITE_PASSWORD_RELEASED_LABEL =
  "Senha salva, mas a loja está liberada (liberação automática na data marcada)";
export const SITE_RELEASE_SCHEDULED_LABEL = "Liberação automática ligada";

export type SiteProtectionView = {
  site?: boolean;
  release?: unknown;
} | null;

/** Status do card da senha. Só afirma proteção quando GET /api/is-protected diz site:true. */
export function sitePasswordCardStatus(
  hasSavedPassword: boolean,
  protection: SiteProtectionView,
): "active" | "released" | null {
  if (protection?.site === true) return "active";
  if (hasSavedPassword && protection?.site === false) return "released";
  return null;
}

/** A contagem só está ligada quando a API devolve release. */
export function siteReleaseScheduleActive(protection: SiteProtectionView): boolean {
  return protection?.release != null;
}

export type SiteReleaseSaveStep = "enabled" | "at" | "message";

/**
 * Desligar grava o interruptor primeiro: a loja fecha mesmo se a data falhar.
 * Ligar grava a data e a mensagem antes. Um `1` com a data antiga no passado
 * abriria a loja até o PUT seguinte, e uma data que falha deixaria a loja aberta.
 */
export function siteReleaseSaveSteps(enabled: boolean): readonly SiteReleaseSaveStep[] {
  return enabled ? ["at", "message", "enabled"] : ["enabled", "at", "message"];
}
