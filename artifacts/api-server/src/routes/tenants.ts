import { Router, type IRouter, type Request, type Response } from "express";
import { db, adminUserTenantsTable, adminUsersTable, tenantSettingsTable, tenantsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import { getAdminScope, requirePrimaryAdmin } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";

const router: IRouter = Router();

function normalizeSlug(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashPassword(password: string, salt: string): string {
  return crypto.createHash("sha256").update(password + salt).digest("hex");
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

function generateId(): string {
  return crypto.randomBytes(8).toString("hex");
}

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

function splitDomainParts(domain: string): string[] {
  return normalizeDomain(domain).split(".").filter(Boolean);
}

function buildZoneCandidates(domain: string): string[] {
  const parts = splitDomainParts(domain);
  const candidates: string[] = [];

  for (let start = 0; start <= parts.length - 2; start += 1) {
    candidates.push(parts.slice(start).join("."));
  }

  return candidates;
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value || "Erro desconhecido");
}

type CfZone = { id: string; name: string };
type CfDnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
};

async function cloudflareRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: Array<{ message?: string; code?: number }>;
    result?: T;
  };

  if (!response.ok || payload.success === false) {
    const errorMessage = payload.errors?.map((entry) => entry.message).filter(Boolean).join("; ")
      || `Cloudflare HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload.result as T;
}

async function resolveCloudflareZoneId(token: string, domain: string, fixedZoneId?: string): Promise<{ zoneId: string; zoneName: string }> {
  if (fixedZoneId) {
    const zone = await cloudflareRequest<CfZone>(token, `/zones/${fixedZoneId}`, { method: "GET" });
    return { zoneId: zone.id, zoneName: zone.name };
  }

  const candidates = buildZoneCandidates(domain);
  for (const candidate of candidates) {
    const zones = await cloudflareRequest<CfZone[]>(
      token,
      `/zones?name=${encodeURIComponent(candidate)}&page=1&per_page=1&status=active`,
      { method: "GET" },
    );

    if (zones[0]?.id) {
      return { zoneId: zones[0].id, zoneName: zones[0].name };
    }
  }

  throw new Error("Nenhuma zona Cloudflare compatível encontrada para o domínio informado.");
}

async function cloudflareUpsertCname(params: {
  token: string;
  zoneId: string;
  recordName: string;
  targetHost: string;
}): Promise<{ action: "created" | "updated" | "unchanged"; recordId: string; deletedConflicts: number }> {
  const { token, zoneId, recordName, targetHost } = params;

  const existing = await cloudflareRequest<CfDnsRecord[]>(
    token,
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(recordName)}&per_page=100`,
    { method: "GET" },
  );

  const cname = existing.find((record) => String(record.type).toUpperCase() === "CNAME");
  const conflicts = existing.filter((record) => ["A", "AAAA"].includes(String(record.type).toUpperCase()));

  for (const record of conflicts) {
    await cloudflareRequest<unknown>(token, `/zones/${zoneId}/dns_records/${record.id}`, { method: "DELETE" });
  }

  if (cname && normalizeDomain(cname.content) === normalizeDomain(targetHost) && conflicts.length === 0) {
    return { action: "unchanged", recordId: cname.id, deletedConflicts: 0 };
  }

  if (cname) {
    const updated = await cloudflareRequest<CfDnsRecord>(token, `/zones/${zoneId}/dns_records/${cname.id}`, {
      method: "PUT",
      body: JSON.stringify({
        type: "CNAME",
        name: recordName,
        content: targetHost,
        proxied: false,
        ttl: 1,
      }),
    });
    return { action: "updated", recordId: updated.id, deletedConflicts: conflicts.length };
  }

  const created = await cloudflareRequest<CfDnsRecord>(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "CNAME",
      name: recordName,
      content: targetHost,
      proxied: false,
      ttl: 1,
    }),
  });

  return { action: "created", recordId: created.id, deletedConflicts: conflicts.length };
}

type RailwayGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

async function railwayGraphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json().catch(() => ({}))) as RailwayGraphqlResponse<T>;
  if (!response.ok || (payload.errors && payload.errors.length > 0)) {
    const errorMessage = payload.errors?.map((entry) => entry.message).filter(Boolean).join("; ")
      || `Railway HTTP ${response.status}`;
    throw new Error(errorMessage);
  }
  if (!payload.data) {
    throw new Error("Railway não retornou dados.");
  }
  return payload.data;
}

