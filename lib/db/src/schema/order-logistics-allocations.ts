import { date, index, int, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const orderLogisticsAllocationsTable = mysqlTable("order_logistics_allocations", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  orderId: varchar("order_id", { length: 255 }).notNull(),
  dispatchDate: date("dispatch_date", { mode: "string" }).notNull(),
  slotPosition: int("slot_position").notNull(),
  capacity: int("capacity").notNull().default(20),
  promisedHours: int("promised_hours").notNull(),
  deadlineAt: timestamp("deadline_at").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("allocated"),
  activeSlotKey: varchar("active_slot_key", { length: 255 }),
  allocatedAt: timestamp("allocated_at").notNull().defaultNow(),
  releasedAt: timestamp("released_at"),
}, (table) => [
  uniqueIndex("order_logistics_allocations_order_unique").on(table.orderId),
  uniqueIndex("order_logistics_allocations_active_slot_unique").on(table.activeSlotKey),
  index("order_logistics_allocations_schedule_idx").on(table.tenantId, table.dispatchDate, table.status),
]);