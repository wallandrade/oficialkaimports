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

    console.log("[RuntimeSchema] Schema sync completed.");
  } catch (error) {
    console.error("[RuntimeSchema] Schema sync failed:", error);
  }
}