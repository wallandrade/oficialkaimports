import { index, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const orderDeliveryCorrectionsTable = mysqlTable(
  "order_delivery_corrections",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    orderId: varchar("order_id", { length: 255 }).notNull(),
    token: varchar("token", { length: 64 }).notNull(),
    fields: varchar("fields", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    whatsappAttemptedAt: timestamp("whatsapp_attempted_at"),
    whatsappSentAt: timestamp("whatsapp_sent_at"),
    whatsappError: varchar("whatsapp_error", { length: 255 }),
    correctedAt: timestamp("corrected_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("order_delivery_corrections_token_uq").on(table.token),
    orderIdx: index("order_delivery_corrections_order_idx").on(table.orderId),
  }),
);

export type OrderDeliveryCorrection = typeof orderDeliveryCorrectionsTable.$inferSelect;