async function railwayEnsureCustomDomain(params: {
  token: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  domain: string;
}): Promise<{ domainId: string | null; created: boolean; status: unknown | null }> {
  const { token, projectId, environmentId, serviceId, domain } = params;

  let created = false;
  let domainId: string | null = null;

  const createMutation = `
    mutation CreateCustomDomain($input: CustomDomainCreateInput!) {
      customDomainCreate(input: $input) {
        id
        domain
      }
    }
  `;

  try {
    const createdData = await railwayGraphql<{ customDomainCreate?: { id?: string; domain?: string } }>(
      token,
      createMutation,
      {
        input: {
          domain,
          projectId,
          environmentId,
          serviceId,
        },
      },
    );
    domainId = String(createdData.customDomainCreate?.id || "").trim() || null;
    created = !!domainId;
  } catch (err) {
    const message = toErrorMessage(err).toLowerCase();
    const alreadyExists = message.includes("already") || message.includes("exists") || message.includes("taken");
    if (!alreadyExists) throw err;
  }

  if (!domainId) {
    const domainsQuery = `
      query Domains($projectId: String!, $environmentId: String!, $serviceId: String!) {
        domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
          customDomains {
            id
            domain
          }
        }
      }
    `;

    const listData = await railwayGraphql<{
      domains?: {
        customDomains?: Array<{ id?: string; domain?: string }>;
      };
    }>(token, domainsQuery, { projectId, environmentId, serviceId });

    const match = (listData.domains?.customDomains || []).find(
      (entry) => normalizeDomain(String(entry.domain || "")) === normalizeDomain(domain),
    );
    domainId = String(match?.id || "").trim() || null;
  }

  if (!domainId) {
    return { domainId: null, created, status: null };
  }

  const statusQuery = `
    query DomainStatus($id: String!, $projectId: String!) {
      domainStatus(id: $id, projectId: $projectId) {
        certificateStatus
        certificateStatusDetailed
        customDomainStatus
      }
    }
  `;

  const statusData = await railwayGraphql<{ domainStatus?: unknown }>(token, statusQuery, { id: domainId, projectId });
  return {
    domainId,
    created,
    status: statusData.domainStatus || null,
  };
}

async function resolveAdminUserByUsername(username: string) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return null;

  let user = (
    await db
      .select({ id: adminUsersTable.id, username: adminUsersTable.username })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.username, normalized))
      .limit(1)
  )[0];

  if (!user) {
    const allUsers = await db.select({ id: adminUsersTable.id, username: adminUsersTable.username }).from(adminUsersTable);
    user = allUsers.find((row) => String(row.username || "").trim().toLowerCase() === normalized) || null;
  }

  return user;
}

function ensureDefaultTenantScope(req: Request, res: Response): string | null {
  const scope = getAdminScope(req);
  const tenantId = String(scope?.tenantId || "").trim() || DEFAULT_TENANT_ID;
  if (tenantId !== DEFAULT_TENANT_ID) {
    res.status(403).json({ error: "FORBIDDEN", message: "Gerenciamento de lojas disponível apenas no admin da Loja 1." });
    return null;
  }
  return tenantId;
}

function getCurrentRequestHost(req: Request): string {
  const fromForwarded = String(req.get("x-forwarded-host") || "").trim().toLowerCase();
  if (fromForwarded) return fromForwarded.split(",")[0]?.trim() || "";
  return String(req.get("host") || "").trim().toLowerCase();
}

function getDnsTargetHost(req: Request): string {
  const explicit = normalizeDomain(String(process.env.TENANT_DNS_TARGET_HOST || process.env.APP_PRIMARY_DOMAIN || ""));
  if (explicit) return explicit;

  const replitPrimary = String(process.env.REPLIT_DOMAINS || "").split(",")[0]?.trim();
  const fromReplit = normalizeDomain(replitPrimary || "");
  if (fromReplit) return fromReplit;

  return normalizeDomain(getCurrentRequestHost(req));
}

