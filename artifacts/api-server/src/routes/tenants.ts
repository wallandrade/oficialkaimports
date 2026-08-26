import { Router, type IRouter, type Request, type Response } from "express";
import { db, adminUserTenantsTable, adminUsersTable, motoboyNeighborhoodsTable, ordersTable, tenantSettingsTable, tenantsTable } from "@workspace/db";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import { getAdminScope, requirePrimaryAdmin } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import {
  TENANT_SUPPLY_MARGIN_FIXED_BRL_KEY,
  TENANT_SUPPLY_MARGIN_PERCENT_KEY,
  TENANT_SYNC_PRODUCTS_FROM_LOJA1_KEY,
  isTenantSyncFromLoja1Enabled,
  removeAllLoja1ProductsFromTenant,
  syncAllLoja1ProductsToTenant,
} from "../lib/tenant-product-sync";
import { DEFAULT_MOTOBOY_NEIGHBORHOODS } from "../lib/default-motoboy-neighborhoods";

const router: IRouter = Router();
const TENANT_DNS_TARGET_HOST_KEY = "tenant_dns_target_host";
const TENANT_SITE_NAME_KEY = "site_name";
const TENANT_SUPPORT_WHATSAPP_KEY = "support_whatsapp";

type OrderProductSnapshot = {
  quantity?: unknown;
  qty?: unknown;
  costPrice?: unknown;
  costprice?: unknown;
  cost?: unknown;
};

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

function normalizeWhatsapp(value: string): string {
  return String(value || "").replace(/\D/g, "").trim();
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

async function resolveTenantAdminUser(tenantId: string) {
  const ownerRow = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      isPrimary: adminUsersTable.isPrimary,
    })
    .from(adminUserTenantsTable)
    .innerJoin(adminUsersTable, eq(adminUsersTable.id, adminUserTenantsTable.adminUserId))
    .where(and(eq(adminUserTenantsTable.tenantId, tenantId), eq(adminUserTenantsTable.role, "owner")))
    .limit(1);

  if (ownerRow[0]) return ownerRow[0];

  const anyRow = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      isPrimary: adminUsersTable.isPrimary,
    })
    .from(adminUserTenantsTable)
    .innerJoin(adminUsersTable, eq(adminUsersTable.id, adminUserTenantsTable.adminUserId))
    .where(eq(adminUserTenantsTable.tenantId, tenantId))
    .limit(1);

  return anyRow[0] || null;
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

function isRootDomain(domain: string): boolean {
  return normalizeDomain(domain).split(".").length <= 2;
}

function getWwwVariant(domain: string): string {
  const normalized = normalizeDomain(domain);
  if (!normalized) return "";
  return normalized.startsWith("www.") ? normalized : `www.${normalized}`;
}

function toUTC(dateStr: string, hour: string, minute: string, second: string): Date {
  const local = new Date(`${dateStr}T${hour}:${minute}:${second}-03:00`);
  return new Date(local.toISOString());
}

