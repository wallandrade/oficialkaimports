import { mysqlTable, varchar, text, decimal, int, boolean, timestamp } from "drizzle-orm/mysql-core";

export const shippingOptionsTable = mysqlTable("shipping_options", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  sortOrder: int("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ShippingOption = typeof shippingOptionsTable.$inferSelect;
