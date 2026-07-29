import { db, ordersTable } from "../../lib/db/src/index";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

const DEFAULT_TENANT_ID = "tenant_loja1";

function buildTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

async function listTenantKeys(): Promise<string[]> {
  const raw = await db.execute(sql`
    SELECT DISTINCT COALESCE(NULLIF(tenant_id, ''), ${DEFAULT_TENANT_ID}) AS tenantKey
    FROM orders
  `);

  const rows = Array.isArray(raw)
    ? (Array.isArray(raw[0]) ? raw[0] : raw)
    : [];

  const keys = rows
    .map((row: any) => String(row?.tenantKey || "").trim())
    .filter(Boolean);

  return Array.from(new Set(keys));
}

async function backfillTenant(tenantId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const lockKey = `orders_seq_${tenantId}`;
    await tx.execute(sql`SELECT GET_LOCK(${lockKey}, 30) AS acquired`);

    try {
      const maxRows = await tx
        .select({ maxNumber: sql<number>`COALESCE(MAX(${ordersTable.orderNumber}), 0)` })
        .from(ordersTable)
        .where(buildTenantWhere(tenantId));

      let next = Number(maxRows[0]?.maxNumber || 0);

      const pending = await tx
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(and(buildTenantWhere(tenantId), isNull(ordersTable.orderNumber)))
        .orderBy(asc(ordersTable.createdAt), asc(ordersTable.id));

      for (const row of pending) {
        next += 1;
        await tx
          .update(ordersTable)
          .set({ orderNumber: next, updatedAt: new Date() })
          .where(eq(ordersTable.id, row.id));
      }

      return pending.length;
    } finally {
      await tx.execute(sql`DO RELEASE_LOCK(${lockKey})`);
    }
  });
}

async function main() {
  const tenantKeys = await listTenantKeys();
  if (tenantKeys.length === 0) {
    console.log("Nenhum pedido encontrado para backfill.");
    return;
  }

  let totalUpdated = 0;
  for (const tenantId of tenantKeys) {
    const count = await backfillTenant(tenantId);
    totalUpdated += count;
    console.log(`Tenant ${tenantId}: ${count} pedido(s) numerado(s).`);
  }

  console.log(`Backfill concluido. Total atualizado: ${totalUpdated}`);
}

main().catch((error) => {
  console.error("Falha no backfill de numeracao de pedidos:", error);
  process.exit(1);
});
