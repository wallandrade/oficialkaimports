import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";

export const tenantsTable = mysqlTable("tenants", {
  id: varchar("id", { length: 255 }).primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  domain: varchar("domain", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;