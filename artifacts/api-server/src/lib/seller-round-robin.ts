import { and, eq } from "drizzle-orm";
import { db, sellersTable, tenantSettingsTable } from "@workspace/db";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { pickNextRoundRobinSeller, type SellerRoundRobinCandidate } from "./seller-round-robin-pick";

export const SELLER_ROUND_ROBIN_CURSOR_KEY = "seller_round_robin_cursor";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Atribui a compra sem código de vendedor ao próximo seller da loja.
 * O cursor fica em `tenant_settings` e a linha é travada até o commit da transação do pedido.
 */
export async function assignNextOrganicSeller(
  tx: DbTransaction,
  tenantId: string,
): Promise<SellerRoundRobinCandidate | null> {
  const safeTenantId = String(tenantId || DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID;

  await tx.insert(tenantSettingsTable).values({
    tenantId: safeTenantId,
    key: SELLER_ROUND_ROBIN_CURSOR_KEY,
    value: "",
    updatedAt: new Date(),
  }).onDuplicateKeyUpdate({
    set: { updatedAt: new Date() },
  });

  const [cursorRow] = await tx
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(
      eq(tenantSettingsTable.tenantId, safeTenantId),
      eq(tenantSettingsTable.key, SELLER_ROUND_ROBIN_CURSOR_KEY),
    ))
    .for("update")
    .limit(1);

  const sellers = await tx
    .select({
      slug: sellersTable.slug,
      hasCommission: sellersTable.hasCommission,
      commissionRate: sellersTable.commissionRate,
    })
    .from(sellersTable)
    .where(eq(sellersTable.tenantId, safeTenantId));

  const next = pickNextRoundRobinSeller(
    sellers.map((row) => ({
      slug: row.slug,
      hasCommission: Boolean(row.hasCommission),
      commissionRate: Number(row.commissionRate ?? 0),
    })),
    cursorRow?.value,
  );
  if (!next) return null;

  await tx.update(tenantSettingsTable).set({
    value: next.slug,
    updatedAt: new Date(),
  }).where(and(
    eq(tenantSettingsTable.tenantId, safeTenantId),
    eq(tenantSettingsTable.key, SELLER_ROUND_ROBIN_CURSOR_KEY),
  ));

  return next;
}
