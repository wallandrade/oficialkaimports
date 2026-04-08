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
    { name: "affiliate_credit_used", sql: "ALTER TABLE orders ADD COLUMN affiliate_credit_used DECIMAL(10,2) NULL" },
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

export async function ensureRuntimeSchema(): Promise<void> {
  try {
    const databaseName = getDatabaseName();
    if (!databaseName) {
      console.warn("[RuntimeSchema] DATABASE_URL has no database name. Skipping runtime schema sync.");
      return;
    }

    await ensureOrdersColumns(databaseName);
    await ensureCustomerUsersTable(databaseName);
    await ensureAffiliatesTables(databaseName);
    await ensureRaffleTables(databaseName);

    console.log("[RuntimeSchema] Schema sync completed.");
  } catch (error) {
    console.error("[RuntimeSchema] Schema sync failed:", error);
  }
}