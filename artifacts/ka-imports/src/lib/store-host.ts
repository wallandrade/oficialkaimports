const DEFAULT_MAIN_STORE_DOMAINS = ["ka-imports.com", "www.ka-imports.com"];

function normalizeHost(value: string): string {
  const raw = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return "";
  if (raw === "::1" || raw === "[::1]") return "::1";
  const withoutProtocol = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  return withoutProtocol.split("/")[0]?.split(":")[0]?.trim() || "";
}

/** Mesma regra do backend: loja principal, localhost, preview Vercel e app da API. */
export function isMainStoreHostname(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host === "vercel.app" || host.endsWith(".vercel.app")) return true;
  if (host === "ondigitalocean.app" || host.endsWith(".ondigitalocean.app")) return true;

  const configured = new Set<string>();
  for (const domain of DEFAULT_MAIN_STORE_DOMAINS) {
    const normalized = normalizeHost(domain);
    if (!normalized) continue;
    configured.add(normalized);
    if (normalized.startsWith("www.")) configured.add(normalized.slice(4));
    else configured.add(`www.${normalized}`);
  }
  return configured.has(host);
}

export function currentHostname(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname || "";
}

export function fallbackSiteName(hostname = currentHostname(), style: "title" | "upper" = "title"): string {
  if (!isMainStoreHostname(hostname)) return "Loja";
  return style === "upper" ? "KA IMPORTS" : "KA Imports";
}

export function isStoreNotConfiguredPayload(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return record.store_not_configured === true || record.error === "store_not_configured";
}
