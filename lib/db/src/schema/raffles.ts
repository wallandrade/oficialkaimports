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
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("reserved"), // reserved | paid | expired
  transactionId: varchar("transaction_id", { length: 255 }),
  pixCode: mediumtext("pix_code"),
  pixBase64: mediumtext("pix_base64"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
