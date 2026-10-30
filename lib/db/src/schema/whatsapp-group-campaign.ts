import { mysqlTable, varchar, text, int, timestamp } from "drizzle-orm/mysql-core";

export const whatsappGroupCustomPostsTable = mysqlTable("whatsapp_group_custom_posts", {
  id: varchar("id", { length: 24 }).primaryKey(),
  imageUrl: text("image_url").notNull(),
  caption: varchar("caption", { length: 1000 }).notNull(),
  linkUrl: varchar("link_url", { length: 500 }),
  scheduledAt: varchar("scheduled_at", { length: 16 }).notNull(),
  scheduleMode: varchar("schedule_mode", { length: 16 }).notNull(),
  scheduleTimes: text("schedule_times"),
  intervalHours: int("interval_hours"),
  durationDays: int("duration_days"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const whatsappGroupSendLogTable = mysqlTable("whatsapp_group_send_log", {
  id: varchar("id", { length: 191 }).primaryKey(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

export type WhatsappGroupCustomPost = typeof whatsappGroupCustomPostsTable.$inferSelect;
export type WhatsappGroupSendLog = typeof whatsappGroupSendLogTable.$inferSelect;
