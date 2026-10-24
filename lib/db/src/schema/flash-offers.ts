import { mysqlTable, varchar, decimal, int, boolean, timestamp } from "drizzle-orm/mysql-core";

export const flashCampaignsTable = mysqlTable("flash_campaigns", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  slotLimit: int("slot_limit").notNull().default(5),
  drawPercent: int("draw_percent").notNull().default(25),
  showAfterSeconds: int("show_after_seconds").notNull().default(8),
  repeatAfterHours: int("repeat_after_hours").notNull().default(0),
  activeFromHour: int("active_from_hour"),
  activeUntilHour: int("active_until_hour"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const flashCampaignItemsTable = mysqlTable("flash_campaign_items", {
  id: varchar("id", { length: 255 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 255 }).notNull(),
  tenantId: varchar("tenant_id", { length: 255 }),
  productId: varchar("product_id", { length: 255 }).notNull(),
  flashPrice: decimal("flash_price", { precision: 10, scale: 2 }).notNull(),
  alwaysShow: boolean("always_show").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const flashVisitsTable = mysqlTable("flash_visits", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  campaignId: varchar("campaign_id", { length: 255 }).notNull(),
  visitorKey: varchar("visitor_key", { length: 80 }).notNull(),
  customerUserId: varchar("customer_user_id", { length: 255 }),
  ipHash: varchar("ip_hash", { length: 64 }),
  outcome: varchar("outcome", { length: 16 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const flashReservationsTable = mysqlTable("flash_reservations", {
  id: varchar("id", { length: 255 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }),
  campaignId: varchar("campaign_id", { length: 255 }).notNull(),
  visitorKey: varchar("visitor_key", { length: 80 }).notNull(),
  customerUserId: varchar("customer_user_id", { length: 255 }),
  productId: varchar("product_id", { length: 255 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  orderId: varchar("order_id", { length: 255 }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FlashCampaign = typeof flashCampaignsTable.$inferSelect;
export type FlashCampaignItem = typeof flashCampaignItemsTable.$inferSelect;
export type FlashVisit = typeof flashVisitsTable.$inferSelect;
export type FlashReservation = typeof flashReservationsTable.$inferSelect;
