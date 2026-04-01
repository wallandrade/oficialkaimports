import { mysqlTable, varchar, text, mediumtext, decimal, boolean, timestamp, json, int } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ordersTable = mysqlTable("orders", {
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
  products: json("products").notNull(),
  shippingType: varchar("shipping_type", { length: 50 }).notNull(),
  includeInsurance: boolean("include_insurance").notNull().default(false),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  shippingCost: decimal("shipping_cost", { precision: 10, scale: 2 }).notNull(),
  insuranceAmount: decimal("insurance_amount", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  paymentMethod: varchar("payment_method", { length: 50 }).default("pix"),
  cardInstallments: int("card_installments"),
  proofUrl: mediumtext("proof_url"),
  proofUrls: mediumtext("proof_urls"),
  transactionId: varchar("transaction_id", { length: 255 }),
  sellerCode: varchar("seller_code", { length: 255 }),
  couponCode: varchar("coupon_code", { length: 255 }),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }),
  observation: text("observation"),
  cardInstallmentsActual: int("card_installments_actual"),
  cardInstallmentValue: decimal("card_installment_value", { precision: 10, scale: 2 }),
  cardTotalActual: decimal("card_total_actual", { precision: 10, scale: 2 }),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }),
  pixCode: mediumtext("pix_code"),
  pixBase64: mediumtext("pix_base64"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
