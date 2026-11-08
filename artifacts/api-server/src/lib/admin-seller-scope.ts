import { adminSellerScopesTable, adminUserTenantsTable, adminUsersTable, db, sellersTable, tenantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  SELLER_SCOPE_CLEARED,
  SELLER_SCOPE_LINKED,
  sellerRowBelongsToTenant,
  type ExplicitSellerScope,
} from "./admin-seller-scope-core";

const DEFAULT_TENANT_ID = "tenant_loja1";

export function normalizeSellerSlug(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

async function findAdminUser(input: { adminUserId?: string | null; username?: string | null }) {
  const adminUserId = String(input.adminUserId || "").trim();
  if (adminUserId) {
    const [byId] = await db
      .select({ id: adminUsersTable.id, username: adminUsersTable.username, isPrimary: adminUsersTable.isPrimary })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, adminUserId))
      .limit(1);
    if (byId) return byId;
  }
  const username = String(input.username || "").trim().toLowerCase();
  if (!username) return null;
  const [byName] = await db
    .select({ id: adminUsersTable.id, username: adminUsersTable.username, isPrimary: adminUsersTable.isPrimary })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.username, username))
    .limit(1);
  return byName || null;
}

export async function loadAdminAccessFacts(input: { adminUserId?: string | null; username?: string | null }): Promise<{
  adminUserId: string | null;
  currentUsername: string | null;
  isPrimaryUser: boolean;
  explicit: ExplicitSellerScope | null;
  storeAdminTenantId: string | null;
}> {
  const user = await findAdminUser(input);
  if (!user) {
    return { adminUserId: null, currentUsername: null, isPrimaryUser: false, explicit: null, storeAdminTenantId: null };
  }
  const [scope] = await db
    .select({
      tenantId: adminSellerScopesTable.tenantId,
      sellerCode: adminSellerScopesTable.sellerCode,
      status: adminSellerScopesTable.status,
    })
    .from(adminSellerScopesTable)
    .where(eq(adminSellerScopesTable.adminUserId, user.id))
    .limit(1);
  const memberships = await db
    .select({ tenantId: adminUserTenantsTable.tenantId, role: adminUserTenantsTable.role })
    .from(adminUserTenantsTable)
    .where(eq(adminUserTenantsTable.adminUserId, user.id));
  const storeAdmin = memberships.find((row) => {
    const tenantId = String(row.tenantId || "").trim();
    return tenantId && tenantId !== DEFAULT_TENANT_ID && String(row.role || "").trim().toLowerCase() === "owner";
  });
  let explicit: ExplicitSellerScope | null = null;
  if (scope && (scope.status === SELLER_SCOPE_LINKED || scope.status === SELLER_SCOPE_CLEARED)) {
    const sellerCode = normalizeSellerSlug(scope.sellerCode);
    let sellerValid = false;
    if (scope.status === SELLER_SCOPE_LINKED && sellerCode) {
      const [seller] = await db
        .select({ tenantId: sellersTable.tenantId })
        .from(sellersTable)
        .where(eq(sellersTable.slug, sellerCode))
        .limit(1);
      sellerValid = !!seller && sellerRowBelongsToTenant(seller.tenantId, scope.tenantId, DEFAULT_TENANT_ID);
    }
    explicit = {
      status: scope.status,
      tenantId: String(scope.tenantId || "").trim(),
      sellerCode: sellerCode || null,
      sellerValid,
    };
  }
  return {
    adminUserId: user.id,
    currentUsername: String(user.username || "").trim().toLowerCase() || null,
    isPrimaryUser: !!user.isPrimary,
    explicit,
    storeAdminTenantId: storeAdmin ? String(storeAdmin.tenantId || "").trim() : null,
  };
}

export async function assertSellerInTenant(tenantId: string, sellerSlug: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const tenant = String(tenantId || "").trim();
  const slug = normalizeSellerSlug(sellerSlug);
  if (!tenant || !slug) return { ok: false, message: "Informe a loja e o vendedor." };
  const [store] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, tenant)).limit(1);
  if (!store && tenant !== DEFAULT_TENANT_ID) return { ok: false, message: "Loja não encontrada." };
  const [seller] = await db.select({ tenantId: sellersTable.tenantId }).from(sellersTable).where(eq(sellersTable.slug, slug)).limit(1);
  if (!seller || !sellerRowBelongsToTenant(seller.tenantId, tenant, DEFAULT_TENANT_ID)) {
    return { ok: false, message: "Esse vendedor não pertence à loja escolhida." };
  }
  return { ok: true };
}

export async function saveSellerScope(input: { adminUserId: string; tenantId: string; sellerSlug: string }): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const user = await findAdminUser({ adminUserId: input.adminUserId });
  if (!user) return { ok: false, status: 404, message: "Usuário não encontrado." };
  if (user.isPrimary) return { ok: false, status: 400, message: "O superadmin não fica limitado a um vendedor." };
  const facts = await loadAdminAccessFacts({ adminUserId: user.id });
  if (facts.storeAdminTenantId) return { ok: false, status: 400, message: "Admin de filial continua responsável pela loja inteira." };
  const slug = normalizeSellerSlug(input.sellerSlug);
  const check = await assertSellerInTenant(input.tenantId, slug);
  if (!check.ok) return { ok: false, status: 400, message: check.message };
  await db
    .insert(adminSellerScopesTable)
    .values({
      adminUserId: user.id,
      tenantId: String(input.tenantId).trim(),
      sellerCode: slug,
      status: SELLER_SCOPE_LINKED,
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        tenantId: String(input.tenantId).trim(),
        sellerCode: slug,
        status: SELLER_SCOPE_LINKED,
        updatedAt: new Date(),
      },
    });
  return { ok: true };
}

export async function clearSellerScope(adminUserId: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const user = await findAdminUser({ adminUserId });
  if (!user) return { ok: false, status: 404, message: "Usuário não encontrado." };
  if (user.isPrimary) return { ok: false, status: 400, message: "O superadmin não usa vínculo de vendedor." };
  const facts = await loadAdminAccessFacts({ adminUserId: user.id });
  if (facts.storeAdminTenantId) return { ok: false, status: 400, message: "Admin de filial não perde o acesso da loja por aqui." };
  await db
    .insert(adminSellerScopesTable)
    .values({
      adminUserId: user.id,
      tenantId: facts.explicit?.tenantId || DEFAULT_TENANT_ID,
      sellerCode: null,
      status: SELLER_SCOPE_CLEARED,
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: { sellerCode: null, status: SELLER_SCOPE_CLEARED, updatedAt: new Date() },
    });
  return { ok: true };
}

export async function listSellerSlugsForTenant(tenantId: string): Promise<string[] | null> {
  const tenant = String(tenantId || "").trim();
  if (!tenant) return null;
  if (tenant !== DEFAULT_TENANT_ID) {
    const [store] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, tenant)).limit(1);
    if (!store) return null;
  }
  const rows = await db.select({ slug: sellersTable.slug, tenantId: sellersTable.tenantId }).from(sellersTable);
  return rows
    .filter((row) => sellerRowBelongsToTenant(row.tenantId, tenant, DEFAULT_TENANT_ID))
    .map((row) => row.slug)
    .sort();
}
