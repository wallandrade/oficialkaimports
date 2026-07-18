import type { Request } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

function getRequestDomains(req: Request): string[] {
  const candidates = [
    String(req.get("x-forwarded-host") || "").trim(),
    String(req.get("host") || "").trim(),
    String(req.get("origin") || "").trim(),
    String(req.get("referer") || "").trim(),
  ]
    .map(normalizeDomain)
    .filter(Boolean);

  return Array.from(new Set(candidates));
}

export async function resolvePublicTenantId(req: Request): Promise<string> {
  const domains = getRequestDomains(req);
  for (const domain of domains) {
    const rows = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.domain, domain))
      .limit(1);

    if (rows[0]?.id) return rows[0].id;
  }

  return DEFAULT_TENANT_ID;
}