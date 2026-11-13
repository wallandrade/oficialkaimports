/**
 * Tela de manutenção da vitrine (loja principal e filiais no mesmo front).
 *
 * Para desligar: defina a constante `MAINTENANCE_MODE_DEFAULT` como `false` aqui
 * E `MAINTENANCE_MODE = false` em `public/tenant-branding.js`, depois faça o redeploy.
 * O build também respeita `VITE_MAINTENANCE`: `"0"` desliga, `"1"` liga;
 * qualquer outro valor usa a constante daqui.
 */
export const MAINTENANCE_MODE_DEFAULT = false;

const viteMaintenanceFlag = import.meta.env.VITE_MAINTENANCE;

export const MAINTENANCE_MODE =
  viteMaintenanceFlag === "0"
    ? false
    : viteMaintenanceFlag === "1"
      ? true
      : MAINTENANCE_MODE_DEFAULT;

function pathnameOnly(path: string): string {
  const raw = String(path || "").split("?")[0]?.split("#")[0] || "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/** `/admin` e qualquer rota abaixo (`/admin/login`, etc.). */
export function isMaintenanceExemptPath(path: string): boolean {
  const normalized = pathnameOnly(path);
  return normalized === "/admin" || normalized.startsWith("/admin/");
}

export function shouldShowMaintenancePage(pathname?: string): boolean {
  if (!MAINTENANCE_MODE) return false;
  const path =
    pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "/");
  return !isMaintenanceExemptPath(path);
}
