import { ordersTable } from "@workspace/db";
import { eq, isNull, or, sql } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";

function buildTenantWhereForOrderNumber(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

export async function reserveNextOrderNumber(tx: any, tenantId: string): Promise<number> {
  const safeTenantId = String(tenantId || DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID;
  const lockKey = `orders_seq_${safeTenantId}`;

  await tx.execute(sql`SELECT GET_LOCK(${lockKey}, 10) AS acquired`);

  try {
    const maxRows = await tx
      .select({
        maxNumber: sql<number>`COALESCE(MAX(${ordersTable.orderNumber}), 0)`,
      })
      .from(ordersTable)
      .where(buildTenantWhereForOrderNumber(safeTenantId));

    const maxNumber = Number(maxRows[0]?.maxNumber || 0);
    return maxNumber + 1;
  } finally {
    await tx.execute(sql`DO RELEASE_LOCK(${lockKey})`);
  }
}
