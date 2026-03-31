import { mysqlTable, varchar, text, decimal, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customChargesTable = mysqlTable("custom_charges", {
  id: varchar("id", { length: 255 }).primaryKey(),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  clientEmail: varchar("client_email", { length: 255 }).notNull(),
  clientPhone: varchar("client_phone", { length: 255 }).notNull(),
  clientDocument: varchar("client_document", { length: 255 }).notNull(),
  addressCep: varchar("address_cep", { length: 255 }),
  addressStreet: varchar("address_street", { length: 255 }),
  addressNumber: varchar("address_number", { length: 255 }),
  addressComplement: varchar("address_complement", { length: 255 }),
  addressNeighborhood: varchar("address_neighborhood", { length: 255 }),
  addressCity: varchar("address_city", { length: 255 }),
  addressState: varchar("address_state", { length: 2 }),
  orderId: varchar("order_id", { length: 255 }),
  description: text("description"),
  sellerCode: varchar("seller_code", { length: 255 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  transactionId: varchar("transaction_id", { length: 255 }),
  proofUrl: text("proof_url"),
  proofUrls: text("proof_urls"),
  observation: text("observation"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCustomChargeSchema = createInsertSchema(customChargesTable).omit({ createdAt: true, updatedAt: true });
export type InsertCustomCharge = z.infer<typeof insertCustomChargeSchema>;
export type CustomCharge = typeof customChargesTable.$inferSelect;