function parseOrderProducts(raw: unknown): OrderProductSnapshot[] {
  if (Array.isArray(raw)) return raw as OrderProductSnapshot[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OrderProductSnapshot[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseBool(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "on", "yes", "enabled"].includes(normalized);
}

function sumOrderCost(rawProducts: unknown): number {
  const products = parseOrderProducts(rawProducts);
  let total = 0;
  for (const item of products) {
    const qty = Number(item.quantity ?? item.qty ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const unitCost = Number(item.costPrice ?? item.costprice ?? item.cost ?? 0);
    if (!Number.isFinite(unitCost) || unitCost <= 0) continue;
    total += qty * unitCost;
  }
  return total;
}

function getIpv4Subnet24(ip: string): string {
  const parts = String(ip || "").trim().split(".");
  return parts.length === 4 ? parts.slice(0, 3).join(".") : "";
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
    const wwwDomain = isRootDomain(domain) ? getWwwVariant(domain) : "";
    const [domainCname, domainA, targetA, nameservers, wwwCname, wwwA] = await Promise.all([
      safeResolveCname(domain),
      safeResolveA(domain),
      targetHost ? safeResolveA(targetHost) : Promise.resolve([]),
      safeResolveNs(domain),
      wwwDomain ? safeResolveCname(wwwDomain) : Promise.resolve([]),
      wwwDomain ? safeResolveA(wwwDomain) : Promise.resolve([]),
    ]);

    const cnameMatch = targetHost ? domainCname.some((entry) => normalizeDomain(entry) === targetHost) : false;
    const targetASet = new Set(targetA);
    const aMatch = domainA.some((ip) => targetASet.has(ip));
    const wwwCnameMatch = Boolean(wwwDomain && targetHost && wwwCname.some((entry) => normalizeDomain(entry) === targetHost));
    const wwwAMatch = Boolean(wwwDomain && wwwA.some((ip) => targetASet.has(ip)));
    const wwwMatch = wwwCnameMatch || wwwAMatch;
    const rootAliasFlattenedMatch =
      !cnameMatch &&
      !aMatch &&
      isRootDomain(domain) &&
      domainA.length > 0 &&
      targetA.length > 0 &&
      targetHost.endsWith(".railway.app") &&
      domainA.some((ip) => {
        const subnet = getIpv4Subnet24(ip);
        return subnet && targetA.some((targetIp) => getIpv4Subnet24(targetIp) === subnet);
      });

    const status = cnameMatch || aMatch || rootAliasFlattenedMatch || wwwMatch
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
      wwwMatch,
      wwwCnameMatch,
      wwwAMatch,
      rootAliasFlattenedMatch,
      dns: {
        cname: domainCname,
        a: domainA,
        targetA,
        wwwDomain: wwwDomain || null,
        wwwCname,
        wwwA,
        nameservers,
      },
      message:
        status === "configured"
          ? rootAliasFlattenedMatch
            ? "Domínio raiz publicado via ALIAS/ANAME; o IP flattenado pode diferir do host alvo e ainda assim estar correto."
            : wwwMatch && !cnameMatch && !aMatch
              ? "Domínio www apontado corretamente. O raiz pode estar em propagação/caching, mas a configuração já foi encontrada."
            : "Domínio apontado corretamente."
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

    const adminRows = tenantIds.length > 0
      ? await db
          .select({
            tenantId: adminUserTenantsTable.tenantId,
            role: adminUserTenantsTable.role,
            username: adminUsersTable.username,
          })
          .from(adminUserTenantsTable)
          .leftJoin(adminUsersTable, eq(adminUsersTable.id, adminUserTenantsTable.adminUserId))
          .where(inArray(adminUserTenantsTable.tenantId, tenantIds))
      : [];

    const adminByTenantId = new Map<string, string>();
    for (const row of adminRows) {
      if (!row.username) continue;
      const normalizedTenantId = String(row.tenantId || "").trim();
      if (!normalizedTenantId) continue;
      const normalizedRole = String(row.role || "").trim().toLowerCase();
      if (normalizedRole === "owner") {
        adminByTenantId.set(normalizedTenantId, row.username);
        continue;
      }
      if (!adminByTenantId.has(normalizedTenantId)) {
        adminByTenantId.set(normalizedTenantId, row.username);
      }
    }

    const marginRows = tenantIds.length > 0
      ? await db
          .select({ tenantId: tenantSettingsTable.tenantId, value: tenantSettingsTable.value })
          .from(tenantSettingsTable)
          .where(and(inArray(tenantSettingsTable.tenantId, tenantIds), eq(tenantSettingsTable.key, TENANT_SUPPLY_MARGIN_PERCENT_KEY)))
      : [];

    const fixedMarginRows = tenantIds.length > 0
      ? await db
          .select({ tenantId: tenantSettingsTable.tenantId, value: tenantSettingsTable.value })
          .from(tenantSettingsTable)
          .where(and(inArray(tenantSettingsTable.tenantId, tenantIds), eq(tenantSettingsTable.key, TENANT_SUPPLY_MARGIN_FIXED_BRL_KEY)))
      : [];

    const syncRows = tenantIds.length > 0
      ? await db
          .select({ tenantId: tenantSettingsTable.tenantId, value: tenantSettingsTable.value })
          .from(tenantSettingsTable)
          .where(and(inArray(tenantSettingsTable.tenantId, tenantIds), eq(tenantSettingsTable.key, TENANT_SYNC_PRODUCTS_FROM_LOJA1_KEY)))
      : [];

    const marginByTenantId = new Map(
      marginRows.map((row) => [row.tenantId, Number.parseFloat(String(row.value || "0")) || 0]),
    );

    const fixedMarginByTenantId = new Map(
      fixedMarginRows.map((row) => [row.tenantId, Number.parseFloat(String(row.value || "0")) || 0]),
    );

    const syncByTenantId = new Map(
      syncRows.map((row) => [row.tenantId, parseBool(String(row.value || "0"))]),
    );

    res.json({
      tenants: rows.map((row) => ({
        ...row,
        dnsTargetHost: targetByTenantId.get(row.id) || null,
        adminUsername: adminByTenantId.get(row.id) || null,
        supplyMarginPercent: Number(marginByTenantId.get(row.id) || 0),
        supplyMarginFixedBrl: Number(fixedMarginByTenantId.get(row.id) || 0),
        syncProductsFromLoja1: Boolean(syncByTenantId.get(row.id) || false),
      })),
    });
  } catch (err) {
    console.error("[Tenants] GET error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar lojas." });
  }
});

