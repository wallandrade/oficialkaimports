import { mysqlTable, varchar, text, boolean, timestamp, datetime } from "drizzle-orm/mysql-core";

export const kycDocumentsTable = mysqlTable("kyc_documents", {
  id: varchar("id", { length: 255 }).primaryKey(),
  orderId: varchar("order_id", { length: 255 }).notNull().unique(),
  clientDocument: varchar("client_document", { length: 255 }),
  clientName: varchar("client_name", { length: 255 }),
  clientPhone: varchar("client_phone", { length: 255 }),
  selfieUrl: text("selfie_url"),
  rgFrontUrl: text("rg_front_url"),
  declarationSignature: text("declaration_signature"),
  declarationSignedAt: datetime("declaration_signed_at", { mode: 'date' }),
  declarationProduct: varchar("declaration_product", { length: 255 }),
  declarationCompanyName: varchar("declaration_company_name", { length: 255 }),
  declarationCompanyCnpj: varchar("declaration_company_cnpj", { length: 255 }),
  declarationPurchaseValue: varchar("declaration_purchase_value", { length: 255 }),
  declarationDate: varchar("declaration_date", { length: 255 }),
  adminEdited: boolean("admin_edited").default(false),
  adminEditedAt: datetime("admin_edited_at", { mode: 'date' }),
  status: varchar("status", { length: 50 }).default("pending"),
  submittedAt: datetime("submitted_at", { mode: 'date' }),
  approvedAt: datetime("approved_at", { mode: 'date' }),
  approvedByUsername: varchar("approved_by_username", { length: 255 }),
  rejectedAt: datetime("rejected_at", { mode: 'date' }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type KycDocument = typeof kycDocumentsTable.$inferSelect;
