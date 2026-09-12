import { db, ordersTable } from "@workspace/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { grantInsuranceCashbackIfEligible } from "./customer-wallet";
import { normalizeCustomerDocument } from "./customer-document";

function buildOrderTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

function digitsDocumentSql(digits: string) {
  return sql`REPLACE(REPLACE(REPLACE(REPLACE(${ordersTable.clientDocument}, '.', ''), '-', ''), '/', ''), ' ', '') = ${digits}`;
}

export async function attachGuestOrdersForCustomer(input: {
  userId: string;
  email: string;
  document?: string | null;
  tenantId: string;
}): Promise<number> {
  const userId = String(input.userId || "").trim();
  const normalizedEmail = String(input.email || "").trim().toLowerCase();
  const document = normalizeCustomerDocument(input.document);
  const tenantId = String(input.tenantId || "").trim() || DEFAULT_TENANT_ID;
  if (!userId || !tenantId || (!normalizedEmail && document.length !== 11)) return 0;

  const identityMatch = document.length === 11 && normalizedEmail
    ? or(
      sql`lower(trim(${ordersTable.clientEmail})) = ${normalizedEmail}`,
      digitsDocumentSql(document),
    )
    : document.length === 11
      ? digitsDocumentSql(document)
      : sql`lower(trim(${ordersTable.clientEmail})) = ${normalizedEmail}`;

  const where = and(
    buildOrderTenantWhere(tenantId),
    isNull(ordersTable.userId),
    identityMatch,
  );

  const guests = await db.select().from(ordersTable).where(where);
  if (guests.length === 0) return 0;

  const ids = guests.map((row) => row.id);
  await db
    .update(ordersTable)
    .set({ userId })
    .where(inArray(ordersTable.id, ids));

  for (const order of guests) {
    try {
      await grantInsuranceCashbackIfEligible({ ...order, userId });
    } catch (err) {
      console.warn("[Customer] cashback ao grudar pedido guest falhou", order.id, err);
    }
  }

  return ids.length;
}
