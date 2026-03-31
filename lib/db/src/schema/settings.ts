import { mysqlTable, varchar, text, timestamp } from "drizzle-orm/mysql-core";

export const siteSettingsTable = mysqlTable("site_settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
