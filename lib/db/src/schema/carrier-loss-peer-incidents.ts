import { index, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Espelho da lista de extravio da outra loja. Sem pedido, CEP, telefone ou rastreio. */
export const carrierLossPeerIncidentsTable = mysqlTable("carrier_loss_peer_incidents", {
  id: varchar("id", { length: 255 }).primaryKey(),
  source: varchar("source", { length: 64 }).notNull(),
  carrierKey: varchar("carrier_key", { length: 128 }).notNull(),
  carrierName: varchar("carrier_name", { length: 255 }).notNull(),
  cityKey: varchar("city_key", { length: 128 }).notNull(),
  cityName: varchar("city_name", { length: 255 }).notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  neighborhoodKey: varchar("neighborhood_key", { length: 128 }).notNull().default(""),
  neighborhoodName: varchar("neighborhood_name", { length: 255 }),
  regionKey: varchar("region_key", { length: 32 }).notNull(),
  regionLabel: varchar("region_label", { length: 255 }).notNull(),
  scope: varchar("scope", { length: 16 }).notNull(),
  incidentType: varchar("incident_type", { length: 16 }).notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  removedAt: timestamp("removed_at"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("carrier_loss_peer_quote_idx").on(table.cityKey, table.state, table.removedAt, table.occurredAt),
  index("carrier_loss_peer_source_idx").on(table.source, table.removedAt),
]);

export type CarrierLossPeerIncident = typeof carrierLossPeerIncidentsTable.$inferSelect;
export type InsertCarrierLossPeerIncident = typeof carrierLossPeerIncidentsTable.$inferInsert;
