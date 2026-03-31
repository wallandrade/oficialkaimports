import { mysqlTable, int, varchar, boolean, timestamp } from "drizzle-orm/mysql-core";

export const socialProofSettingsTable = mysqlTable("social_proof_settings", {
  id: int("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(false),
  showRealSales: boolean("show_real_sales").notNull().default(true),
  showFakeCards: boolean("show_fake_cards").notNull().default(false),
  fakeAllProducts: boolean("fake_all_products").notNull().default(true),
  fakeProductIds: varchar("fake_product_ids", { length: 1000 }).notNull().default("[]"),
  delaySeconds: int("delay_seconds").notNull().default(8),
  displaySeconds: int("display_seconds").notNull().default(5),
  cardBgColor: varchar("card_bg_color", { length: 50 }).notNull().default("#ffffff"),
  cardTextColor: varchar("card_text_color", { length: 50 }).notNull().default("#1a1a1a"),
  badgeColor: varchar("badge_color", { length: 50 }).notNull().default("#22c55e"),
  autoGenerate: boolean("auto_generate").notNull().default(false),
  autoGenerateCount: int("auto_generate_count").notNull().default(40),
  realWindowHours: int("real_window_hours").notNull().default(2),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const socialProofFakeEntriesTable = mysqlTable("social_proof_fake_entries", {
  id: int("id").primaryKey().autoincrement(),
  firstName: varchar("first_name", { length: 255 }).notNull(),
  city: varchar("city", { length: 255 }).notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  productName: varchar("product_name", { length: 255 }).notNull(),
  isAuto: boolean("is_auto").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
