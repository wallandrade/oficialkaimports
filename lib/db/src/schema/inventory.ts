import { mysqlTable, varchar, int, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inventoryBalancesTable = mysqlTable("inventory_balances", {
  productId: varchar("product_id", { length: 255 }).primaryKey(),
  quantity: int("quantity").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const inventoryMovementsTable = mysqlTable("inventory_movements", {
  id: varchar("id", { length: 255 }).primaryKey(),
  productId: varchar("product_id", { length: 255 }).notNull(),
  type: varchar("type", { length: 32 }).notNull().default("entry"),
  entrySource: varchar("entry_source", { length: 32 }),
  clientName: varchar("client_name", { length: 255 }),
  trackingCode: varchar("tracking_code", { length: 255 }),
  quantity: int("quantity").notNull(),
  reason: varchar("reason", { length: 255 }),
  referenceId: varchar("reference_id", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInventoryBalanceSchema = createInsertSchema(inventoryBalancesTable).omit({
  updatedAt: true,
});

export const insertInventoryMovementSchema = createInsertSchema(inventoryMovementsTable).omit({
  createdAt: true,
});

export type InsertInventoryBalance = z.infer<typeof insertInventoryBalanceSchema>;
export type InsertInventoryMovement = z.infer<typeof insertInventoryMovementSchema>;
export type InventoryBalance = typeof inventoryBalancesTable.$inferSelect;
export type InventoryMovement = typeof inventoryMovementsTable.$inferSelect;
