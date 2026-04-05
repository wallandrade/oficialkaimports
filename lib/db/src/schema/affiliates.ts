import { mysqlTable, varchar, decimal, timestamp, int, boolean } from "drizzle-orm/mysql-core";

export const affiliatesTable = mysqlTable("affiliates", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().unique(),
  affiliateCode: varchar("affiliate_code", { length: 32 }).notNull().unique(),
  facebookPixelId: varchar("facebook_pixel_id", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const affiliateReferralsTable = mysqlTable("affiliate_referrals", {
  id: varchar("id", { length: 255 }).primaryKey(),
  affiliateUserId: varchar("affiliate_user_id", { length: 255 }).notNull(),
  referredUserId: varchar("referred_user_id", { length: 255 }),
  referredEmail: varchar("referred_email", { length: 255 }),
  convertedOrders: int("converted_orders").notNull().default(0),
  hasConverted: boolean("has_converted").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const affiliateCommissionsTable = mysqlTable("affiliate_commissions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  affiliateUserId: varchar("affiliate_user_id", { length: 255 }).notNull(),
  orderId: varchar("order_id", { length: 255 }).notNull().unique(),
  referredUserId: varchar("referred_user_id", { length: 255 }),
  referredEmail: varchar("referred_email", { length: 255 }),
  rate: decimal("rate", { precision: 5, scale: 4 }).notNull(),
  baseAmount: decimal("base_amount", { precision: 10, scale: 2 }).notNull(),
  commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
