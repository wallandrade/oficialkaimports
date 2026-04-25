import { mysqlTable, int, varchar, decimal, timestamp } from "drizzle-orm/mysql-core";

export const productCostHistoryTable = mysqlTable("product_cost_history", {
  id:          int("id").primaryKey().autoincrement(),
  productId:   varchar("product_id", { length: 255 }).notNull(),
  costPrice:   decimal("cost_price", { precision: 10, scale: 2 }).notNull(),
  changedAt:   timestamp("changed_at").notNull().defaultNow(),
});

export type ProductCostHistory = typeof productCostHistoryTable.$inferSelect;