router.patch("/admin/tenants/:tenantId/supply-margin", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const tenantId = String(req.params.tenantId || "").trim();
    const marginRaw = Number(req.body?.marginPercent);
    const fixedRaw = Number(req.body?.marginFixedBrl);

    if (!tenantId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe a loja a ser atualizada." });
      return;
    }

    if (!Number.isFinite(marginRaw) || marginRaw < 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe uma margem válida (>= 0)." });
      return;
    }

    if (!Number.isFinite(fixedRaw) || fixedRaw < 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe uma margem fixa válida (>= 0)." });
      return;
    }

    const marginPercent = Math.round(marginRaw * 100) / 100;
    const marginFixedBrl = Math.round(fixedRaw * 100) / 100;

    const existing = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Loja não encontrada." });
      return;
    }

    await db
      .insert(tenantSettingsTable)
      .values({
        tenantId,
        key: TENANT_SUPPLY_MARGIN_PERCENT_KEY,
        value: String(marginPercent),
        updatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          value: String(marginPercent),
          updatedAt: new Date(),
        },
      });

    await db
      .insert(tenantSettingsTable)
      .values({
        tenantId,
        key: TENANT_SUPPLY_MARGIN_FIXED_BRL_KEY,
        value: String(marginFixedBrl),
        updatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          value: String(marginFixedBrl),
          updatedAt: new Date(),
        },
      });

    if (await isTenantSyncFromLoja1Enabled(tenantId)) {
      await syncAllLoja1ProductsToTenant(tenantId);
    }

    res.json({ ok: true, tenantId, marginPercent, marginFixedBrl });
  } catch (err) {
    console.error("[Tenants] PATCH supply-margin error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar margem de repasse." });
  }
});

router.patch("/admin/tenants/:tenantId/product-sync", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const tenantId = String(req.params.tenantId || "").trim();
    const enabled = req.body?.enabled === true;

    if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe uma filial válida." });
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

    await db
      .insert(tenantSettingsTable)
      .values({
        tenantId,
        key: TENANT_SYNC_PRODUCTS_FROM_LOJA1_KEY,
        value: enabled ? "1" : "0",
        updatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          value: enabled ? "1" : "0",
          updatedAt: new Date(),
        },
      });

    let syncedProducts = 0;
    if (enabled) {
      syncedProducts = await syncAllLoja1ProductsToTenant(tenantId);
    }

    res.json({ ok: true, tenantId, enabled, syncedProducts });
  } catch (err) {
    console.error("[Tenants] PATCH product-sync error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar sincronização de produtos." });
  }
});

router.post("/admin/tenants/:tenantId/product-sync/refresh", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const tenantId = String(req.params.tenantId || "").trim();
    if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe uma filial válida." });
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

    const enabled = await isTenantSyncFromLoja1Enabled(tenantId);
    if (!enabled) {
      res.status(409).json({ error: "SYNC_DISABLED", message: "Ative a sincronização antes de atualizar os produtos." });
      return;
    }

    const syncedProducts = await syncAllLoja1ProductsToTenant(tenantId);
    res.json({ ok: true, tenantId, syncedProducts });
  } catch (err) {
    console.error("[Tenants] POST product-sync refresh error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar produtos." });
  }
});

router.delete("/admin/tenants/:tenantId/product-sync", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const tenantId = String(req.params.tenantId || "").trim();
    if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe uma filial válida." });
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

    const removedProducts = await removeAllLoja1ProductsFromTenant(tenantId);
    res.json({ ok: true, tenantId, removedProducts });
  } catch (err) {
    console.error("[Tenants] DELETE product-sync error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao remover produtos sincronizados." });
  }
});

