import { date, index, int, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const motoboyDeliveryReservationsTable = mysqlTable("motoboy_delivery_reservations", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  orderId: varchar("order_id", { length: 255 }).notNull(),
  neighborhoodId: varchar("neighborhood_id", { length: 255 }).notNull(),
  neighborhoodName: varchar("neighborhood_name", { length: 255 }).notNull(),
  city: varchar("city", { length: 255 }),
  deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
  slotHour: int("slot_hour").notNull(),
  startTime: varchar("start_time", { length: 5 }).notNull(),
  durationHours: int("duration_hours").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("motoboy_delivery_reservations_slot_unique").on(table.tenantId, table.deliveryDate, table.slotHour),
  index("motoboy_delivery_reservations_order_idx").on(table.orderId),
]);

export type MotoboyDeliveryReservation = typeof motoboyDeliveryReservationsTable.$inferSelect;
