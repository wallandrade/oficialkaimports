import { mysqlTable, uniqueIndex, varchar, timestamp } from "drizzle-orm/mysql-core";

export const customerUsersTable = mysqlTable("customer_users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  document: varchar("document", { length: 32 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  salt: varchar("salt", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("customer_users_tenant_email_unique").on(table.tenantId, table.email),
]);

export type CustomerUser = typeof customerUsersTable.$inferSelect;
