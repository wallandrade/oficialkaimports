import { mysqlTable, varchar, timestamp, boolean, decimal } from "drizzle-orm/mysql-core";

export const sellersTable = mysqlTable("sellers", {
  slug: varchar("slug", { length: 255 }).primaryKey(),
  whatsapp: varchar("whatsapp", { length: 255 }).notNull().default(""),
  hasCommission: boolean("has_commission").notNull().default(true),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull().default("5.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Seller = typeof sellersTable.$inferSelect;
