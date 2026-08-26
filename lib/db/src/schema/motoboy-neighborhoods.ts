import { boolean, decimal, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const motoboyNeighborhoodsTable = mysqlTable("motoboy_neighborhoods", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  yuryId: varchar("yury_id", { length: 255 }),
  neighborhoodName: varchar("neighborhood_name", { length: 255 }).notNull(),
  city: varchar("city", { length: 255 }),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  intervalHours: int("interval_hours").notNull().default(1),
  sortOrder: int("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  remoteUpdatedAt: timestamp("remote_updated_at"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("motoboy_neighborhoods_tenant_yury_id_unique").on(table.tenantId, table.yuryId),
]);

export type MotoboyNeighborhood = typeof motoboyNeighborhoodsTable.$inferSelect;
