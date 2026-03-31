import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";

export const sellersTable = mysqlTable("sellers", {
  slug: varchar("slug", { length: 255 }).primaryKey(),
  whatsapp: varchar("whatsapp", { length: 255 }).notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Seller = typeof sellersTable.$inferSelect;
