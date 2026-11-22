import { mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Ação da moderação de convite nos grupos da loja 1.
 * Não guarda telefone completo, nome, texto nem link.
 */
export const whatsappGroupModerationLogTable = mysqlTable("whatsapp_group_moderation_log", {
  messageId: varchar("message_id", { length: 160 }).primaryKey(),
  groupId: varchar("group_id", { length: 64 }).notNull(),
  participantTail: varchar("participant_tail", { length: 4 }).notNull(),
  reason: varchar("reason", { length: 32 }).notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type WhatsappGroupModerationLog = typeof whatsappGroupModerationLogTable.$inferSelect;
