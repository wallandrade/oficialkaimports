import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";

export const whatsappRecoverySendsTable = mysqlTable("whatsapp_recovery_sends", {
  phone: varchar("phone", { length: 32 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  customerName: varchar("customer_name", { length: 255 }),
  lastOrderAt: timestamp("last_order_at"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  answer: varchar("answer", { length: 32 }),
});

export type WhatsappRecoverySend = typeof whatsappRecoverySendsTable.$inferSelect;
