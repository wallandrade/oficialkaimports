const RELATIVE_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

function buildRelativeSettingsUrl(): string {
  return `${RELATIVE_BASE}/api/settings`;
}

function buildAbsoluteSettingsUrl(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const params = new URLSearchParams();
  if (host) params.set("domain", host);
  const query = params.toString();
  return `${API_BASE}/api/settings${query ? `?${query}` : ""}`;
}

async function fetchJson(url: string): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) return null;
    const data = await res.json() as Record<string, string>;
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export async function fetchPublicSiteSettings(): Promise<Record<string, string>> {
  const relativeData = await fetchJson(buildRelativeSettingsUrl());
  if (relativeData) return relativeData;

  if (API_BASE) {
    const absoluteData = await fetchJson(buildAbsoluteSettingsUrl());
    if (absoluteData) return absoluteData;
  }

  return {};
}
