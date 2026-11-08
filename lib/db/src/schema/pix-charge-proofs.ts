import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";

/** Hash do webhookToken devolvido na criação. O token em claro não fica aqui. */
export const pixChargeProofsTable = mysqlTable("pix_charge_proofs", {
  transactionId: varchar("transaction_id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
