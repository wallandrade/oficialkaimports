import { mysqlTable, varchar, text, mediumtext, decimal, int, timestamp } from "drizzle-orm/mysql-core";

export const rafflesTable = mysqlTable("raffles", {
  id: varchar("id", { length: 255 }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  imageUrl: mediumtext("image_url"),
  totalNumbers: int("total_numbers").notNull(),
  pricePerNumber: decimal("price_per_number", { precision: 10, scale: 2 }).notNull(),
  reservationHours: int("reservation_hours").notNull().default(24),
  status: varchar("status", { length: 32 }).notNull().default("active"), // active | closed | drawn
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const raffleReservationsTable = mysqlTable("raffle_reservations", {
  id: varchar("id", { length: 255 }).primaryKey(),
  raffleId: varchar("raffle_id", { length: 255 }).notNull(),
  numbers: text("numbers").notNull(), // JSON array of ints e.g. "[3,7,42]"
  clientName: varchar("client_name", { length: 255 }).notNull(),
  clientEmail: varchar("client_email", { length: 255 }).notNull(),
  clientPhone: varchar("client_phone", { length: 255 }).notNull(),
  clientDocument: varchar("client_document", { length: 32 }),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("reserved"), // reserved | paid | expired
  transactionId: varchar("transaction_id", { length: 255 }),
  pixCode: mediumtext("pix_code"),
  pixBase64: mediumtext("pix_base64"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const raffleResultsTable = mysqlTable("raffle_results", {
  id: varchar("id", { length: 255 }).primaryKey(),
  raffleId: varchar("raffle_id", { length: 255 }).notNull(),
  winnerNumber: int("winner_number").notNull(),
  winnerReservationId: varchar("winner_reservation_id", { length: 255 }),
  winnerClientName: varchar("winner_client_name", { length: 255 }),
  winnerClientPhone: varchar("winner_client_phone", { length: 255 }),
  drawMethod: varchar("draw_method", { length: 64 }).notNull().default("manual"),
  notes: text("notes"),
  drawnAt: timestamp("drawn_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const rafflePromotionsTable = mysqlTable("raffle_promotions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  raffleId: varchar("raffle_id", { length: 255 }).notNull(),
  quantity: int("quantity").notNull(),
  promoPrice: decimal("promo_price", { precision: 10, scale: 2 }).notNull(),
  isActive: int("is_active").notNull().default(1),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
