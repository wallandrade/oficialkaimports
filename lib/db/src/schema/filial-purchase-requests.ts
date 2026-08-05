import { mysqlTable, varchar, decimal, timestamp, json } from "drizzle-orm/mysql-core";

export const filialPurchaseRequestsTable = mysqlTable("filial_purchase_requests", {
  id: varchar("id", { length: 255 }).primaryKey(),
  filialTenantId: varchar("filial_tenant_id", { length: 255 }).notNull(),
  orderId: varchar("order_id", { length: 255 }).notNull(),
  status: varchar("status", { length: 64 }).notNull().default("aguardando_compra_loja1"),
  supplierBatchId: varchar("supplier_batch_id", { length: 255 }),
  supplierBatchLabel: varchar("supplier_batch_label", { length: 255 }),
  supplierBatchSentAt: timestamp("supplier_batch_sent_at"),
  supplierBatchReceivedAt: timestamp("supplier_batch_received_at"),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  orderTotal: decimal("order_total", { precision: 10, scale: 2 }).notNull().default("0.00"),
  repasseTotal: decimal("repasse_total", { precision: 10, scale: 2 }).notNull().default("0.00"),
  itemsSnapshot: json("items_snapshot").notNull(),
  costsSnapshot: json("costs_snapshot"),
  loja1RealCostTotal: decimal("loja1_real_cost_total", { precision: 10, scale: 2 }),
  loja1RealProfit: decimal("loja1_real_profit", { precision: 10, scale: 2 }),
  purchaseRecordedAt: timestamp("purchase_recorded_at"),
  stockLaunchedAt: timestamp("stock_launched_at"),
  finalizedAt: timestamp("finalized_at"),
  createdByAdmin: varchar("created_by_admin", { length: 255 }),
  updatedByAdmin: varchar("updated_by_admin", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const filialPurchaseRequestAuditsTable = mysqlTable("filial_purchase_request_audits", {
  id: varchar("id", { length: 255 }).primaryKey(),
  requestId: varchar("request_id", { length: 255 }).notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  actorUsername: varchar("actor_username", { length: 255 }),
  payload: json("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