function getDnsInstructions(domain: string, targetHost: string): {
  host: string;
  type: "CNAME" | "ALIAS/A";
  name: string;
  value: string;
  note: string;
} {
  const normalizedDomain = normalizeDomain(domain);
  const parts = normalizedDomain.split(".");
  const isSubdomain = parts.length > 2;

  if (isSubdomain) {
    const root = parts.slice(-2).join(".");
    const name = normalizedDomain.slice(0, Math.max(0, normalizedDomain.length - root.length - 1));
    return {
      host: normalizedDomain,
      type: "CNAME",
      name,
      value: targetHost,
      note: "Crie este CNAME no seu provedor DNS. Exemplo: Cloudflare/Registro.br.",
    };
  }

  return {
    host: normalizedDomain,
    type: "ALIAS/A",
    name: "@",
    value: targetHost,
    note: "Para domínio raiz, use ALIAS/ANAME para o host alvo, ou A record conforme instrução da hospedagem.",
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean).map((v) => v.trim().toLowerCase())));
}

async function safeResolveCname(host: string): Promise<string[]> {
  try {
    return unique(await dns.resolveCname(host));
  } catch {
    return [];
  }
}

async function safeResolveA(host: string): Promise<string[]> {
  try {
    return unique(await dns.resolve4(host));
  } catch {
    return [];
  }
}

async function safeResolveNs(host: string): Promise<string[]> {
  try {
    return unique(await dns.resolveNs(host));
  } catch {
    return [];
  }
}

router.get("/admin/tenants/dns-guide", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const targetHost = getDnsTargetHost(req);
    const domain = normalizeDomain(String(req.query.domain || ""));
    const instructions = domain && targetHost ? getDnsInstructions(domain, targetHost) : null;

    res.json({
      targetHost,
      envTargetHost: normalizeDomain(String(process.env.TENANT_DNS_TARGET_HOST || process.env.APP_PRIMARY_DOMAIN || "")) || null,
      instructions,
    });
  } catch (err) {
    console.error("[Tenants] DNS guide error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao gerar instruções de DNS." });
  }
});

router.get("/admin/tenants/dns-check", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const domain = normalizeDomain(String(req.query.domain || ""));
    if (!domain) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe um domínio para verificar." });
      return;
    }

    const targetHost = getDnsTargetHost(req);
    const [domainCname, domainA, targetA, nameservers] = await Promise.all([
      safeResolveCname(domain),
      safeResolveA(domain),
      targetHost ? safeResolveA(targetHost) : Promise.resolve([]),
      safeResolveNs(domain),
    ]);

    const cnameMatch = targetHost ? domainCname.some((entry) => normalizeDomain(entry) === targetHost) : false;
    const targetASet = new Set(targetA);
    const aMatch = domainA.some((ip) => targetASet.has(ip));

    const status = cnameMatch || aMatch
      ? "configured"
      : domainCname.length > 0 || domainA.length > 0
        ? "misconfigured"
        : "not_found";

    res.json({
      domain,
      targetHost,
      status,
      cnameMatch,
      aMatch,
      dns: {
        cname: domainCname,
        a: domainA,
        targetA,
        nameservers,
      },
      message:
        status === "configured"
          ? "Domínio apontado corretamente."
          : status === "misconfigured"
            ? "Domínio encontrado, mas ainda não aponta para este servidor."
            : "Nenhum registro DNS encontrado para este domínio.",
    });
  } catch (err) {
    console.error("[Tenants] DNS check error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao verificar DNS." });
  }
});

