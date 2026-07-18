import { Router, type IRouter, type Request, type Response } from "express";
import { db, adminUserTenantsTable, adminUsersTable, tenantSettingsTable, tenantsTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import { getAdminScope, requirePrimaryAdmin } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";

const router: IRouter = Router();
const TENANT_DNS_TARGET_HOST_KEY = "tenant_dns_target_host";

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

async function getStoredTenantDnsTargetHost(tenantId: string): Promise<string> {
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedTenantId) return "";

  const row = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, normalizedTenantId), eq(tenantSettingsTable.key, TENANT_DNS_TARGET_HOST_KEY)))
    .limit(1);

  return normalizeDomain(String(row[0]?.value || ""));
}

async function findTenantIdByDomain(domain: string): Promise<string | null> {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;

  const row = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.domain, normalizedDomain))
    .limit(1);

  return row[0]?.id || null;
}

async function resolveDnsTargetHostForTenant(req: Request, tenantId?: string, domain?: string): Promise<string> {
  const normalizedTenantId = String(tenantId || "").trim();
  if (normalizedTenantId) {
    const stored = await getStoredTenantDnsTargetHost(normalizedTenantId);
    if (stored) return stored;
  }

  const normalizedDomain = normalizeDomain(domain || "");
  if (normalizedDomain) {
    const matchedTenantId = await findTenantIdByDomain(normalizedDomain);
    if (matchedTenantId) {
      const stored = await getStoredTenantDnsTargetHost(matchedTenantId);
      if (stored) return stored;
    }
  }

  return getDnsTargetHost(req);
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

    const domain = normalizeDomain(String(req.query.domain || ""));
    const tenantId = String(req.query.tenantId || "").trim();
    const targetHost = await resolveDnsTargetHostForTenant(req, tenantId, domain);
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
    const tenantId = String(req.query.tenantId || "").trim();
    if (!domain) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe um domínio para verificar." });
      return;
    }

    const targetHost = await resolveDnsTargetHostForTenant(req, tenantId, domain);
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

    const tenantIds = rows.map((row) => row.id);
    const targetRows = tenantIds.length > 0
      ? await db
          .select({ tenantId: tenantSettingsTable.tenantId, value: tenantSettingsTable.value })
          .from(tenantSettingsTable)
          .where(and(inArray(tenantSettingsTable.tenantId, tenantIds), eq(tenantSettingsTable.key, TENANT_DNS_TARGET_HOST_KEY)))
      : [];

    const targetByTenantId = new Map(targetRows.map((row) => [row.tenantId, normalizeDomain(String(row.value || ""))]));

    res.json({
      tenants: rows.map((row) => ({
        ...row,
        dnsTargetHost: targetByTenantId.get(row.id) || null,
      })),
    });
  } catch (err) {
    console.error("[Tenants] GET error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar lojas." });
  }
});

router.patch("/admin/tenants/:tenantId/dns-target", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const tenantId = String(req.params.tenantId || "").trim();
    const dnsTargetHost = normalizeDomain(String(req.body?.dnsTargetHost || ""));

    if (!tenantId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe a loja a ser atualizada." });
      return;
    }

    const existing = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Loja não encontrada." });
      return;
    }

    if (dnsTargetHost) {
      await db
        .insert(tenantSettingsTable)
        .values({
          tenantId,
          key: TENANT_DNS_TARGET_HOST_KEY,
          value: dnsTargetHost,
          updatedAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: {
            value: dnsTargetHost,
            updatedAt: new Date(),
          },
        });
    } else {
      await db
        .delete(tenantSettingsTable)
        .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, TENANT_DNS_TARGET_HOST_KEY)));
    }

    res.json({ ok: true, tenantId, dnsTargetHost: dnsTargetHost || null });
  } catch (err) {
    console.error("[Tenants] PATCH dns-target error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar host alvo da loja." });
  }
});

router.delete("/admin/tenants/:tenantId", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const tenantId = String(req.params.tenantId || "").trim();
    if (!tenantId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe a loja a ser excluída." });
      return;
    }

    if (tenantId === DEFAULT_TENANT_ID) {
      res.status(403).json({ error: "FORBIDDEN", message: "A Loja 1 não pode ser excluída." });
      return;
    }

    const existing = await db
      .select({ id: tenantsTable.id, name: tenantsTable.name })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Loja não encontrada." });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.delete(adminUserTenantsTable).where(eq(adminUserTenantsTable.tenantId, tenantId));
      await tx.delete(tenantSettingsTable).where(eq(tenantSettingsTable.tenantId, tenantId));
      await tx.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    });

    res.json({ ok: true, tenantId, name: existing[0].name });
  } catch (err) {
    console.error("[Tenants] DELETE error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao excluir loja." });
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
      dnsTargetHost,
    } = req.body as {
      name?: string;
      slug?: string;
      domain?: string;
      adminUsername?: string;
      createAdminUser?: boolean;
      newAdminUsername?: string;
      newAdminPassword?: string;
      cloneSettingsFromDefault?: boolean;
      dnsTargetHost?: string;
    };

    const cleanName = String(name || "").trim();
    const cleanSlug = normalizeSlug(String(slug || ""));
    const cleanDomain = normalizeDomain(String(domain || ""));
    const cleanDnsTargetHost = normalizeDomain(String(dnsTargetHost || ""));
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

      if (cleanDnsTargetHost) {
        await tx
          .insert(tenantSettingsTable)
          .values({
            tenantId,
            key: TENANT_DNS_TARGET_HOST_KEY,
            value: cleanDnsTargetHost,
            updatedAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              value: cleanDnsTargetHost,
              updatedAt: new Date(),
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
        dnsTargetHost: tenantSettingsTable.value,
        createdAt: tenantsTable.createdAt,
      })
      .from(tenantsTable)
      .leftJoin(
        tenantSettingsTable,
        and(eq(tenantSettingsTable.tenantId, tenantsTable.id), eq(tenantSettingsTable.key, TENANT_DNS_TARGET_HOST_KEY)),
      )
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
