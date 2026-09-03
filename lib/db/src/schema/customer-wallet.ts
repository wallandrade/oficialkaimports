import { mysqlTable, varchar, decimal, text, timestamp } from "drizzle-orm/mysql-core";

export const customerWalletLedgerTable = mysqlTable("customer_wallet_ledger", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  userId: varchar("user_id", { length: 255 }).notNull(),
  orderId: varchar("order_id", { length: 255 }),
  type: varchar("type", { length: 64 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CustomerWalletLedger = typeof customerWalletLedgerTable.$inferSelect;
