import { mysqlTable, varchar, text, decimal, int, boolean, timestamp } from "drizzle-orm/mysql-core";

export const orderBumpsTable = mysqlTable("order_bumps", {
  id: varchar("id", { length: 255 }).primaryKey(),
  productId: varchar("product_id", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  cardTitle: varchar("card_title", { length: 255 }),
  description: text("description"),
  image: text("image"),
  discountType: varchar("discount_type", { length: 50 }).notNull(),
  discountValue: decimal("discount_value", { precision: 10, scale: 2 }),
  buyQuantity: int("buy_quantity"),
  getQuantity: int("get_quantity"),
  tiers: text("tiers"), // JSON string — [{qty, price, image?}]
  unit: varchar("unit", { length: 50 }).notNull().default("unidade"),
  discountTagType: varchar("discount_tag_type", { length: 50 }).default("none"), // "none" | "percent" | "fixed"
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OrderBump = typeof orderBumpsTable.$inferSelect;
