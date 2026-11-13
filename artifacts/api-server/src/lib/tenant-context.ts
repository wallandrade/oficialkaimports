import type { Request, Response } from "express";
import { db, tenantsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

export const DEFAULT_TENANT_ID = "tenant_loja1";
export const STORE_NOT_CONFIGURED = "store_not_configured";

const DEFAULT_MAIN_STORE_DOMAINS = "ka-imports.com,www.ka-imports.com";

export type TenantDomainRow = { id: string; domain: string | null };
export type TenantDomainLookup = (domains: string[]) => Promise<TenantDomainRow[]>;

function normalizeDomain(value: string): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "::1" || raw === "[::1]") return "::1";

  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return parsed.hostname.trim().toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0]?.split(":")[0]?.trim().toLowerCase() || "";
  }
}

function splitProxyHeaderValues(value: string): string[] {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function withDomainVariants(domain: string): string[] {
  const normalized = normalizeDomain(domain);
  if (!normalized) return [];

  if (normalized.startsWith("www.")) {
    const withoutWww = normalized.slice(4);
    return Array.from(new Set([normalized, withoutWww]));
  }

  return Array.from(new Set([normalized, `www.${normalized}`]));
}

function uniqueDomains(values: string[]): string[] {
  const domains = values
    .map((value) => normalizeDomain(value))
    .filter(Boolean);
  return Array.from(new Set(domains));
}

/**
 * Hosts that identify the storefront. Referer and x-forwarded-server stay out:
 * a search referer or an internal proxy name must not hide the main store,
 * and a payment callback usually has no browser Origin.
 * Origin stays in, so a branch page calling the API directly is not the main store.
 */
function collectIdentityHosts(req: Request): string[] {
  const xForwardedHostValues = splitProxyHeaderValues(String(req.get("x-forwarded-host") || ""));
  const forwardedValues = splitProxyHeaderValues(String(req.get("forwarded") || ""))
    .map((value) => {
      const match = value.match(/host=([^;]+)/i);
      return match?.[1] || "";
    })
    .filter(Boolean);

  return uniqueDomains([
    ...xForwardedHostValues,
    ...forwardedValues,
    String(req.get("x-original-host") || "").trim(),
    String(req.get("host") || "").trim(),
    String(req.get("origin") || "").trim(),
  ]);
}

function getRequestDomains(req: Request): string[] {
  const xForwardedHostValues = splitProxyHeaderValues(String(req.get("x-forwarded-host") || ""));
  const forwardedValues = splitProxyHeaderValues(String(req.get("forwarded") || ""))
    .map((value) => {
      const match = value.match(/host=([^;]+)/i);
      return match?.[1] || "";
    })
    .filter(Boolean);

  const candidates = [
    ...xForwardedHostValues,
    ...forwardedValues,
    String(req.get("x-original-host") || "").trim(),
    String(req.get("x-forwarded-server") || "").trim(),
    String(req.get("x-forwarded-origin") || "").trim(),
    String(req.get("host") || "").trim(),
    String(req.get("origin") || "").trim(),
    String(req.get("referer") || "").trim(),
  ];

  const domains = candidates
    .flatMap((candidate) => withDomainVariants(candidate))
    .filter(Boolean);

  return Array.from(new Set(domains));
}

export function getMainStoreDomains(): string[] {
  const raw = process.env.MAIN_STORE_DOMAINS;
  const source = raw == null || !String(raw).trim() ? DEFAULT_MAIN_STORE_DOMAINS : String(raw);
  return uniqueDomains(source.split(","));
}

export function isDefaultTenantFallbackHost(hostname: string): boolean {
  const host = normalizeDomain(hostname);
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host === "vercel.app" || host.endsWith(".vercel.app")) return true;
  if (host === "ondigitalocean.app" || host.endsWith(".ondigitalocean.app")) return true;

  const configured = new Set(getMainStoreDomains().flatMap((domain) => withDomainVariants(domain)));
  return configured.has(host);
}

export function requestAllowsDefaultTenant(identityHosts: string[]): boolean {
  if (identityHosts.length === 0) return true;
  return identityHosts.every((host) => isDefaultTenantFallbackHost(host));
}

function matchTenantId(domains: string[], rows: TenantDomainRow[]): string | null {
  const byDomain = new Map(rows.map((row) => [normalizeDomain(row.domain || ""), row.id]));
  for (const domain of domains) {
    const match = byDomain.get(domain);
    if (match) return match;
  }
  return null;
}

async function lookupTenantsByDomains(domains: string[]): Promise<TenantDomainRow[]> {
  return db
    .select({ id: tenantsTable.id, domain: tenantsTable.domain })
    .from(tenantsTable)
    .where(inArray(tenantsTable.domain, domains));
}

export async function resolveExplicitDomainTenant(
  domainRaw: string,
  lookup: TenantDomainLookup = lookupTenantsByDomains,
): Promise<string | null> {
  const domain = normalizeDomain(domainRaw);
  if (!domain) return null;

  const candidates = withDomainVariants(domain);
  const matched = matchTenantId(candidates, await lookup(candidates));
  if (matched) return matched;
  if (isDefaultTenantFallbackHost(domain)) return DEFAULT_TENANT_ID;
  return null;
}

export async function resolvePublicTenantId(
  req: Request,
  lookup: TenantDomainLookup = lookupTenantsByDomains,
): Promise<string | null> {
  const domains = getRequestDomains(req);
  if (domains.length > 0) {
    const matched = matchTenantId(domains, await lookup(domains));
    if (matched) return matched;
  }

  if (requestAllowsDefaultTenant(collectIdentityHosts(req))) return DEFAULT_TENANT_ID;
  return null;
}

export function respondStoreNotConfigured(res: Response): void {
  res.set("Cache-Control", "no-store");
  res.status(404).json({ error: STORE_NOT_CONFIGURED });
}

export async function requirePublicTenantId(req: Request, res: Response): Promise<string | null> {
  const tenantId = await resolvePublicTenantId(req);
  if (!tenantId) {
    respondStoreNotConfigured(res);
    return null;
  }
  return tenantId;
}
