import { mysqlTable, varchar, timestamp, primaryKey } from "drizzle-orm/mysql-core";

export const adminSellerScopesTable = mysqlTable("admin_seller_scopes", {
  adminUserId: varchar("admin_user_id", { length: 255 }).notNull(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  sellerCode: varchar("seller_code", { length: 255 }),
  status: varchar("status", { length: 16 }).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.adminUserId] }),
}));

export type AdminSellerScope = typeof adminSellerScopesTable.$inferSelect;
