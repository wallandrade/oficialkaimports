const APEX_HOST = "ka-imports.com";
const API_ORIGIN = "https://lobster-app-7f8c2.ondigitalocean.app";

/**
 * ka-imports.com responde 307 para www antes do rewrite da API.
 * O Safari devolve esse 307 no POST, sem a mensagem da rota.
 * www também fica de fora do connect-src. A API direta já está liberada.
 */
export function rewriteApexApiUrl(raw: string, hostname: string): string | null {
  if (hostname !== APEX_HOST) return null;
  if (raw === "/api" || raw.startsWith("/api/") || raw.startsWith("/api?")) {
    return `${API_ORIGIN}${raw}`;
  }
  const absolute = `https://${APEX_HOST}`;
  if (raw === `${absolute}/api` || raw.startsWith(`${absolute}/api/`) || raw.startsWith(`${absolute}/api?`)) {
    return `${API_ORIGIN}${raw.slice(absolute.length)}`;
  }
  return null;
}

export function installApexApiFetch(): void {
  if (typeof window === "undefined" || window.location.hostname !== APEX_HOST) return;
  const native = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const next = rewriteApexApiUrl(raw, window.location.hostname);
    if (!next) return native(input, init);
    if (typeof input === "string" || input instanceof URL) return native(next, init);
    return native(new Request(next, input), init);
  };
}
