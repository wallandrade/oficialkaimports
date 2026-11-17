import { index, int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Fila de WhatsApp do cliente. Não guarda token, URL com segredo nem Client-Token. */
export const whatsappOutboundQueueTable = mysqlTable("whatsapp_outbound_queue", {
  id: varchar("id", { length: 64 }).primaryKey(),
  instanceKey: varchar("instance_key", { length: 32 }).notNull(),
  tenantId: varchar("tenant_id", { length: 255 }),
  phone: varchar("phone", { length: 32 }).notNull(),
  origin: varchar("origin", { length: 40 }).notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  message: text("message"),
  caption: text("caption"),
  image: varchar("image", { length: 1000 }),
  optionList: text("option_list"),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  attempts: int("attempts").notNull().default(0),
  lastError: varchar("last_error", { length: 120 }),
  nextAttemptAt: timestamp("next_attempt_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pick: index("whatsapp_outbound_queue_pick").on(table.instanceKey, table.status, table.nextAttemptAt, table.createdAt),
  sent: index("whatsapp_outbound_queue_sent").on(table.instanceKey, table.sentAt),
}));

export type WhatsappOutboundQueueRow = typeof whatsappOutboundQueueTable.$inferSelect;
