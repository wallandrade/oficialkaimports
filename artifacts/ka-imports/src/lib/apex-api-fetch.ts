const APEX_HOST = "ka-imports.com";
const WWW_ORIGIN = "https://www.ka-imports.com";

/** ka-imports.com responde 307 para www. O Safari recusa o POST nesse redirect. */
export function rewriteApexApiUrl(raw: string, hostname: string): string | null {
  if (hostname !== APEX_HOST) return null;
  if (raw === "/api" || raw.startsWith("/api/") || raw.startsWith("/api?")) {
    return `${WWW_ORIGIN}${raw}`;
  }
  const absolute = `https://${APEX_HOST}`;
  if (raw === `${absolute}/api` || raw.startsWith(`${absolute}/api/`) || raw.startsWith(`${absolute}/api?`)) {
    return `${WWW_ORIGIN}${raw.slice(absolute.length)}`;
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
