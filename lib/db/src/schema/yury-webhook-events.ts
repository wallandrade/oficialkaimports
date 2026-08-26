import { mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

export const yuryWebhookEventsProcessedTable = mysqlTable("yury_webhook_events_processed", {
  eventId: varchar("event_id", { length: 255 }).primaryKey(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});
