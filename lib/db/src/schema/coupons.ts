import { mysqlTable, varchar, decimal, int, boolean, timestamp } from "drizzle-orm/mysql-core";

export const couponsTable = mysqlTable("coupons", {
  id: varchar("id", { length: 255 }).primaryKey(),
  code: varchar("code", { length: 255 }).notNull().unique(),
  discountType: varchar("discount_type", { length: 255 }).notNull().default("percent"), // "percent" | "fixed"
  discountValue: decimal("discount_value", { precision: 10, scale: 2 }).notNull(),
  minOrderValue: decimal("min_order_value", { precision: 10, scale: 2 }),
  maxUses: int("max_uses"),
  usedCount: int("used_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Coupon = typeof couponsTable.$inferSelect;
