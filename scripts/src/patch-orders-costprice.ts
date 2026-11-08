import path from "node:path";
import { pathToFileURL } from "node:url";
import { db, ordersTable, productsTable } from "../../lib/db/src/index";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { COST_PATCH_WINDOW_MS, planOrderCostPatch, productIdsForCostLookup } from "./patch-orders-costprice-core";

export async function patchRecentPaidOrderCostPrices(now = new Date()): Promise<{
  scanned: number;
  updated: number;
  skipped: Record<string, number>;
}> {
  const cutoff = new Date(now.getTime() - COST_PATCH_WINDOW_MS);
  const orders = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      createdAt: ordersTable.createdAt,
      products: ordersTable.products,
    })
    .from(ordersTable)
    .where(and(
      inArray(ordersTable.status, ["paid", "completed"]),
      gte(ordersTable.createdAt, cutoff),
      lte(ordersTable.createdAt, now),
    ));

  const ids = new Set<string>();
  for (const order of orders) {
    for (const id of productIdsForCostLookup(order.products)) ids.add(id);
  }

  const catalogCosts = new Map<string, unknown>();
  if (ids.size > 0) {
    const rows = await db
      .select({ id: productsTable.id, costPrice: productsTable.costPrice })
      .from(productsTable)
      .where(inArray(productsTable.id, [...ids]));
    for (const row of rows) catalogCosts.set(row.id, row.costPrice);
  }

  const skipped: Record<string, number> = {};
  let updated = 0;
  for (const order of orders) {
    const plan = planOrderCostPatch({
      status: order.status,
      createdAt: order.createdAt,
      products: order.products,
      catalogCosts,
      now,
    });
    if (!plan.update) {
      skipped[plan.reason] = (skipped[plan.reason] || 0) + 1;
      continue;
    }
    await db.update(ordersTable)
      .set({ products: plan.products })
      .where(eq(ordersTable.id, order.id));
    updated += 1;
    console.log(`[patch:costprice] updated order=${order.id}`);
  }

  console.log(`[patch:costprice] scanned=${orders.length} updated=${updated} skipped=${JSON.stringify(skipped)}`);
  return { scanned: orders.length, updated, skipped };
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry && entry === import.meta.url) {
  patchRecentPaidOrderCostPrices()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.name : "error";
      console.error(`[patch:costprice] failed ${message}`);
      process.exit(1);
    });
}
