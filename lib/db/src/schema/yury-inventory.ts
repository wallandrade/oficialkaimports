import { int, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

export const yuryInventoryBalancesTable = mysqlTable("yury_inventory_balances", {
  productId: varchar("product_id", { length: 255 }).primaryKey(),
  productName: varchar("product_name", { length: 255 }).notNull(),
  qtyMotoboy: int("qty_motoboy").notNull().default(0),
  qtyMinas: int("qty_minas").notNull().default(0),
  syncedAt: timestamp("synced_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type YuryInventoryBalance = typeof yuryInventoryBalancesTable.$inferSelect;