router.post("/admin/tenants/dns-provision", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const domain = normalizeDomain(String(req.body?.domain || ""));
    if (!domain) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe um domínio válido." });
      return;
    }

    const targetHost = getDnsTargetHost(req);
    if (!targetHost) {
      res.status(400).json({ error: "MISSING_TARGET_HOST", message: "Não foi possível determinar o host alvo da aplicação." });
      return;
    }

    const cloudflareToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
    if (!cloudflareToken) {
      res.status(400).json({
        error: "CLOUDFLARE_NOT_CONFIGURED",
        message: "Configure CLOUDFLARE_API_TOKEN no backend para automação DNS.",
      });
      return;
    }

    const fixedZoneId = String(process.env.CLOUDFLARE_ZONE_ID || "").trim() || undefined;
    const railwayToken = String(process.env.RAILWAY_API_TOKEN || "").trim();
    const railwayProjectId = String(process.env.RAILWAY_PROJECT_ID || "").trim();
    const railwayEnvironmentId = String(process.env.RAILWAY_ENVIRONMENT_ID || "").trim();
    const railwayServiceId = String(process.env.RAILWAY_SERVICE_ID || "").trim();

    const dnsResult: {
      ok: boolean;
      message?: string;
      zoneId?: string;
      zoneName?: string;
      recordName?: string;
      targetHost?: string;
      action?: "created" | "updated" | "unchanged";
      deletedConflicts?: number;
      recordId?: string;
    } = { ok: false };

    const railwayResult: {
      attempted: boolean;
      ok: boolean;
      skipped?: boolean;
      message?: string;
      domainId?: string | null;
      created?: boolean;
      status?: unknown;
    } = {
      attempted: false,
      ok: false,
    };

    try {
      const { zoneId, zoneName } = await resolveCloudflareZoneId(cloudflareToken, domain, fixedZoneId);
      const dnsUpsert = await cloudflareUpsertCname({
        token: cloudflareToken,
        zoneId,
        recordName: domain,
        targetHost,
      });

      dnsResult.ok = true;
      dnsResult.zoneId = zoneId;
      dnsResult.zoneName = zoneName;
      dnsResult.recordName = domain;
      dnsResult.targetHost = targetHost;
      dnsResult.action = dnsUpsert.action;
      dnsResult.deletedConflicts = dnsUpsert.deletedConflicts;
      dnsResult.recordId = dnsUpsert.recordId;
    } catch (err) {
      dnsResult.ok = false;
      dnsResult.message = toErrorMessage(err);
      res.status(502).json({
        error: "DNS_PROVISION_FAILED",
        message: "Falha ao configurar DNS automaticamente.",
        details: {
          domain,
          targetHost,
          dns: dnsResult,
        },
      });
      return;
    }

    const railwayReady = railwayToken && railwayProjectId && railwayEnvironmentId && railwayServiceId;
    if (!railwayReady) {
      railwayResult.attempted = false;
      railwayResult.ok = false;
      railwayResult.skipped = true;
      railwayResult.message = "Integração Railway não configurada. Defina RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID e RAILWAY_SERVICE_ID.";
    } else {
      railwayResult.attempted = true;
      try {
        const ensured = await railwayEnsureCustomDomain({
          token: railwayToken,
          projectId: railwayProjectId,
          environmentId: railwayEnvironmentId,
          serviceId: railwayServiceId,
          domain,
        });
        railwayResult.ok = true;
        railwayResult.domainId = ensured.domainId;
        railwayResult.created = ensured.created;
        railwayResult.status = ensured.status;
      } catch (err) {
        railwayResult.ok = false;
        railwayResult.message = toErrorMessage(err);
      }
    }

    const overallOk = dnsResult.ok && (railwayResult.ok || railwayResult.skipped === true);

    res.status(overallOk ? 200 : 207).json({
      ok: overallOk,
      domain,
      targetHost,
      dns: dnsResult,
      railway: railwayResult,
      message: overallOk
        ? "Provisionamento automático concluído."
        : "DNS configurado, mas o vínculo na Railway precisa de ajuste.",
    });
  } catch (err) {
    console.error("[Tenants] DNS provision error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao provisionar domínio automaticamente." });
  }
});

router.get("/admin/tenants", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const rows = await db
      .select({
        id: tenantsTable.id,
        slug: tenantsTable.slug,
        name: tenantsTable.name,
        status: tenantsTable.status,
        domain: tenantsTable.domain,
        createdAt: tenantsTable.createdAt,
      })
      .from(tenantsTable)
      .orderBy(asc(tenantsTable.createdAt));

    res.json({ tenants: rows });
  } catch (err) {
    console.error("[Tenants] GET error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar lojas." });
  }
});

