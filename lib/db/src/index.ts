import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { mysqlPoolOptionsFromUrl } from "./pool-config";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const fromUrl = mysqlPoolOptionsFromUrl(
  process.env.DATABASE_URL,
  process.env.DATABASE_CA_CERT,
);

export const pool = mysql.createPool({
  ...fromUrl,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 30000,
});

export const db = drizzle(pool, { schema, mode: "default" });

export * from "./schema";
