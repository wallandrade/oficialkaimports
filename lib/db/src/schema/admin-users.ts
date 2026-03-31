import { mysqlTable, varchar, boolean, timestamp } from "drizzle-orm/mysql-core";

export const adminUsersTable = mysqlTable("admin_users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  salt: varchar("salt", { length: 255 }).notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdminUser = typeof adminUsersTable.$inferSelect;
