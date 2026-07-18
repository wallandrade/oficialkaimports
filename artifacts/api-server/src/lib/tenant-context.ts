import type { Request } from "express";
import { db, tenantsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

export const DEFAULT_TENANT_ID = "tenant_loja1";

function normalizeDomain(value: string): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";

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

export async function resolvePublicTenantId(req: Request): Promise<string> {
  const domains = getRequestDomains(req);
  if (domains.length > 0) {
    const rows = await db
      .select({ id: tenantsTable.id, domain: tenantsTable.domain })
      .from(tenantsTable)
      .where(inArray(tenantsTable.domain, domains));

    const byDomain = new Map(rows.map((row) => [normalizeDomain(row.domain || ""), row.id]));
    for (const domain of domains) {
      const match = byDomain.get(domain);
      if (match) return match;
    }
  }

  return DEFAULT_TENANT_ID;
}