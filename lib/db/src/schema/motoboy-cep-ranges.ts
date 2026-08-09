import { boolean, decimal, index, int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const motoboyCepRangesTable = mysqlTable("motoboy_cep_ranges", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  city: varchar("city", { length: 255 }),
  cepStart: int("cep_start").notNull(),
  cepEnd: int("cep_end").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  intervalHours: int("interval_hours").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: int("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("motoboy_cep_ranges_lookup_idx").on(table.tenantId, table.isActive, table.cepStart, table.cepEnd),
]);

export type MotoboyCepRange = typeof motoboyCepRangesTable.$inferSelect;
