import { mysqlTable, varchar, text, timestamp, primaryKey } from "drizzle-orm/mysql-core";

export const siteSettingsTable = mysqlTable("site_settings", {
  tenantId: varchar("tenant_id", { length: 255 }),
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tenantSettingsTable = mysqlTable("tenant_settings", {
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  key: varchar("key", { length: 255 }).notNull(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.tenantId, table.key] }),
}));
