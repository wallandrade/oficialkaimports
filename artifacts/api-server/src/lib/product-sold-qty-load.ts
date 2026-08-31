import { db, ordersTable } from "@workspace/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { aggregateSoldQtyFromOrders, soldQtyForCatalogProduct } from "./product-sold-qty";

function buildOrderTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

export async function loadCatalogSoldQty(
  tenantId: string,
  products: Array<{ id: string; name: string }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (products.length === 0) return out;

  const rows = await db
    .select({
      products: ordersTable.products,
      observation: ordersTable.observation,
    })
    .from(ordersTable)
    .where(and(
      buildOrderTenantWhere(tenantId),
      inArray(ordersTable.status, ["paid", "completed"]),
    ));

  const agg = aggregateSoldQtyFromOrders(rows);
  for (const product of products) {
    out.set(product.id, soldQtyForCatalogProduct(product, agg));
  }
  return out;
}