router.get("/admin/tenants/profit-summary", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const { dateFrom, dateTo } = req.query as Record<string, string>;

    const tenants = await db
      .select({ id: tenantsTable.id, name: tenantsTable.name, slug: tenantsTable.slug })
      .from(tenantsTable)
      .orderBy(asc(tenantsTable.createdAt));

    const tenantIds = tenants.map((tenant) => tenant.id);
    if (tenantIds.length === 0) {
      res.json({ summaries: [] });
      return;
    }

    const marginRows = await db
      .select({ tenantId: tenantSettingsTable.tenantId, value: tenantSettingsTable.value })
      .from(tenantSettingsTable)
      .where(and(inArray(tenantSettingsTable.tenantId, tenantIds), eq(tenantSettingsTable.key, TENANT_SUPPLY_MARGIN_PERCENT_KEY)));

    const marginByTenantId = new Map(
      marginRows.map((row) => [row.tenantId, Number.parseFloat(String(row.value || "0")) || 0]),
    );

    const conditions = [
      inArray(ordersTable.tenantId, tenantIds),
      inArray(ordersTable.status, ["paid", "completed"]),
    ];
    if (dateFrom) conditions.push(gte(ordersTable.createdAt, toUTC(dateFrom, "00", "00", "00")));
    if (dateTo) conditions.push(lte(ordersTable.createdAt, toUTC(dateTo, "23", "59", "59")));

    const orders = await db
      .select({
        tenantId: ordersTable.tenantId,
        total: ordersTable.total,
        products: ordersTable.products,
      })
      .from(ordersTable)
      .where(and(...conditions));

    const byTenant = new Map<string, {
      ordersCount: number;
      totalPaid: number;
      childRepasseCost: number;
      loja1EstimatedCost: number;
      loja1EstimatedProfit: number;
      childGrossProfit: number;
      groupEstimatedGrossProfit: number;
      marginPercent: number;
    }>();

    for (const tenant of tenants) {
      const marginPercent = Number(marginByTenantId.get(tenant.id) || 0);
      byTenant.set(tenant.id, {
        ordersCount: 0,
        totalPaid: 0,
        childRepasseCost: 0,
        loja1EstimatedCost: 0,
        loja1EstimatedProfit: 0,
        childGrossProfit: 0,
        groupEstimatedGrossProfit: 0,
        marginPercent,
      });
    }

    for (const order of orders) {
      const tenantId = String(order.tenantId || "").trim();
      if (!tenantId) continue;

      const bucket = byTenant.get(tenantId);
      if (!bucket) continue;

      const totalPaid = Number(order.total || 0);
      const childRepasseCost = sumOrderCost(order.products);
      const divisor = 1 + bucket.marginPercent / 100;
      const loja1EstimatedCost = divisor > 0 ? childRepasseCost / divisor : childRepasseCost;
      const loja1EstimatedProfit = childRepasseCost - loja1EstimatedCost;
      const childGrossProfit = totalPaid - childRepasseCost;
      const groupEstimatedGrossProfit = totalPaid - loja1EstimatedCost;

      bucket.ordersCount += 1;
      bucket.totalPaid += totalPaid;
      bucket.childRepasseCost += childRepasseCost;
      bucket.loja1EstimatedCost += loja1EstimatedCost;
      bucket.loja1EstimatedProfit += loja1EstimatedProfit;
      bucket.childGrossProfit += childGrossProfit;
      bucket.groupEstimatedGrossProfit += groupEstimatedGrossProfit;
    }

    const summaries = tenants
      .filter((tenant) => tenant.id !== DEFAULT_TENANT_ID)
      .map((tenant) => {
        const bucket = byTenant.get(tenant.id)!;
        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          marginPercent: bucket.marginPercent,
          ordersCount: bucket.ordersCount,
          totalPaid: Number(bucket.totalPaid.toFixed(2)),
          childRepasseCost: Number(bucket.childRepasseCost.toFixed(2)),
          loja1EstimatedCost: Number(bucket.loja1EstimatedCost.toFixed(2)),
          loja1EstimatedProfit: Number(bucket.loja1EstimatedProfit.toFixed(2)),
          childGrossProfit: Number(bucket.childGrossProfit.toFixed(2)),
          groupEstimatedGrossProfit: Number(bucket.groupEstimatedGrossProfit.toFixed(2)),
        };
      });

    res.json({ summaries });
  } catch (err) {
    console.error("[Tenants] GET profit-summary error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar resumo de lucro por loja." });
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

