import { mysqlTable, varchar, decimal, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const orderBankDepositsTable = mysqlTable("order_bank_deposits", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  orderId: varchar("order_id", { length: 255 }).notNull(),
  fitid: varchar("fitid", { length: 64 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  payerName: varchar("payer_name", { length: 255 }),
  postedAt: varchar("posted_at", { length: 10 }),
  matchStatus: varchar("match_status", { length: 32 }).notNull(),
  note: varchar("note", { length: 500 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertOrderBankDepositSchema = createInsertSchema(orderBankDepositsTable).omit({
  createdAt: true,
});
export type InsertOrderBankDeposit = z.infer<typeof insertOrderBankDepositSchema>;
export type OrderBankDeposit = typeof orderBankDepositsTable.$inferSelect;
