import { mysqlTable, varchar, text, mediumtext, decimal, int, boolean, timestamp, datetime } from "drizzle-orm/mysql-core";

export const productsTable = mysqlTable("products", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 255 }).notNull().default("Geral"),
  unit: varchar("unit", { length: 50 }).notNull().default("unidade"), // unidade | caixa | caneta | frasco
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  costPrice: decimal("cost_price", { precision: 10, scale: 2 }).notNull().default("0.00"),
  promoPrice: decimal("promo_price", { precision: 10, scale: 2 }),
  promoEndsAt: datetime("promo_ends_at", { mode: 'date' }),
  image: mediumtext("image"),          // public URL in R2/CDN, with legacy base64 values still supported during migration
  brand: varchar("brand", { length: 255 }),
  isActive: boolean("is_active").notNull().default(true),
  isSoldOut: boolean("is_sold_out").notNull().default(false),
  isLaunch: boolean("is_launch").notNull().default(false),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Product = typeof productsTable.$inferSelect;
