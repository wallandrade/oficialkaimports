import { mysqlTable, varchar, int, datetime, primaryKey } from 'drizzle-orm/mysql-core';

export const adminSessionsTable = mysqlTable('admin_sessions', {
  token: varchar('token', { length: 128 }).primaryKey(),
  username: varchar('username', { length: 64 }).notNull(),
  tenantId: varchar('tenant_id', { length: 255 }),
  isPrimary: int('is_primary').notNull(),
  expiresAt: datetime('expires_at', { mode: 'date' }).notNull(),
  createdAt: datetime('created_at', { mode: 'date' }).notNull(),
});
