import { isStoreNotConfiguredPayload } from "@/lib/store-host";

const RELATIVE_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export type StorefrontSettings =
  | { state: "ready"; settings: Record<string, string> }
  | { state: "unconfigured" }
  | { state: "unavailable" };

function buildRelativeSettingsUrl(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const params = new URLSearchParams();
  if (host) params.set("domain", host);
  const query = params.toString();
  return `${RELATIVE_BASE}/api/settings${query ? `?${query}` : ""}`;
}

function buildAbsoluteSettingsUrl(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const params = new URLSearchParams();
  if (host) params.set("domain", host);
  const query = params.toString();
  return `${API_BASE}/api/settings${query ? `?${query}` : ""}`;
}

async function fetchJson(url: string): Promise<Record<string, string> | "unconfigured" | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) return null;
    const data = await res.json() as unknown;
    if (isStoreNotConfiguredPayload(data)) return "unconfigured";
    if (!res.ok || !data || typeof data !== "object") return null;
    return data as Record<string, string>;
  } catch {
    return null;
  }
}

export async function loadStorefrontSettings(): Promise<StorefrontSettings> {
  const relativeData = await fetchJson(buildRelativeSettingsUrl());
  if (relativeData === "unconfigured") return { state: "unconfigured" };
  if (relativeData) return { state: "ready", settings: relativeData };

  if (API_BASE) {
    const absoluteData = await fetchJson(buildAbsoluteSettingsUrl());
    if (absoluteData === "unconfigured") return { state: "unconfigured" };
    if (absoluteData) return { state: "ready", settings: absoluteData };
  }

  return { state: "unavailable" };
}

export async function fetchPublicSiteSettings(): Promise<Record<string, string> | null> {
  const result = await loadStorefrontSettings();
  return result.state === "ready" ? result.settings : null;
}
