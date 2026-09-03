import crypto from "crypto";
import { pool } from "@workspace/db";
import { DEFAULT_MOTOBOY_NEIGHBORHOODS } from "./lib/default-motoboy-neighborhoods";
import { isYuryMotoboySyncConfigured } from "./lib/motoboy-yury-config";

const DEFAULT_TENANT_ID = "tenant_loja1";
const DEFAULT_TENANT_SLUG = "loja-1";
const DEFAULT_TENANT_NAME = "Loja 1";

function getDatabaseName(): string {
  const databaseUrl = process.env.DATABASE_URL || "";
  const parsed = new URL(databaseUrl);
  return parsed.pathname.replace(/^\//, "");
}

async function tableExists(tableName: string, databaseName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `
      SELECT 1
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      LIMIT 1
    `,
    [databaseName, tableName],
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function columnExists(tableName: string, columnName: string, databaseName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [databaseName, tableName, columnName],
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function indexExists(tableName: string, indexName: string, databaseName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `
      SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1
    `,
    [databaseName, tableName, indexName],
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function ensureTenantsTables(databaseName: string): Promise<void> {
  if (!(await tableExists("tenants", databaseName))) {
    await pool.query(`
      CREATE TABLE tenants (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        slug VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        domain VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY tenants_slug_unique (slug)
      )
    `);
  }

  if (!(await tableExists("admin_user_tenants", databaseName))) {
    await pool.query(`
      CREATE TABLE admin_user_tenants (
        admin_user_id VARCHAR(255) NOT NULL,
        tenant_id VARCHAR(255) NOT NULL,
        role VARCHAR(64) NOT NULL DEFAULT 'owner',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (admin_user_id, tenant_id),
        KEY admin_user_tenants_tenant_id_idx (tenant_id)
      )
    `);
  }
}

async function ensureTenantColumns(databaseName: string): Promise<void> {
  const definitions = [
    { table: "orders", index: "orders_tenant_id_idx", sql: "ALTER TABLE orders ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "custom_charges", index: "custom_charges_tenant_id_idx", sql: "ALTER TABLE custom_charges ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "products", index: "products_tenant_id_idx", sql: "ALTER TABLE products ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "site_settings", index: "site_settings_tenant_id_idx", sql: "ALTER TABLE site_settings ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "sellers", index: "sellers_tenant_id_idx", sql: "ALTER TABLE sellers ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "coupons", index: "coupons_tenant_id_idx", sql: "ALTER TABLE coupons ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "seller_commission_payments", index: "seller_commission_payments_tenant_id_idx", sql: "ALTER TABLE seller_commission_payments ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "customer_users", index: "customer_users_tenant_id_idx", sql: "ALTER TABLE customer_users ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "marketing_expenses", index: "marketing_expenses_tenant_id_idx", sql: "ALTER TABLE marketing_expenses ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "shipping_options", index: "shipping_options_tenant_id_idx", sql: "ALTER TABLE shipping_options ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "order_bumps", index: "order_bumps_tenant_id_idx", sql: "ALTER TABLE order_bumps ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "affiliates", index: "affiliates_tenant_id_idx", sql: "ALTER TABLE affiliates ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "affiliate_referrals", index: "affiliate_referrals_tenant_id_idx", sql: "ALTER TABLE affiliate_referrals ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "affiliate_commissions", index: "affiliate_commissions_tenant_id_idx", sql: "ALTER TABLE affiliate_commissions ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "affiliate_credit_uses", index: "affiliate_credit_uses_tenant_id_idx", sql: "ALTER TABLE affiliate_credit_uses ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "support_tickets", index: "support_tickets_tenant_id_idx", sql: "ALTER TABLE support_tickets ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "inventory_balances", index: "inventory_balances_tenant_id_idx", sql: "ALTER TABLE inventory_balances ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "inventory_movements", index: "inventory_movements_tenant_id_idx", sql: "ALTER TABLE inventory_movements ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "reshipments", index: "reshipments_tenant_id_idx", sql: "ALTER TABLE reshipments ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "manual_reshipments", index: "manual_reshipments_tenant_id_idx", sql: "ALTER TABLE manual_reshipments ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "raffles", index: "raffles_tenant_id_idx", sql: "ALTER TABLE raffles ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "raffle_reservations", index: "raffle_reservations_tenant_id_idx", sql: "ALTER TABLE raffle_reservations ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "raffle_results", index: "raffle_results_tenant_id_idx", sql: "ALTER TABLE raffle_results ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "raffle_promotions", index: "raffle_promotions_tenant_id_idx", sql: "ALTER TABLE raffle_promotions ADD COLUMN tenant_id VARCHAR(255) NULL" },
    { table: "kyc_documents", index: "kyc_documents_tenant_id_idx", sql: "ALTER TABLE kyc_documents ADD COLUMN tenant_id VARCHAR(255) NULL" },
  ];

  for (const definition of definitions) {
    if (!(await tableExists(definition.table, databaseName))) continue;

    if (!(await columnExists(definition.table, "tenant_id", databaseName))) {
      await pool.query(definition.sql);
    }

    if (!(await indexExists(definition.table, definition.index, databaseName))) {
      try {
        await pool.query(`ALTER TABLE ${definition.table} ADD KEY ${definition.index} (tenant_id)`);
      } catch {
        // Ignore duplicate or unsupported index creation issues.
      }
    }
  }
}

async function ensureTenantSettingsTable(databaseName: string): Promise<void> {
  if (!(await tableExists("tenant_settings", databaseName))) {
    await pool.query(`
      CREATE TABLE tenant_settings (
        tenant_id VARCHAR(255) NOT NULL,
        \`key\` VARCHAR(255) NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, \`key\`),
        KEY tenant_settings_key_idx (\`key\`)
      )
    `);
  }
}

async function ensureAdminSessionsTenantColumn(databaseName: string): Promise<void> {
  if (!(await tableExists("admin_sessions", databaseName))) return;

  if (!(await columnExists("admin_sessions", "tenant_id", databaseName))) {
    await pool.query("ALTER TABLE admin_sessions ADD COLUMN tenant_id VARCHAR(255) NULL AFTER username");
  }

  if (!(await indexExists("admin_sessions", "admin_sessions_tenant_id_idx", databaseName))) {
    try {
      await pool.query("ALTER TABLE admin_sessions ADD KEY admin_sessions_tenant_id_idx (tenant_id)");
    } catch {
      // Ignore duplicate or unsupported index creation issues.
    }
  }
}

async function seedDefaultTenantAndBackfill(databaseName: string): Promise<void> {
  if (!(await tableExists("tenants", databaseName))) return;

  await pool.query(
    `
      INSERT INTO tenants (id, slug, name, status)
      SELECT ?, ?, ?, 'active'
      FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = ?)
    `,
    [DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG, DEFAULT_TENANT_NAME, DEFAULT_TENANT_ID],
  );

  const tables = [
    "orders",
    "custom_charges",
    "products",
    "site_settings",
    "sellers",
    "coupons",
    "seller_commission_payments",
    "customer_users",
    "marketing_expenses",
    "shipping_options",
    "order_bumps",
    "affiliates",
    "affiliate_referrals",
    "affiliate_commissions",
    "affiliate_credit_uses",
    "support_tickets",
    "inventory_balances",
    "inventory_movements",
    "reshipments",
    "manual_reshipments",
    "raffles",
    "raffle_reservations",
    "raffle_results",
    "raffle_promotions",
    "kyc_documents",
  ];

  for (const tableName of tables) {
    if (!(await tableExists(tableName, databaseName)) || !(await columnExists(tableName, "tenant_id", databaseName))) continue;
    await pool.query(`UPDATE ${tableName} SET tenant_id = ? WHERE tenant_id IS NULL OR tenant_id = ''`, [DEFAULT_TENANT_ID]);
  }

  if (await tableExists("admin_users", databaseName) && await tableExists("admin_user_tenants", databaseName)) {
    await pool.query(
      `
        INSERT INTO admin_user_tenants (admin_user_id, tenant_id, role)
        SELECT au.id, ?, CASE WHEN au.is_primary = 1 THEN 'platform_admin' ELSE 'owner' END
        FROM admin_users au
        WHERE NOT EXISTS (
          SELECT 1
          FROM admin_user_tenants aut
          WHERE aut.admin_user_id = au.id AND aut.tenant_id = ?
        )
      `,
      [DEFAULT_TENANT_ID, DEFAULT_TENANT_ID],
    );
  }

  if (await tableExists("site_settings", databaseName) && await tableExists("tenant_settings", databaseName)) {
    await pool.query(
      `
        INSERT INTO tenant_settings (tenant_id, \`key\`, value, updated_at)
        SELECT ?, ss.key, ss.value, ss.updated_at
        FROM site_settings ss
        WHERE NOT EXISTS (
          SELECT 1
          FROM tenant_settings ts
          WHERE ts.tenant_id = ? AND ts.\`key\` = ss.key
        )
      `,
      [DEFAULT_TENANT_ID, DEFAULT_TENANT_ID],
    );
  }
}

async function ensureOrdersColumns(databaseName: string): Promise<void> {
  const definitions = [
    { name: "user_id", sql: "ALTER TABLE orders ADD COLUMN user_id VARCHAR(255) NULL" },
    { name: "guest_access_token", sql: "ALTER TABLE orders ADD COLUMN guest_access_token VARCHAR(255) NULL" },
    { name: "affiliate_user_id", sql: "ALTER TABLE orders ADD COLUMN affiliate_user_id VARCHAR(255) NULL" },
    { name: "affiliate_code", sql: "ALTER TABLE orders ADD COLUMN affiliate_code VARCHAR(32) NULL" },
    { name: "purchase_ip", sql: "ALTER TABLE orders ADD COLUMN purchase_ip VARCHAR(64) NULL" },
    { name: "affiliate_credit_used", sql: "ALTER TABLE orders ADD COLUMN affiliate_credit_used DECIMAL(10,2) NULL" },
    {
      name: "seller_commission_rate_snapshot",
      sql: "ALTER TABLE orders ADD COLUMN seller_commission_rate_snapshot DECIMAL(5,2) NULL",
    },
    {
      name: "seller_commission_batch_id",
      sql: "ALTER TABLE orders ADD COLUMN seller_commission_batch_id VARCHAR(255) NULL",
    },
    {
      name: "seller_commission_paid_at",
      sql: "ALTER TABLE orders ADD COLUMN seller_commission_paid_at TIMESTAMP NULL",
    },
    {
      name: "whatsapp_group",
      sql: "ALTER TABLE orders ADD COLUMN whatsapp_group VARCHAR(64) NULL",
    },
    // Novo campo para status de envio
    {
      name: "enviado",
      sql: "ALTER TABLE orders ADD COLUMN enviado TINYINT(1) NOT NULL DEFAULT 0",
    },
    {
      name: "is_prioridade",
      sql: "ALTER TABLE orders ADD COLUMN is_prioridade TINYINT(1) NOT NULL DEFAULT 0",
    },
    {
      name: "is_procurando_produto",
      sql: "ALTER TABLE orders ADD COLUMN is_procurando_produto TINYINT(1) NOT NULL DEFAULT 0",
    },
    // Campos de geolocalização do IP
    { name: "ip_city",     sql: "ALTER TABLE orders ADD COLUMN ip_city VARCHAR(100) NULL" },
    { name: "ip_region",   sql: "ALTER TABLE orders ADD COLUMN ip_region VARCHAR(100) NULL" },
    { name: "ip_isp",      sql: "ALTER TABLE orders ADD COLUMN ip_isp VARCHAR(255) NULL" },
    { name: "ip_is_proxy", sql: "ALTER TABLE orders ADD COLUMN ip_is_proxy TINYINT(1) NULL" },
    // Campos de rastreio por etiqueta
    { name: "tracking_code", sql: "ALTER TABLE orders ADD COLUMN tracking_code VARCHAR(255) NULL" },
    { name: "tracking_label_url", sql: "ALTER TABLE orders ADD COLUMN tracking_label_url MEDIUMTEXT NULL" },
    { name: "tracking_label_text", sql: "ALTER TABLE orders ADD COLUMN tracking_label_text MEDIUMTEXT NULL" },
    { name: "tracking_detected_name", sql: "ALTER TABLE orders ADD COLUMN tracking_detected_name VARCHAR(255) NULL" },
    { name: "tracking_detected_address", sql: "ALTER TABLE orders ADD COLUMN tracking_detected_address TEXT NULL" },
    { name: "motoboy_delivery_date", sql: "ALTER TABLE orders ADD COLUMN motoboy_delivery_date DATE NULL" },
    { name: "motoboy_delivery_time", sql: "ALTER TABLE orders ADD COLUMN motoboy_delivery_time VARCHAR(5) NULL" },
    { name: "motoboy_delivery_duration_hours", sql: "ALTER TABLE orders ADD COLUMN motoboy_delivery_duration_hours INT NULL" },
    { name: "envioecom_shipment_id", sql: "ALTER TABLE orders ADD COLUMN envioecom_shipment_id INT NULL" },
    { name: "envioecom_barcode", sql: "ALTER TABLE orders ADD COLUMN envioecom_barcode VARCHAR(255) NULL" },
    { name: "envioecom_tracking_key", sql: "ALTER TABLE orders ADD COLUMN envioecom_tracking_key VARCHAR(255) NULL" },
    { name: "envioecom_delivery_mode", sql: "ALTER TABLE orders ADD COLUMN envioecom_delivery_mode VARCHAR(255) NULL" },
    { name: "envioecom_status", sql: "ALTER TABLE orders ADD COLUMN envioecom_status VARCHAR(255) NULL" },
    { name: "envioecom_status_updated_at", sql: "ALTER TABLE orders ADD COLUMN envioecom_status_updated_at TIMESTAMP NULL" },
    { name: "envioecom_status_history", sql: "ALTER TABLE orders ADD COLUMN envioecom_status_history JSON NULL" },
    { name: "envioecom_label_url", sql: "ALTER TABLE orders ADD COLUMN envioecom_label_url MEDIUMTEXT NULL" },
    { name: "envioecom_freight_cost", sql: "ALTER TABLE orders ADD COLUMN envioecom_freight_cost DECIMAL(10,2) NULL" },
    { name: "envioecom_external_order_number", sql: "ALTER TABLE orders ADD COLUMN envioecom_external_order_number VARCHAR(255) NULL" },
    { name: "envioecom_account_id", sql: "ALTER TABLE orders ADD COLUMN envioecom_account_id VARCHAR(64) NULL" },
    { name: "bank_deposit_match_status", sql: "ALTER TABLE orders ADD COLUMN bank_deposit_match_status VARCHAR(32) NULL" },
    { name: "bank_deposit_fitid", sql: "ALTER TABLE orders ADD COLUMN bank_deposit_fitid VARCHAR(64) NULL" },
    { name: "bank_deposit_amount", sql: "ALTER TABLE orders ADD COLUMN bank_deposit_amount DECIMAL(10,2) NULL" },
    { name: "bank_deposit_payer_name", sql: "ALTER TABLE orders ADD COLUMN bank_deposit_payer_name VARCHAR(255) NULL" },
    { name: "bank_deposit_posted_at", sql: "ALTER TABLE orders ADD COLUMN bank_deposit_posted_at VARCHAR(10) NULL" },
    { name: "bank_deposit_matched_at", sql: "ALTER TABLE orders ADD COLUMN bank_deposit_matched_at TIMESTAMP NULL" },
    { name: "inventory_exit_pool", sql: "ALTER TABLE orders ADD COLUMN inventory_exit_pool VARCHAR(16) NULL" },
    { name: "inventory_exited_pools", sql: "ALTER TABLE orders ADD COLUMN inventory_exited_pools VARCHAR(64) NULL" },
    { name: "insurance_plan", sql: "ALTER TABLE orders ADD COLUMN insurance_plan VARCHAR(16) NULL" },
    { name: "insurance_keep_amount", sql: "ALTER TABLE orders ADD COLUMN insurance_keep_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00" },
    { name: "insurance_cashback_amount", sql: "ALTER TABLE orders ADD COLUMN insurance_cashback_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00" },
    { name: "insurance_claim_status", sql: "ALTER TABLE orders ADD COLUMN insurance_claim_status VARCHAR(32) NOT NULL DEFAULT 'none'" },
    { name: "insurance_reship_count", sql: "ALTER TABLE orders ADD COLUMN insurance_reship_count INT NOT NULL DEFAULT 0" },
    { name: "insurance_cashback_granted", sql: "ALTER TABLE orders ADD COLUMN insurance_cashback_granted TINYINT(1) NOT NULL DEFAULT 0" },
    { name: "parent_order_id", sql: "ALTER TABLE orders ADD COLUMN parent_order_id VARCHAR(255) NULL" },
    { name: "store_credit_used", sql: "ALTER TABLE orders ADD COLUMN store_credit_used DECIMAL(10,2) NULL" },
    { name: "observation_visible_to_customer", sql: "ALTER TABLE orders ADD COLUMN observation_visible_to_customer TINYINT(1) NOT NULL DEFAULT 0" },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("orders", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }

  if (!(await indexExists("orders", "orders_guest_access_token_unique", databaseName))) {
    try {
      await pool.query("ALTER TABLE orders ADD UNIQUE KEY orders_guest_access_token_unique (guest_access_token)");
    } catch {
      // Ignore duplicate or unsupported index creation issues.
    }
  }

  const envioecomIndexes = [
    { name: "orders_envioecom_barcode_idx", sql: "ALTER TABLE orders ADD INDEX orders_envioecom_barcode_idx (envioecom_barcode)" },
    { name: "orders_envioecom_shipment_id_idx", sql: "ALTER TABLE orders ADD INDEX orders_envioecom_shipment_id_idx (envioecom_shipment_id)" },
    { name: "orders_envioecom_external_order_idx", sql: "ALTER TABLE orders ADD INDEX orders_envioecom_external_order_idx (envioecom_external_order_number)" },
    { name: "orders_bank_deposit_fitid_idx", sql: "ALTER TABLE orders ADD INDEX orders_bank_deposit_fitid_idx (bank_deposit_fitid)" },
  ];
  for (const index of envioecomIndexes) {
    if (!(await indexExists("orders", index.name, databaseName))) {
      try {
        await pool.query(index.sql);
      } catch {
        // Ignore duplicate or unsupported index creation issues.
      }
    }
  }
}

async function ensureProductsColumns(databaseName: string): Promise<void> {
  if (!(await tableExists("products", databaseName))) return;

  const definitions = [
    {
      name: "brand",
      sql: "ALTER TABLE products ADD COLUMN brand VARCHAR(255) NULL",
    },
    {
      name: "cost_price",
      sql: "ALTER TABLE products ADD COLUMN cost_price DECIMAL(10,2) NOT NULL DEFAULT 0.00",
    },
    {
      name: "is_sold_out",
      sql: "ALTER TABLE products ADD COLUMN is_sold_out TINYINT(1) NOT NULL DEFAULT 0",
    },
    {
      name: "is_launch",
      sql: "ALTER TABLE products ADD COLUMN is_launch TINYINT(1) NOT NULL DEFAULT 0",
    },
    {
      name: "bulk_discount_enabled",
      sql: "ALTER TABLE products ADD COLUMN bulk_discount_enabled TINYINT(1) NOT NULL DEFAULT 0",
    },
    {
      name: "bulk_discount_tiers",
      sql: "ALTER TABLE products ADD COLUMN bulk_discount_tiers MEDIUMTEXT NULL",
    },
    {
      name: "variant_groups",
      sql: "ALTER TABLE products ADD COLUMN variant_groups MEDIUMTEXT NULL",
    },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("products", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }
}

async function ensureSellersColumns(databaseName: string): Promise<void> {
  if (!(await tableExists("sellers", databaseName))) return;

  const definitions = [
    {
      name: "has_commission",
      sql: "ALTER TABLE sellers ADD COLUMN has_commission TINYINT(1) NOT NULL DEFAULT 1",
    },
    {
      name: "commission_rate",
      sql: "ALTER TABLE sellers ADD COLUMN commission_rate DECIMAL(5,2) NOT NULL DEFAULT 5.00",
    },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("sellers", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }
}

async function ensureCouponsColumns(databaseName: string): Promise<void> {
  if (!(await tableExists("coupons", databaseName))) return;

  const definitions = [
    {
      name: "eligible_product_ids",
      sql: "ALTER TABLE coupons ADD COLUMN eligible_product_ids JSON NULL",
    },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("coupons", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }
}

async function ensureOrderBumpsColumns(databaseName: string): Promise<void> {
  const definitions = [
    { name: "offer_product_id", sql: "ALTER TABLE order_bumps ADD COLUMN offer_product_id VARCHAR(255) NULL" },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("order_bumps", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }
}

async function ensureCustomerUsersTable(databaseName: string): Promise<void> {
  if (await tableExists("customer_users", databaseName)) {
    return;
  }

  await pool.query(`
    CREATE TABLE customer_users (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      salt VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY customer_users_email_unique (email)
    )
  `);
}

async function ensureAffiliatesTables(databaseName: string): Promise<void> {
  if (!(await tableExists("affiliates", databaseName))) {
    await pool.query(`
      CREATE TABLE affiliates (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        affiliate_code VARCHAR(32) NOT NULL,
        facebook_pixel_id VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY affiliates_user_id_unique (user_id),
        UNIQUE KEY affiliates_affiliate_code_unique (affiliate_code)
      )
    `);
  }

  if (!(await tableExists("affiliate_referrals", databaseName))) {
    await pool.query(`
      CREATE TABLE affiliate_referrals (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        affiliate_user_id VARCHAR(255) NOT NULL,
        referred_user_id VARCHAR(255) NULL,
        referred_email VARCHAR(255) NULL,
        converted_orders INT NOT NULL DEFAULT 0,
        has_converted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  if (!(await tableExists("affiliate_commissions", databaseName))) {
    await pool.query(`
      CREATE TABLE affiliate_commissions (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        affiliate_user_id VARCHAR(255) NOT NULL,
        order_id VARCHAR(255) NOT NULL,
        referred_user_id VARCHAR(255) NULL,
        referred_email VARCHAR(255) NULL,
        rate DECIMAL(5,4) NOT NULL,
        base_amount DECIMAL(10,2) NOT NULL,
        commission_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY affiliate_commissions_order_id_unique (order_id)
      )
    `);
  }

  if (!(await tableExists("affiliate_credit_uses", databaseName))) {
    await pool.query(`
      CREATE TABLE affiliate_credit_uses (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        affiliate_user_id VARCHAR(255) NOT NULL,
        order_id VARCHAR(255) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY affiliate_credit_uses_order_id_unique (order_id)
      )
    `);
  }
}

async function ensureSellerCommissionPaymentsTable(databaseName: string): Promise<void> {
  const exists = await tableExists("seller_commission_payments", databaseName);
  if (!exists) {
    await pool.query(`
      CREATE TABLE seller_commission_payments (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        seller_code VARCHAR(255) NOT NULL,
        order_ids JSON NOT NULL,
        period_start_date VARCHAR(10) NULL,
        period_end_date VARCHAR(10) NULL,
        period_start TIMESTAMP NULL,
        period_end TIMESTAMP NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        order_count INT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        payment_method VARCHAR(64) NULL,
        paid_at TIMESTAMP NULL,
        notes TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY seller_commission_payments_seller_code_idx (seller_code),
        KEY seller_commission_payments_status_idx (status),
        KEY seller_commission_payments_created_at_idx (created_at)
      )
    `);
    return;
  }

  const definitions = [
    { name: "period_start_date", sql: "ALTER TABLE seller_commission_payments ADD COLUMN period_start_date VARCHAR(10) NULL" },
    { name: "period_end_date", sql: "ALTER TABLE seller_commission_payments ADD COLUMN period_end_date VARCHAR(10) NULL" },
    { name: "period_start", sql: "ALTER TABLE seller_commission_payments ADD COLUMN period_start TIMESTAMP NULL" },
    { name: "period_end", sql: "ALTER TABLE seller_commission_payments ADD COLUMN period_end TIMESTAMP NULL" },
    { name: "payment_method", sql: "ALTER TABLE seller_commission_payments ADD COLUMN payment_method VARCHAR(64) NULL" },
    { name: "paid_at", sql: "ALTER TABLE seller_commission_payments ADD COLUMN paid_at TIMESTAMP NULL" },
    { name: "notes", sql: "ALTER TABLE seller_commission_payments ADD COLUMN notes TEXT NULL" },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("seller_commission_payments", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }

  const indexDefinitions = [
    { name: "seller_commission_payments_seller_code_idx", sql: "ALTER TABLE seller_commission_payments ADD KEY seller_commission_payments_seller_code_idx (seller_code)" },
    { name: "seller_commission_payments_status_idx", sql: "ALTER TABLE seller_commission_payments ADD KEY seller_commission_payments_status_idx (status)" },
    { name: "seller_commission_payments_created_at_idx", sql: "ALTER TABLE seller_commission_payments ADD KEY seller_commission_payments_created_at_idx (created_at)" },
  ];

  for (const indexDefinition of indexDefinitions) {
    if (!(await indexExists("seller_commission_payments", indexDefinition.name, databaseName))) {
      try {
        await pool.query(indexDefinition.sql);
      } catch {
        // Ignore duplicate or unsupported index creation issues.
      }
    }
  }
}

async function ensureRaffleTables(databaseName: string): Promise<void> {
  if (!(await tableExists("raffles", databaseName))) {
    await pool.query(`
      CREATE TABLE raffles (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NULL,
        image_url MEDIUMTEXT NULL,
        total_numbers INT NOT NULL,
        price_per_number DECIMAL(10,2) NOT NULL,
        reservation_hours INT NOT NULL DEFAULT 24,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  if (!(await tableExists("raffle_reservations", databaseName))) {
    await pool.query(`
      CREATE TABLE raffle_reservations (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        raffle_id VARCHAR(255) NOT NULL,
        numbers TEXT NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255) NOT NULL,
        client_phone VARCHAR(255) NOT NULL,
        client_document VARCHAR(32) NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'reserved',
        transaction_id VARCHAR(255) NULL,
        pix_code MEDIUMTEXT NULL,
        pix_base64 MEDIUMTEXT NULL,
        pix_expires_at TIMESTAMP NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY raffle_reservations_raffle_id_idx (raffle_id),
        KEY raffle_reservations_client_phone_idx (client_phone),
        KEY raffle_reservations_client_document_idx (client_document),
        KEY raffle_reservations_status_idx (status),
        KEY raffle_reservations_transaction_id_idx (transaction_id)
      )
    `);
  }

  if (!(await columnExists("raffle_reservations", "client_document", databaseName))) {
    await pool.query("ALTER TABLE raffle_reservations ADD COLUMN client_document VARCHAR(32) NULL AFTER client_phone");
  }

  if (!(await indexExists("raffle_reservations", "raffle_reservations_client_document_idx", databaseName))) {
    await pool.query("ALTER TABLE raffle_reservations ADD KEY raffle_reservations_client_document_idx (client_document)");
  }

  if (!(await columnExists("raffle_reservations", "pix_expires_at", databaseName))) {
    await pool.query("ALTER TABLE raffle_reservations ADD COLUMN pix_expires_at TIMESTAMP NULL AFTER pix_base64");
  }

  if (!(await tableExists("raffle_results", databaseName))) {
    await pool.query(`
      CREATE TABLE raffle_results (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        raffle_id VARCHAR(255) NOT NULL,
        winner_number INT NOT NULL,
        winner_reservation_id VARCHAR(255) NULL,
        winner_client_name VARCHAR(255) NULL,
        winner_client_phone VARCHAR(255) NULL,
        draw_method VARCHAR(64) NOT NULL DEFAULT 'manual',
        notes TEXT NULL,
        drawn_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY raffle_results_raffle_id_unique (raffle_id),
        KEY raffle_results_winner_reservation_id_idx (winner_reservation_id)
      )
    `);
  }

  if (!(await tableExists("raffle_promotions", databaseName))) {
    await pool.query(`
      CREATE TABLE raffle_promotions (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        raffle_id VARCHAR(255) NOT NULL,
        quantity INT NOT NULL,
        promo_price DECIMAL(10,2) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY raffle_promotions_raffle_id_idx (raffle_id),
        KEY raffle_promotions_active_idx (is_active)
      )
    `);
  }
}

async function ensureSupportTicketsTable(databaseName: string): Promise<void> {
  if (!(await tableExists("support_tickets", databaseName))) {
    await pool.query(`
      CREATE TABLE support_tickets (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL,
        client_document VARCHAR(32) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        tracking_code VARCHAR(255) NULL,
        description TEXT NOT NULL,
        image_url MEDIUMTEXT NULL,
        address_change_json MEDIUMTEXT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        resolution_reason VARCHAR(64) NULL,
        order_total DECIMAL(10,2) NULL,
        order_created_at TIMESTAMP NULL,
        resolved_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY support_tickets_order_id_idx (order_id),
        KEY support_tickets_client_document_idx (client_document),
        KEY support_tickets_status_idx (status),
        KEY support_tickets_created_at_idx (created_at)
      )
    `);
    return;
  }

  const definitions = [
    { name: "tracking_code", sql: "ALTER TABLE support_tickets ADD COLUMN tracking_code VARCHAR(255) NULL" },
    { name: "order_total", sql: "ALTER TABLE support_tickets ADD COLUMN order_total DECIMAL(10,2) NULL" },
    { name: "order_created_at", sql: "ALTER TABLE support_tickets ADD COLUMN order_created_at TIMESTAMP NULL" },
    { name: "resolved_at", sql: "ALTER TABLE support_tickets ADD COLUMN resolved_at TIMESTAMP NULL" },
    { name: "resolution_reason", sql: "ALTER TABLE support_tickets ADD COLUMN resolution_reason VARCHAR(64) NULL" },
    { name: "address_change_json", sql: "ALTER TABLE support_tickets ADD COLUMN address_change_json MEDIUMTEXT NULL" },
    { name: "problem_type", sql: "ALTER TABLE support_tickets ADD COLUMN problem_type VARCHAR(32) NULL" },
    { name: "insurance_choice", sql: "ALTER TABLE support_tickets ADD COLUMN insurance_choice VARCHAR(32) NULL" },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("support_tickets", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }

  const indexes = [
    { name: "support_tickets_order_id_idx", sql: "ALTER TABLE support_tickets ADD KEY support_tickets_order_id_idx (order_id)" },
    {
      name: "support_tickets_client_document_idx",
      sql: "ALTER TABLE support_tickets ADD KEY support_tickets_client_document_idx (client_document)",
    },
    { name: "support_tickets_status_idx", sql: "ALTER TABLE support_tickets ADD KEY support_tickets_status_idx (status)" },
    { name: "support_tickets_created_at_idx", sql: "ALTER TABLE support_tickets ADD KEY support_tickets_created_at_idx (created_at)" },
  ];

  for (const index of indexes) {
    if (!(await indexExists("support_tickets", index.name, databaseName))) {
      await pool.query(index.sql);
    }
  }
}

async function ensureOrderBankDepositsTable(databaseName: string): Promise<void> {
  if (!(await tableExists("order_bank_deposits", databaseName))) {
    await pool.query(`
      CREATE TABLE order_bank_deposits (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        tenant_id VARCHAR(255) NULL,
        order_id VARCHAR(255) NOT NULL,
        fitid VARCHAR(64) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payer_name VARCHAR(255) NULL,
        posted_at VARCHAR(10) NULL,
        match_status VARCHAR(32) NOT NULL,
        note VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY order_bank_deposits_fitid_unique (fitid),
        KEY order_bank_deposits_order_id_idx (order_id)
      )
    `);
  }

  if (!(await indexExists("order_bank_deposits", "order_bank_deposits_fitid_unique", databaseName))) {
    try {
      await pool.query("ALTER TABLE order_bank_deposits ADD UNIQUE KEY order_bank_deposits_fitid_unique (fitid)");
    } catch {
      // Ignore duplicate or unsupported index creation issues.
    }
  }
  if (!(await indexExists("order_bank_deposits", "order_bank_deposits_order_id_idx", databaseName))) {
    try {
      await pool.query("ALTER TABLE order_bank_deposits ADD KEY order_bank_deposits_order_id_idx (order_id)");
    } catch {
      // Ignore duplicate or unsupported index creation issues.
    }
  }

  const [result] = await pool.query(
    `INSERT IGNORE INTO order_bank_deposits
      (id, tenant_id, order_id, fitid, amount, payer_name, posted_at, match_status, created_at)
     SELECT
       CONCAT('obd_', bank_deposit_fitid),
       tenant_id,
       id,
       bank_deposit_fitid,
       IFNULL(bank_deposit_amount, 0),
       bank_deposit_payer_name,
       bank_deposit_posted_at,
       bank_deposit_match_status,
       IFNULL(bank_deposit_matched_at, CURRENT_TIMESTAMP)
     FROM orders
     WHERE bank_deposit_fitid IS NOT NULL
       AND bank_deposit_fitid != ''
       AND bank_deposit_match_status IN ('ok', 'confirmed_100')`,
  );
  const inserted = Number((result as { affectedRows?: number } | undefined)?.affectedRows || 0);
  if (inserted > 0) {
    console.log(`[RuntimeSchema] Backfilled ${inserted} order_bank_deposits from orders.`);
  }
}

async function ensureReshipmentsTable(databaseName: string): Promise<void> {
  if (!(await tableExists("reshipments", databaseName))) {
    await pool.query(`
      CREATE TABLE reshipments (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL,
        support_ticket_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'reenvio_aguardando_estoque',
        products_snapshot JSON NOT NULL,
        resolved_reason VARCHAR(255) NULL,
        authorized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY reshipments_order_id_unique (order_id),
        KEY reshipments_support_ticket_id_idx (support_ticket_id),
        KEY reshipments_status_idx (status),
        KEY reshipments_created_at_idx (created_at)
      )
    `);
    return;
  }

  const definitions = [
    { name: "support_ticket_id", sql: "ALTER TABLE reshipments ADD COLUMN support_ticket_id VARCHAR(255) NOT NULL DEFAULT ''" },
    { name: "status", sql: "ALTER TABLE reshipments ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'reenvio_aguardando_estoque'" },
    { name: "products_snapshot", sql: "ALTER TABLE reshipments ADD COLUMN products_snapshot JSON NULL" },
    { name: "resolved_reason", sql: "ALTER TABLE reshipments ADD COLUMN resolved_reason VARCHAR(255) NULL" },
    { name: "authorized_at", sql: "ALTER TABLE reshipments ADD COLUMN authorized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "sent_at", sql: "ALTER TABLE reshipments ADD COLUMN sent_at TIMESTAMP NULL" },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("reshipments", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }

  const indexes = [
    { name: "reshipments_order_id_unique", sql: "ALTER TABLE reshipments ADD UNIQUE KEY reshipments_order_id_unique (order_id)" },
    { name: "reshipments_support_ticket_id_idx", sql: "ALTER TABLE reshipments ADD KEY reshipments_support_ticket_id_idx (support_ticket_id)" },
    { name: "reshipments_status_idx", sql: "ALTER TABLE reshipments ADD KEY reshipments_status_idx (status)" },
    { name: "reshipments_created_at_idx", sql: "ALTER TABLE reshipments ADD KEY reshipments_created_at_idx (created_at)" },
  ];

  for (const index of indexes) {
    if (!(await indexExists("reshipments", index.name, databaseName))) {
      try {
        await pool.query(index.sql);
      } catch {
        // Ignore index creation races in startup.
      }
    }
  }
}

async function ensureInventoryTables(databaseName: string): Promise<void> {
  if (!(await tableExists("inventory_balances", databaseName))) {
    await pool.query(`
      CREATE TABLE inventory_balances (
        product_id VARCHAR(255) NOT NULL PRIMARY KEY,
        quantity INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  if (!(await tableExists("inventory_movements", databaseName))) {
    await pool.query(`
      CREATE TABLE inventory_movements (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        product_id VARCHAR(255) NOT NULL,
        type VARCHAR(32) NOT NULL DEFAULT 'entry',
        entry_source VARCHAR(32) NULL,
        client_name VARCHAR(255) NULL,
        client_phone VARCHAR(255) NULL,
        tracking_code VARCHAR(255) NULL,
        quantity INT NOT NULL,
        reason VARCHAR(255) NULL,
        reference_id VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY inventory_movements_product_id_idx (product_id),
        KEY inventory_movements_type_idx (type),
        KEY inventory_movements_created_at_idx (created_at)
      )
    `);
  } else {
    const definitions = [
      { name: "type", sql: "ALTER TABLE inventory_movements ADD COLUMN type VARCHAR(32) NOT NULL DEFAULT 'entry'" },
      { name: "entry_source", sql: "ALTER TABLE inventory_movements ADD COLUMN entry_source VARCHAR(32) NULL" },
      { name: "client_name", sql: "ALTER TABLE inventory_movements ADD COLUMN client_name VARCHAR(255) NULL" },
      { name: "client_phone", sql: "ALTER TABLE inventory_movements ADD COLUMN client_phone VARCHAR(255) NULL" },
      { name: "tracking_code", sql: "ALTER TABLE inventory_movements ADD COLUMN tracking_code VARCHAR(255) NULL" },
      { name: "reason", sql: "ALTER TABLE inventory_movements ADD COLUMN reason VARCHAR(255) NULL" },
      { name: "reference_id", sql: "ALTER TABLE inventory_movements ADD COLUMN reference_id VARCHAR(255) NULL" },
    ];

    for (const definition of definitions) {
      if (!(await columnExists("inventory_movements", definition.name, databaseName))) {
        await pool.query(definition.sql);
      }
    }
  }

  const indexes = [
    {
      name: "inventory_movements_product_id_idx",
      sql: "ALTER TABLE inventory_movements ADD KEY inventory_movements_product_id_idx (product_id)",
    },
    { name: "inventory_movements_type_idx", sql: "ALTER TABLE inventory_movements ADD KEY inventory_movements_type_idx (type)" },
    {
      name: "inventory_movements_created_at_idx",
      sql: "ALTER TABLE inventory_movements ADD KEY inventory_movements_created_at_idx (created_at)",
    },
  ];

  for (const index of indexes) {
    if (!(await indexExists("inventory_movements", index.name, databaseName))) {
      await pool.query(index.sql);
    }
  }
}

async function ensureManualReshipmentsTable(databaseName: string): Promise<void> {
  if (!(await tableExists("manual_reshipments", databaseName))) {
    await pool.query(`
      CREATE TABLE manual_reshipments (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        status VARCHAR(50) NOT NULL DEFAULT 'reenvio_aguardando_estoque',
        products_snapshot JSON NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        client_phone VARCHAR(255) NOT NULL,
        client_document VARCHAR(32) NULL,
        address_cep VARCHAR(20) NOT NULL,
        address_street VARCHAR(255) NOT NULL,
        address_number VARCHAR(64) NOT NULL,
        address_complement VARCHAR(255) NULL,
        address_neighborhood VARCHAR(255) NOT NULL,
        address_city VARCHAR(255) NOT NULL,
        address_state VARCHAR(64) NOT NULL,
        notes TEXT NULL,
        created_by_username VARCHAR(255) NULL,
        authorized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY manual_reshipments_status_idx (status),
        KEY manual_reshipments_created_at_idx (created_at)
      )
    `);
    return;
  }

  const indexes = [
    { name: "manual_reshipments_status_idx", sql: "ALTER TABLE manual_reshipments ADD KEY manual_reshipments_status_idx (status)" },
    { name: "manual_reshipments_created_at_idx", sql: "ALTER TABLE manual_reshipments ADD KEY manual_reshipments_created_at_idx (created_at)" },
  ];

  for (const index of indexes) {
    if (!(await indexExists("manual_reshipments", index.name, databaseName))) {
      await pool.query(index.sql);
    }
  }
}

async function ensureManualReturnItemsTable(databaseName: string): Promise<void> {
  if (!(await tableExists("manual_return_items", databaseName))) {
    await pool.query(`
      CREATE TABLE manual_return_items (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        client_name VARCHAR(255) NOT NULL,
        returning_order VARCHAR(255) NULL,
        product_id VARCHAR(255) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY manual_return_items_status_idx (status),
        KEY manual_return_items_created_at_idx (created_at)
      )
    `);
    return;
  }

  const definitions = [
    { name: "status", sql: "ALTER TABLE manual_return_items ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'" },
    { name: "client_name", sql: "ALTER TABLE manual_return_items ADD COLUMN client_name VARCHAR(255) NOT NULL" },
    { name: "returning_order", sql: "ALTER TABLE manual_return_items ADD COLUMN returning_order VARCHAR(255) NULL" },
    { name: "product_id", sql: "ALTER TABLE manual_return_items ADD COLUMN product_id VARCHAR(255) NOT NULL" },
    { name: "product_name", sql: "ALTER TABLE manual_return_items ADD COLUMN product_name VARCHAR(255) NOT NULL" },
    { name: "quantity", sql: "ALTER TABLE manual_return_items ADD COLUMN quantity INT NOT NULL DEFAULT 1" },
    { name: "created_at", sql: "ALTER TABLE manual_return_items ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "updated_at", sql: "ALTER TABLE manual_return_items ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("manual_return_items", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }

  const indexes = [
    { name: "manual_return_items_status_idx", sql: "ALTER TABLE manual_return_items ADD KEY manual_return_items_status_idx (status)" },
    { name: "manual_return_items_created_at_idx", sql: "ALTER TABLE manual_return_items ADD KEY manual_return_items_created_at_idx (created_at)" },
  ];

  for (const index of indexes) {
    if (!(await indexExists("manual_return_items", index.name, databaseName))) {
      try {
        await pool.query(index.sql);
      } catch {
        // Ignore index creation races in startup.
      }
    }
  }
}

async function ensureProductCostHistoryTable(databaseName: string): Promise<void> {
  if (await tableExists("product_cost_history", databaseName)) return;

  await pool.query(`
    CREATE TABLE product_cost_history (
      id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
      product_id VARCHAR(255) NOT NULL,
      cost_price DECIMAL(10,2) NOT NULL,
      changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY product_cost_history_product_id_idx (product_id)
    )
  `);
}

async function ensureMarketingExpensesTable(databaseName: string): Promise<void> {
  if (await tableExists("marketing_expenses", databaseName)) return;

  await pool.query(`
    CREATE TABLE marketing_expenses (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      seller_code VARCHAR(255) NULL,
      expense_date TIMESTAMP NOT NULL,
      expense_start_date TIMESTAMP NULL,
      expense_end_date TIMESTAMP NULL,
      channel VARCHAR(255) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY marketing_expenses_expense_date_idx (expense_date),
      KEY marketing_expenses_expense_start_date_idx (expense_start_date),
      KEY marketing_expenses_expense_end_date_idx (expense_end_date),
      KEY marketing_expenses_seller_code_idx (seller_code)
    )
  `);

  return;
}

async function ensureMarketingExpensesColumns(databaseName: string): Promise<void> {
  if (!(await tableExists("marketing_expenses", databaseName))) return;

  const definitions = [
    { name: "expense_start_date", sql: "ALTER TABLE marketing_expenses ADD COLUMN expense_start_date TIMESTAMP NULL AFTER expense_date" },
    { name: "expense_end_date", sql: "ALTER TABLE marketing_expenses ADD COLUMN expense_end_date TIMESTAMP NULL AFTER expense_start_date" },
  ];

  for (const definition of definitions) {
    if (!(await columnExists("marketing_expenses", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }
}

async function ensureFilialPurchaseTables(databaseName: string): Promise<void> {
  if (!(await tableExists("filial_purchase_requests", databaseName))) {
    await pool.query(`
      CREATE TABLE filial_purchase_requests (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        filial_tenant_id VARCHAR(255) NOT NULL,
        order_id VARCHAR(255) NOT NULL,
        status VARCHAR(64) NOT NULL DEFAULT 'aguardando_compra_loja1',
        supplier_batch_id VARCHAR(255) NULL,
        supplier_batch_label VARCHAR(255) NULL,
        supplier_batch_sent_at TIMESTAMP NULL,
        supplier_batch_received_at TIMESTAMP NULL,
        client_name VARCHAR(255) NOT NULL,
        order_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        repasse_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        items_snapshot JSON NOT NULL,
        costs_snapshot JSON NULL,
        loja1_real_cost_total DECIMAL(10,2) NULL,
        loja1_real_profit DECIMAL(10,2) NULL,
        purchase_recorded_at TIMESTAMP NULL,
        stock_launched_at TIMESTAMP NULL,
        finalized_at TIMESTAMP NULL,
        created_by_admin VARCHAR(255) NULL,
        updated_by_admin VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY filial_purchase_requests_order_id_unique (order_id),
        KEY filial_purchase_requests_supplier_batch_id_idx (supplier_batch_id),
        KEY filial_purchase_requests_tenant_status_idx (filial_tenant_id, status),
        KEY filial_purchase_requests_status_idx (status),
        KEY filial_purchase_requests_created_at_idx (created_at)
      )
    `);
  }

  const columnDefinitions = [
    { name: "supplier_batch_id", sql: "ALTER TABLE filial_purchase_requests ADD COLUMN supplier_batch_id VARCHAR(255) NULL AFTER status" },
    { name: "supplier_batch_label", sql: "ALTER TABLE filial_purchase_requests ADD COLUMN supplier_batch_label VARCHAR(255) NULL AFTER supplier_batch_id" },
    { name: "supplier_batch_sent_at", sql: "ALTER TABLE filial_purchase_requests ADD COLUMN supplier_batch_sent_at TIMESTAMP NULL AFTER supplier_batch_label" },
    { name: "supplier_batch_received_at", sql: "ALTER TABLE filial_purchase_requests ADD COLUMN supplier_batch_received_at TIMESTAMP NULL AFTER supplier_batch_sent_at" },
  ];

  for (const definition of columnDefinitions) {
    if (!(await columnExists("filial_purchase_requests", definition.name, databaseName))) {
      await pool.query(definition.sql);
    }
  }

  if (!(await indexExists("filial_purchase_requests", "filial_purchase_requests_supplier_batch_id_idx", databaseName))) {
    try {
      await pool.query("ALTER TABLE filial_purchase_requests ADD KEY filial_purchase_requests_supplier_batch_id_idx (supplier_batch_id)");
    } catch {
      // Ignore duplicate or unsupported index creation issues.
    }
  }

  if (!(await tableExists("filial_purchase_request_audits", databaseName))) {
    await pool.query(`
      CREATE TABLE filial_purchase_request_audits (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        request_id VARCHAR(255) NOT NULL,
        action VARCHAR(64) NOT NULL,
        actor_username VARCHAR(255) NULL,
        payload JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY filial_purchase_request_audits_request_idx (request_id),
        KEY filial_purchase_request_audits_action_idx (action),
        KEY filial_purchase_request_audits_created_at_idx (created_at)
      )
    `);
  }
}

async function ensureOrderEventsTable(databaseName: string): Promise<void> {
  if (await tableExists("order_events", databaseName)) return;
  await pool.query(`
    CREATE TABLE order_events (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      order_id VARCHAR(255) NOT NULL,
      tenant_id VARCHAR(255) NULL,
      action VARCHAR(64) NOT NULL,
      actor_type VARCHAR(32) NOT NULL DEFAULT 'admin',
      actor_username VARCHAR(255) NULL,
      payload JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY order_events_order_id_idx (order_id),
      KEY order_events_order_created_idx (order_id, created_at),
      KEY order_events_tenant_id_idx (tenant_id)
    )
  `);
}

async function ensureMotoboyNeighborhoodsTable(databaseName: string): Promise<void> {
  if (!(await tableExists("motoboy_neighborhoods", databaseName))) {
    await pool.query(`
      CREATE TABLE motoboy_neighborhoods (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        neighborhood_name VARCHAR(255) NOT NULL,
        city VARCHAR(255) NULL,
        price DECIMAL(10,2) NOT NULL,
        interval_hours INT NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        notes TEXT NULL,
        yury_id VARCHAR(255) NULL,
        remote_updated_at TIMESTAMP NULL,
        synced_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY motoboy_neighborhoods_tenant_id_idx (tenant_id),
        KEY motoboy_neighborhoods_lookup_idx (tenant_id, is_active, sort_order),
        UNIQUE KEY motoboy_neighborhoods_tenant_yury_id_unique (tenant_id, yury_id)
      )
    `);
    return;
  }

  if (!(await columnExists("motoboy_neighborhoods", "interval_hours", databaseName))) {
    await pool.query("ALTER TABLE motoboy_neighborhoods ADD COLUMN interval_hours INT NOT NULL DEFAULT 1");
    await pool.query("UPDATE motoboy_neighborhoods SET interval_hours = CASE WHEN price <= 75 THEN 1 ELSE 2 END");
  }

  if (!(await columnExists("motoboy_neighborhoods", "yury_id", databaseName))) {
    await pool.query("ALTER TABLE motoboy_neighborhoods ADD COLUMN yury_id VARCHAR(255) NULL");
  }
  if (!(await columnExists("motoboy_neighborhoods", "remote_updated_at", databaseName))) {
    await pool.query("ALTER TABLE motoboy_neighborhoods ADD COLUMN remote_updated_at TIMESTAMP NULL");
  }
  if (!(await columnExists("motoboy_neighborhoods", "synced_at", databaseName))) {
    await pool.query("ALTER TABLE motoboy_neighborhoods ADD COLUMN synced_at TIMESTAMP NULL");
  }
  if (!(await indexExists("motoboy_neighborhoods", "motoboy_neighborhoods_tenant_yury_id_unique", databaseName))) {
    await pool.query("ALTER TABLE motoboy_neighborhoods ADD UNIQUE KEY motoboy_neighborhoods_tenant_yury_id_unique (tenant_id, yury_id)");
  }
}

async function ensureMotoboyDeliveryReservationsTable(databaseName: string): Promise<void> {
  if (await tableExists("motoboy_delivery_reservations", databaseName)) return;

  await pool.query(`
    CREATE TABLE motoboy_delivery_reservations (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      tenant_id VARCHAR(255) NOT NULL,
      order_id VARCHAR(255) NOT NULL,
      neighborhood_id VARCHAR(255) NOT NULL,
      neighborhood_name VARCHAR(255) NOT NULL,
      city VARCHAR(255) NULL,
      delivery_date DATE NOT NULL,
      slot_hour INT NOT NULL,
      start_time VARCHAR(5) NOT NULL,
      duration_hours INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY motoboy_delivery_reservations_slot_unique (tenant_id, delivery_date, slot_hour),
      KEY motoboy_delivery_reservations_order_idx (order_id)
    )
  `);
}

async function ensureOrderLogisticsAllocationsTable(databaseName: string): Promise<void> {
  if (await tableExists("order_logistics_allocations", databaseName)) return;

  await pool.query(`
    CREATE TABLE order_logistics_allocations (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      tenant_id VARCHAR(255) NOT NULL,
      order_id VARCHAR(255) NOT NULL,
      dispatch_date DATE NOT NULL,
      slot_position INT NOT NULL,
      capacity INT NOT NULL DEFAULT 20,
      promised_hours INT NOT NULL,
      deadline_at TIMESTAMP NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'allocated',
      active_slot_key VARCHAR(255) NULL,
      allocated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      released_at TIMESTAMP NULL,
      UNIQUE KEY order_logistics_allocations_order_unique (order_id),
      UNIQUE KEY order_logistics_allocations_active_slot_unique (active_slot_key),
      KEY order_logistics_allocations_schedule_idx (tenant_id, dispatch_date, status)
    )
  `);
}

async function ensureMotoboyCepRangesTable(databaseName: string): Promise<void> {
  if (!(await tableExists("motoboy_cep_ranges", databaseName))) {
    await pool.query(`
      CREATE TABLE motoboy_cep_ranges (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        yury_id VARCHAR(255) NULL,
        label VARCHAR(255) NOT NULL,
        city VARCHAR(255) NULL,
        cep_start INT NOT NULL,
        cep_end INT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        interval_hours INT NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        notes TEXT NULL,
        remote_updated_at TIMESTAMP NULL,
        synced_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY motoboy_cep_ranges_lookup_idx (tenant_id, is_active, cep_start, cep_end),
        UNIQUE KEY motoboy_cep_ranges_tenant_yury_id_unique (tenant_id, yury_id)
      )
    `);
    return;
  }

  if (!(await columnExists("motoboy_cep_ranges", "yury_id", databaseName))) {
    await pool.query("ALTER TABLE motoboy_cep_ranges ADD COLUMN yury_id VARCHAR(255) NULL");
  }
  if (!(await columnExists("motoboy_cep_ranges", "remote_updated_at", databaseName))) {
    await pool.query("ALTER TABLE motoboy_cep_ranges ADD COLUMN remote_updated_at TIMESTAMP NULL");
  }
  if (!(await columnExists("motoboy_cep_ranges", "synced_at", databaseName))) {
    await pool.query("ALTER TABLE motoboy_cep_ranges ADD COLUMN synced_at TIMESTAMP NULL");
  }
  if (!(await indexExists("motoboy_cep_ranges", "motoboy_cep_ranges_tenant_yury_id_unique", databaseName))) {
    await pool.query("ALTER TABLE motoboy_cep_ranges ADD UNIQUE KEY motoboy_cep_ranges_tenant_yury_id_unique (tenant_id, yury_id)");
  }
}

function normalizeMotoboySeedValue(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function seedDefaultMotoboyNeighborhoods(): Promise<void> {
  const [tenantRows] = await pool.query("SELECT id FROM tenants WHERE status = 'active'");
  const tenantIds = (tenantRows as Array<{ id?: unknown }>)
    .map((row) => String(row.id || "").trim())
    .filter(Boolean);

  for (const tenantId of tenantIds) {
    const [rows] = await pool.query(
      "SELECT neighborhood_name AS neighborhoodName, city FROM motoboy_neighborhoods WHERE tenant_id = ?",
      [tenantId],
    );
    const existingKeys = new Set(
      (rows as Array<{ neighborhoodName?: unknown; city?: unknown }>).map((row) => (
        `${normalizeMotoboySeedValue(row.city)}|${normalizeMotoboySeedValue(row.neighborhoodName)}`
      )),
    );
    const pending = [];

    for (const neighborhood of DEFAULT_MOTOBOY_NEIGHBORHOODS) {
      const key = `${normalizeMotoboySeedValue(neighborhood.city)}|${normalizeMotoboySeedValue(neighborhood.neighborhoodName)}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      pending.push(neighborhood);
    }

    if (pending.length === 0) continue;

    const placeholders = pending.map(() => "(?, ?, ?, ?, ?, ?, ?, TRUE, NULL)").join(", ");
    const values = pending.flatMap((neighborhood) => [
      `seed_motoboy_${crypto.createHash("sha256").update(`${tenantId}|${neighborhood.id}`).digest("hex").slice(0, 24)}`,
      tenantId,
      neighborhood.neighborhoodName,
      neighborhood.city,
      neighborhood.price.toFixed(2),
      neighborhood.price <= 75 ? 1 : 2,
      neighborhood.sortOrder,
    ]);
    await pool.query(
      `INSERT IGNORE INTO motoboy_neighborhoods (id, tenant_id, neighborhood_name, city, price, interval_hours, sort_order, is_active, notes) VALUES ${placeholders}`,
      values,
    );
    console.log(`[RuntimeSchema] Seeded ${pending.length} motoboy neighborhood(s) for tenant ${tenantId}.`);
  }
}

async function seedDefaultMotoboyCepRanges(): Promise<void> {
  const [tenantRows] = await pool.query("SELECT id FROM tenants WHERE status = 'active'");
  const tenantIds = (tenantRows as Array<{ id?: unknown }>)
    .map((row) => String(row.id || "").trim())
    .filter(Boolean);

  const defaults = [
    {
      key: "pirituba",
      label: "Pirituba",
      city: "São Paulo",
      cepStart: 5100000,
      cepEnd: 5299999,
      price: "80.00",
      intervalHours: 2,
      sortOrder: 1000,
      notes: "Entrega por motoboy na região de Pirituba",
    },
    {
      key: "sao-paulo-geral",
      label: "São Paulo - Faixa Geral",
      city: "São Paulo",
      cepStart: 1000000,
      cepEnd: 8999999,
      price: "70.00",
      intervalHours: 1,
      sortOrder: 10000,
      notes: "Fallback geral de entrega por motoboy em São Paulo",
    },
    {
      key: "santo-andre-geral",
      label: "Santo André - Faixa Geral",
      city: "Santo André",
      cepStart: 9010000,
      cepEnd: 9399999,
      price: "80.00",
      intervalHours: 2,
      sortOrder: 10000,
      notes: "Fallback geral de entrega por motoboy em Santo André",
    },
    {
      key: "sao-bernardo-geral",
      label: "São Bernardo do Campo - Faixa Geral",
      city: "São Bernardo do Campo",
      cepStart: 9600000,
      cepEnd: 9899999,
      price: "90.00",
      intervalHours: 2,
      sortOrder: 10000,
      notes: "Fallback geral de entrega por motoboy em São Bernardo do Campo",
    },
  ];

  for (const tenantId of tenantIds) {
    let seeded = 0;
    for (const definition of defaults) {
      const [existingRows] = await pool.query(
        "SELECT 1 FROM motoboy_cep_ranges WHERE tenant_id = ? AND city = ? AND cep_start = ? AND cep_end = ? LIMIT 1",
        [tenantId, definition.city, definition.cepStart, definition.cepEnd],
      );
      if (Array.isArray(existingRows) && existingRows.length > 0) continue;

      const id = `seed_motoboy_range_${crypto.createHash("sha256").update(`${tenantId}|${definition.key}`).digest("hex").slice(0, 24)}`;
      await pool.query(
        `INSERT IGNORE INTO motoboy_cep_ranges
          (id, tenant_id, label, city, cep_start, cep_end, price, interval_hours, is_active, sort_order, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
        [
          id,
          tenantId,
          definition.label,
          definition.city,
          definition.cepStart,
          definition.cepEnd,
          definition.price,
          definition.intervalHours,
          definition.sortOrder,
          definition.notes,
        ],
      );
      seeded += 1;
    }
    if (seeded > 0) console.log(`[RuntimeSchema] Seeded ${seeded} motoboy CEP range(s) for tenant ${tenantId}.`);
  }
}

async function ensureYuryWebhookEventsProcessedTable(databaseName: string): Promise<void> {
  if (await tableExists("yury_webhook_events_processed", databaseName)) return;

  await pool.query(`
    CREATE TABLE yury_webhook_events_processed (
      event_id VARCHAR(255) NOT NULL PRIMARY KEY,
      event_type VARCHAR(128) NOT NULL,
      processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureCustomerWalletLedgerTable(databaseName: string): Promise<void> {
  if (await tableExists("customer_wallet_ledger", databaseName)) return;

  await pool.query(`
    CREATE TABLE customer_wallet_ledger (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      tenant_id VARCHAR(255) NULL,
      user_id VARCHAR(255) NOT NULL,
      order_id VARCHAR(255) NULL,
      type VARCHAR(64) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY customer_wallet_ledger_user_idx (tenant_id, user_id),
      KEY customer_wallet_ledger_order_idx (order_id)
    )
  `);
}

async function ensureYuryInventoryBalancesTable(databaseName: string): Promise<void> {
  if (await tableExists("yury_inventory_balances", databaseName)) return;

  await pool.query(`
    CREATE TABLE yury_inventory_balances (
      product_id VARCHAR(255) NOT NULL PRIMARY KEY,
      product_name VARCHAR(255) NOT NULL,
      qty_motoboy INT NOT NULL DEFAULT 0,
      qty_minas INT NOT NULL DEFAULT 0,
      synced_at TIMESTAMP NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function ensureRuntimeSchema(): Promise<void> {
  try {
    const databaseName = getDatabaseName();
    if (!databaseName) {
      console.warn("[RuntimeSchema] DATABASE_URL has no database name. Skipping runtime schema sync.");
      return;
    }

    await ensureTenantsTables(databaseName);
    await ensureOrdersColumns(databaseName);
    await ensureOrderBankDepositsTable(databaseName);
    await ensureProductsColumns(databaseName);
    await ensureSellersColumns(databaseName);
    await ensureCouponsColumns(databaseName);
    await ensureOrderBumpsColumns(databaseName);
    await ensureCustomerUsersTable(databaseName);
    await ensureAffiliatesTables(databaseName);
    await ensureSellerCommissionPaymentsTable(databaseName);
    await ensureRaffleTables(databaseName);
    await ensureSupportTicketsTable(databaseName);
    await ensureReshipmentsTable(databaseName);
    await ensureInventoryTables(databaseName);
    await ensureManualReshipmentsTable(databaseName);
    await ensureManualReturnItemsTable(databaseName);
    await ensureProductCostHistoryTable(databaseName);
    await ensureMarketingExpensesTable(databaseName);
    await ensureMarketingExpensesColumns(databaseName);
    await ensureFilialPurchaseTables(databaseName);
    await ensureOrderEventsTable(databaseName);
    await ensureAdminSessionsTenantColumn(databaseName);
    await ensureTenantColumns(databaseName);
    await ensureTenantSettingsTable(databaseName);
    await ensureMotoboyNeighborhoodsTable(databaseName);
    await ensureMotoboyCepRangesTable(databaseName);
    await ensureMotoboyDeliveryReservationsTable(databaseName);
    await ensureOrderLogisticsAllocationsTable(databaseName);
    await ensureYuryWebhookEventsProcessedTable(databaseName);
    await ensureYuryInventoryBalancesTable(databaseName);
    await ensureCustomerWalletLedgerTable(databaseName);
    await seedDefaultTenantAndBackfill(databaseName);
    if (isYuryMotoboySyncConfigured()) {
      console.log("[RuntimeSchema] Skipping Motoboy seed; Yury coverage sync is configured.");
    } else {
      await seedDefaultMotoboyNeighborhoods();
      await seedDefaultMotoboyCepRanges();
    }

    console.log("[RuntimeSchema] Schema sync completed.");
  } catch (error) {
    console.error("[RuntimeSchema] Schema sync failed:", error);
  }
}