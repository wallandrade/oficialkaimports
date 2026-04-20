import { mysqlTable, varchar, json, timestamp, text } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const manualReshipmentsTable = mysqlTable("manual_reshipments", {
  id: varchar("id", { length: 255 }).primaryKey(),
  status: varchar("status", { length: 50 }).notNull().default("reenvio_aguardando_estoque"),
  productsSnapshot: json("products_snapshot").notNull(),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  clientPhone: varchar("client_phone", { length: 255 }).notNull(),
  clientDocument: varchar("client_document", { length: 32 }),
  addressCep: varchar("address_cep", { length: 20 }).notNull(),
  addressStreet: varchar("address_street", { length: 255 }).notNull(),
  addressNumber: varchar("address_number", { length: 64 }).notNull(),
  addressComplement: varchar("address_complement", { length: 255 }),
  addressNeighborhood: varchar("address_neighborhood", { length: 255 }).notNull(),
  addressCity: varchar("address_city", { length: 255 }).notNull(),
  addressState: varchar("address_state", { length: 64 }).notNull(),
  notes: text("notes"),
  createdByUsername: varchar("created_by_username", { length: 255 }),
  authorizedAt: timestamp("authorized_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertManualReshipmentSchema = createInsertSchema(manualReshipmentsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertManualReshipment = z.infer<typeof insertManualReshipmentSchema>;
export type ManualReshipment = typeof manualReshipmentsTable.$inferSelect;
