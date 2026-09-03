import { mysqlTable, varchar, timestamp, json } from "drizzle-orm/mysql-core";

export const orderEventsTable = mysqlTable("order_events", {
  id: varchar("id", { length: 255 }).primaryKey(),
  orderId: varchar("order_id", { length: 255 }).notNull(),
  tenantId: varchar("tenant_id", { length: 255 }),
  action: varchar("action", { length: 64 }).notNull(),
  actorType: varchar("actor_type", { length: 32 }).notNull().default("admin"),
  actorUsername: varchar("actor_username", { length: 255 }),
  payload: json("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type OrderEvent = typeof orderEventsTable.$inferSelect;
