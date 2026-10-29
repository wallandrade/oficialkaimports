import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";

export const whatsappSupportSessionsTable = mysqlTable("whatsapp_support_sessions", {
  phone: varchar("phone", { length: 32 }).primaryKey(),
  step: varchar("step", { length: 32 }).notNull().default("menu"),
  problem: varchar("problem", { length: 64 }),
  pendingOrder: varchar("pending_order", { length: 64 }),
  menuSentAt: timestamp("menu_sent_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WhatsappSupportSession = typeof whatsappSupportSessionsTable.$inferSelect;
