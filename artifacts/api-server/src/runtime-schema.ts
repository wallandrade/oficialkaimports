import { pool } from "@workspace/db";

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
    // Novo campo para status de envio
    {
      name: "enviado",
      sql: "ALTER TABLE orders ADD COLUMN enviado TINYINT(1) NOT NULL DEFAULT 0",
    },
    // Campos de geolocalização do IP
    { name: "ip_city",     sql: "ALTER TABLE orders ADD COLUMN ip_city VARCHAR(100) NULL" },
    { name: "ip_region",   sql: "ALTER TABLE orders ADD COLUMN ip_region VARCHAR(100) NULL" },
    { name: "ip_isp",      sql: "ALTER TABLE orders ADD COLUMN ip_isp VARCHAR(255) NULL" },
    { name: "ip_is_proxy", sql: "ALTER TABLE orders ADD COLUMN ip_is_proxy TINYINT(1) NULL" },
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
}

async function ensureProductsColumns(databaseName: string): Promise<void> {
  if (!(await tableExists("products", databaseName))) return;

  const definitions = [
    {
      name: "cost_price",
      sql: "ALTER TABLE products ADD COLUMN cost_price DECIMAL(10,2) NOT NULL DEFAULT 0.00",
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
    { name: "order_total", sql: "ALTER TABLE support_tickets ADD COLUMN order_total DECIMAL(10,2) NULL" },
    { name: "order_created_at", sql: "ALTER TABLE support_tickets ADD COLUMN order_created_at TIMESTAMP NULL" },
    { name: "resolved_at", sql: "ALTER TABLE support_tickets ADD COLUMN resolved_at TIMESTAMP NULL" },
    { name: "resolution_reason", sql: "ALTER TABLE support_tickets ADD COLUMN resolution_reason VARCHAR(64) NULL" },
    { name: "address_change_json", sql: "ALTER TABLE support_tickets ADD COLUMN address_change_json MEDIUMTEXT NULL" },
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

export async function ensureRuntimeSchema(): Promise<void> {
  try {
    const databaseName = getDatabaseName();
    if (!databaseName) {
      console.warn("[RuntimeSchema] DATABASE_URL has no database name. Skipping runtime schema sync.");
      return;
    }

    await ensureOrdersColumns(databaseName);
    await ensureProductsColumns(databaseName);
    await ensureSellersColumns(databaseName);
    await ensureCouponsColumns(databaseName);
    await ensureCustomerUsersTable(databaseName);
    await ensureAffiliatesTables(databaseName);
    await ensureRaffleTables(databaseName);
    await ensureSupportTicketsTable(databaseName);
    await ensureReshipmentsTable(databaseName);
    await ensureInventoryTables(databaseName);
    await ensureManualReshipmentsTable(databaseName);

    console.log("[RuntimeSchema] Schema sync completed.");
  } catch (error) {
    console.error("[RuntimeSchema] Schema sync failed:", error);
  }
}