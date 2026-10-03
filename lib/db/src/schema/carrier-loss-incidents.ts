import { index, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const carrierLossIncidentsTable = mysqlTable("carrier_loss_incidents", {
  id: varchar("id", { length: 255 }).primaryKey(),
  orderId: varchar("order_id", { length: 255 }).notNull(),
  packageId: varchar("package_id", { length: 255 }).notNull().default(""),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  carrierKey: varchar("carrier_key", { length: 128 }).notNull(),
  carrierName: varchar("carrier_name", { length: 255 }).notNull(),
  cityKey: varchar("city_key", { length: 128 }).notNull(),
  cityName: varchar("city_name", { length: 255 }).notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  neighborhoodKey: varchar("neighborhood_key", { length: 128 }).notNull().default(""),
  neighborhoodName: varchar("neighborhood_name", { length: 255 }),
  cep: varchar("cep", { length: 8 }).notNull(),
  regionKey: varchar("region_key", { length: 32 }).notNull(),
  incidentType: varchar("incident_type", { length: 16 }).notNull(),
  source: varchar("source", { length: 16 }).notNull(),
  rawStatus: text("raw_status"),
  orderNumber: int("order_number"),
  occurredAt: timestamp("occurred_at").notNull(),
  removedAt: timestamp("removed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("carrier_loss_incidents_order_package_unique").on(table.orderId, table.packageId),
  index("carrier_loss_incidents_quote_idx").on(table.tenantId, table.cityKey, table.state, table.removedAt, table.occurredAt),
]);

export type CarrierLossIncident = typeof carrierLossIncidentsTable.$inferSelect;
export type InsertCarrierLossIncident = typeof carrierLossIncidentsTable.$inferInsert;
