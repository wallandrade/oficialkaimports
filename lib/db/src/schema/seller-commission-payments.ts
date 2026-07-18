import { mysqlTable, varchar, decimal, timestamp, int, json, text } from "drizzle-orm/mysql-core";

export const sellerCommissionPaymentsTable = mysqlTable("seller_commission_payments", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  sellerCode: varchar("seller_code", { length: 255 }).notNull(),
  orderIds: json("order_ids").notNull(),
  periodStartDate: varchar("period_start_date", { length: 10 }),
  periodEndDate: varchar("period_end_date", { length: 10 }),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  orderCount: int("order_count").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  paymentMethod: varchar("payment_method", { length: 64 }),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});