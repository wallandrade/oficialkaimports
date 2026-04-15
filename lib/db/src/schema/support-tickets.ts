import { mysqlTable, varchar, text, mediumtext, decimal, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supportTicketsTable = mysqlTable("support_tickets", {
  id: varchar("id", { length: 255 }).primaryKey(),
  orderId: varchar("order_id", { length: 255 }).notNull(),
  clientDocument: varchar("client_document", { length: 32 }).notNull(),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  description: text("description").notNull(),
  imageUrl: mediumtext("image_url"),
  addressChangeJson: mediumtext("address_change_json"),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  resolutionReason: varchar("resolution_reason", { length: 64 }),
  orderTotal: decimal("order_total", { precision: 10, scale: 2 }),
  orderCreatedAt: timestamp("order_created_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;
