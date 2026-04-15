import { mysqlTable, varchar, json, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reshipmentsTable = mysqlTable("reshipments", {
  id: varchar("id", { length: 255 }).primaryKey(),
  orderId: varchar("order_id", { length: 255 }).notNull(),
  supportTicketId: varchar("support_ticket_id", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("reenvio_aguardando_estoque"),
  productsSnapshot: json("products_snapshot").notNull(),
  resolvedReason: varchar("resolved_reason", { length: 255 }),
  authorizedAt: timestamp("authorized_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertReshipmentSchema = createInsertSchema(reshipmentsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertReshipment = z.infer<typeof insertReshipmentSchema>;
export type Reshipment = typeof reshipmentsTable.$inferSelect;
