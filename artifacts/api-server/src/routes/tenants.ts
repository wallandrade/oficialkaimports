import { Router, type IRouter, type Request, type Response } from "express";
import { db, adminUserTenantsTable, adminUsersTable, tenantSettingsTable, tenantsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
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

    const {
      name,
      slug,
      domain,
      adminUsername,
      cloneSettingsFromDefault,
    } = req.body as {
      name?: string;
      slug?: string;
      domain?: string;
      adminUsername?: string;
      cloneSettingsFromDefault?: boolean;
    };

    const cleanName = String(name || "").trim();
    const cleanSlug = normalizeSlug(String(slug || ""));
    const cleanDomain = normalizeDomain(String(domain || ""));
    const cleanAdminUsername = String(adminUsername || "").trim().toLowerCase();

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

    if (cleanAdminUsername) {
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

    await db.insert(tenantsTable).values({
      id: tenantId,
      slug: cleanSlug,
      name: cleanName,
      status: "active",
      domain: cleanDomain || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (adminUserId) {
      await db
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
        const sourceSettings = await db
          .select({ key: tenantSettingsTable.key, value: tenantSettingsTable.value })
          .from(tenantSettingsTable)
          .where(eq(tenantSettingsTable.tenantId, DEFAULT_TENANT_ID));

        if (sourceSettings.length > 0) {
          await db
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

    res.status(201).json({ ok: true, tenant: created || null });
  } catch (err) {
    console.error("[Tenants] POST error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar loja." });
  }
});

export default router;
