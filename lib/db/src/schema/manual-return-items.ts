import { mysqlTable, varchar, int, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const manualReturnItemsTable = mysqlTable("manual_return_items", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  returningOrder: varchar("returning_order", { length: 255 }),
  productId: varchar("product_id", { length: 255 }).notNull(),
  productName: varchar("product_name", { length: 255 }).notNull(),
  quantity: int("quantity").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertManualReturnItemSchema = createInsertSchema(manualReturnItemsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertManualReturnItem = z.infer<typeof insertManualReturnItemSchema>;
export type ManualReturnItem = typeof manualReturnItemsTable.$inferSelect;