router.patch("/admin/tenants/:tenantId/admin-credentials", requirePrimaryAdmin, async (req, res) => {
  try {
    if (!ensureDefaultTenantScope(req, res)) return;

    const tenantId = String(req.params.tenantId || "").trim();
    const newUsername = String(req.body?.newUsername || "").trim().toLowerCase();
    const newPassword = String(req.body?.newPassword || "");

    if (!tenantId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe a loja a ser atualizada." });
      return;
    }

    if (tenantId === DEFAULT_TENANT_ID) {
      res.status(403).json({ error: "FORBIDDEN", message: "Altere o admin da Loja 1 pela área de usuários do sistema." });
      return;
    }

    if (!newUsername && !newPassword) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe novo usuário e/ou nova senha." });
      return;
    }

    const tenant = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!tenant[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Loja não encontrada." });
      return;
    }

    if (newPassword && newPassword.length < 6) {
      res.status(400).json({ error: "INVALID_INPUT", message: "A senha do admin deve ter no mínimo 6 caracteres." });
      return;
    }

    const tenantAdmin = await resolveTenantAdminUser(tenantId);
    if (!tenantAdmin) {
      res.status(404).json({ error: "ADMIN_NOT_FOUND", message: "Nenhum admin vinculado a esta loja." });
      return;
    }

    if (tenantAdmin.isPrimary) {
      res.status(403).json({ error: "FORBIDDEN", message: "Não é permitido editar credenciais de admin primário por esta tela." });
      return;
    }

    if (newUsername && newUsername !== String(tenantAdmin.username || "").trim().toLowerCase()) {
      const existingByUsername = await resolveAdminUserByUsername(newUsername);
      if (existingByUsername) {
        res.status(409).json({ error: "ADMIN_USERNAME_EXISTS", message: "Já existe um admin com esse usuário." });
        return;
      }
    }

    const updatePayload: {
      username?: string;
      passwordHash?: string;
      salt?: string;
    } = {};

    if (newUsername) {
      updatePayload.username = newUsername;
    }

    if (newPassword) {
      const salt = generateSalt();
      updatePayload.salt = salt;
      updatePayload.passwordHash = hashPassword(newPassword, salt);
    }

    await db.update(adminUsersTable).set(updatePayload).where(eq(adminUsersTable.id, tenantAdmin.id));

    res.json({
      ok: true,
      tenantId,
      adminUsername: updatePayload.username || tenantAdmin.username,
    });
  } catch (err) {
    console.error("[Tenants] PATCH admin-credentials error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar credenciais do admin da loja." });
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
      siteName,
      supportWhatsapp,
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
      siteName?: string;
      supportWhatsapp?: string;
    };

    const cleanName = String(name || "").trim();
    const cleanSlug = normalizeSlug(String(slug || ""));
    const cleanDomain = normalizeDomain(String(domain || ""));
    const cleanDnsTargetHost = normalizeDomain(String(dnsTargetHost || ""));
    const cleanSiteName = String(siteName || "").trim();
    const cleanSupportWhatsapp = normalizeWhatsapp(String(supportWhatsapp || ""));
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

      const motoboyNeighborhoodKeys = new Set<string>();
      const filialMotoboyNeighborhoods = DEFAULT_MOTOBOY_NEIGHBORHOODS.filter((neighborhood) => {
        const key = `${neighborhood.city.trim().toLowerCase()}|${neighborhood.neighborhoodName.trim().toLowerCase()}`;
        if (motoboyNeighborhoodKeys.has(key)) return false;
        motoboyNeighborhoodKeys.add(key);
        return true;
      });
      await tx.insert(motoboyNeighborhoodsTable).values(
        filialMotoboyNeighborhoods.map((neighborhood) => ({
          id: `seed_motoboy_${crypto.createHash("sha256").update(`${tenantId}|${neighborhood.id}`).digest("hex").slice(0, 24)}`,
          tenantId,
          neighborhoodName: neighborhood.neighborhoodName,
          city: neighborhood.city,
          price: neighborhood.price.toFixed(2),
          intervalHours: neighborhood.price <= 75 ? 1 : 2,
          sortOrder: neighborhood.sortOrder,
          isActive: true,
          notes: null,
        })),
      );

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

      if (cleanSiteName) {
        await tx
          .insert(tenantSettingsTable)
          .values({
            tenantId,
            key: TENANT_SITE_NAME_KEY,
            value: cleanSiteName,
            updatedAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              value: cleanSiteName,
              updatedAt: new Date(),
            },
          });
      }

      if (cleanSupportWhatsapp) {
        await tx
          .insert(tenantSettingsTable)
          .values({
            tenantId,
            key: TENANT_SUPPORT_WHATSAPP_KEY,
            value: cleanSupportWhatsapp,
            updatedAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              value: cleanSupportWhatsapp,
              updatedAt: new Date(),
            },
          });
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