router.post("/admin/tenants", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;
    const scope = getAdminScope(req);

    const {
      name,
      slug,
      domain,
      adminUsername,
      createAdminUser,
      newAdminUsername,
      newAdminPassword,
      cloneSettingsFromDefault,
    } = req.body as {
      name?: string;
      slug?: string;
      domain?: string;
      adminUsername?: string;
      createAdminUser?: boolean;
      newAdminUsername?: string;
      newAdminPassword?: string;
      cloneSettingsFromDefault?: boolean;
    };

    const cleanName = String(name || "").trim();
    const cleanSlug = normalizeSlug(String(slug || ""));
    const cleanDomain = normalizeDomain(String(domain || ""));
    const cleanAdminUsername = String(adminUsername || "").trim().toLowerCase();
    const shouldCreateAdminUser = createAdminUser === true;
    const cleanNewAdminUsername = String(newAdminUsername || "").trim().toLowerCase();
    const cleanNewAdminPassword = String(newAdminPassword || "");

    if (!cleanName) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Nome da loja é obrigatório." });
      return;
    }
    if (!cleanSlug) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Slug da loja é obrigatório." });
      return;
    }

    const tenantId = `tenant_${cleanSlug}`;
    let adminUserId: string | null = null;

    if (shouldCreateAdminUser) {
      if (!cleanNewAdminUsername) {
        res.status(400).json({ error: "INVALID_INPUT", message: "Informe o usuário do novo admin da loja." });
        return;
      }
      if (cleanNewAdminPassword.length < 6) {
        res.status(400).json({ error: "INVALID_INPUT", message: "A senha do novo admin deve ter no mínimo 6 caracteres." });
        return;
      }

      const existingAdminByUsername = await resolveAdminUserByUsername(cleanNewAdminUsername);
      if (existingAdminByUsername) {
        res.status(409).json({ error: "ADMIN_USERNAME_EXISTS", message: "Já existe um admin com esse usuário." });
        return;
      }
    } else if (cleanAdminUsername) {
      const adminUser = await resolveAdminUserByUsername(cleanAdminUsername);
      if (!adminUser) {
        res.status(400).json({ error: "ADMIN_NOT_FOUND", message: "Admin informado não foi encontrado." });
        return;
      }
      adminUserId = adminUser.id;
    }

    const existingById = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
    if (existingById[0]) {
      res.status(409).json({ error: "TENANT_EXISTS", message: "Já existe uma loja com esse identificador." });
      return;
    }

    const existingBySlug = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.slug, cleanSlug)).limit(1);
    if (existingBySlug[0]) {
      res.status(409).json({ error: "SLUG_EXISTS", message: "Slug já está em uso." });
      return;
    }

    if (cleanDomain) {
      const existingByDomain = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.domain, cleanDomain)).limit(1);
      if (existingByDomain[0]) {
        res.status(409).json({ error: "DOMAIN_EXISTS", message: "Domínio já está vinculado a outra loja." });
        return;
      }
    }

    await db.transaction(async (tx) => {
      await tx.insert(tenantsTable).values({
        id: tenantId,
        slug: cleanSlug,
        name: cleanName,
        status: "active",
        domain: cleanDomain || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      if (shouldCreateAdminUser) {
        const salt = generateSalt();
        const createdAdminId = generateId();

        await tx.insert(adminUsersTable).values({
          id: createdAdminId,
          username: cleanNewAdminUsername,
          passwordHash: hashPassword(cleanNewAdminPassword, salt),
          salt,
          isPrimary: false,
          createdBy: scope?.username || null,
          createdAt: new Date(),
        });

        adminUserId = createdAdminId;
      }

      if (adminUserId) {
        await tx
          .insert(adminUserTenantsTable)
          .values({
            adminUserId,
            tenantId,
            role: "owner",
            createdAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              role: "owner",
            },
          });
      }

      if (cloneSettingsFromDefault !== false) {
        try {
          const sourceSettings = await tx
            .select({ key: tenantSettingsTable.key, value: tenantSettingsTable.value })
            .from(tenantSettingsTable)
            .where(eq(tenantSettingsTable.tenantId, DEFAULT_TENANT_ID));

          if (sourceSettings.length > 0) {
            await tx
              .insert(tenantSettingsTable)
              .values(
                sourceSettings.map((row) => ({
                  tenantId,
                  key: row.key,
                  value: row.value,
                  updatedAt: new Date(),
                })),
              )
              .onDuplicateKeyUpdate({
                set: {
                  updatedAt: new Date(),
                },
              });
          }
        } catch (err) {
          console.warn("[Tenants] clone settings skipped:", err);
        }
      }
    });

    const [created] = await db
      .select({
        id: tenantsTable.id,
        slug: tenantsTable.slug,
        name: tenantsTable.name,
        status: tenantsTable.status,
        domain: tenantsTable.domain,
        createdAt: tenantsTable.createdAt,
      })
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, tenantId), eq(tenantsTable.slug, cleanSlug)))
      .limit(1);

    res.status(201).json({
      ok: true,
      tenant: created || null,
      createdAdmin: shouldCreateAdminUser
        ? {
            username: cleanNewAdminUsername,
            isPrimary: false,
          }
        : null,
    });
  } catch (err) {
    console.error("[Tenants] POST error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar loja." });
  }
});

export default router;
