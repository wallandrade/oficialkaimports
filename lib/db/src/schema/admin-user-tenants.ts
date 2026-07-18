import { mysqlTable, varchar, timestamp, primaryKey } from "drizzle-orm/mysql-core";

export const adminUserTenantsTable = mysqlTable("admin_user_tenants", {
  adminUserId: varchar("admin_user_id", { length: 255 }).notNull(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  role: varchar("role", { length: 64 }).notNull().default("owner"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.adminUserId, table.tenantId] }),
}));

export type AdminUserTenant = typeof adminUserTenantsTable.$inferSelect;