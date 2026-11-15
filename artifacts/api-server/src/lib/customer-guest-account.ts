import crypto from "crypto";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { customerUsersTable, db, ordersTable } from "@workspace/db";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { normalizeCustomerDocument } from "./customer-document";
import { attachGuestOrdersForCustomer } from "./customer-guest-orders";
import { generateSalt, hashPassword } from "../middlewares/customer-auth";
import { isUnsetCustomerPassword, parseGuestCustomerEmail, pickTenantCustomer, UNSET_PASSWORD_SALT_PREFIX } from "./customer-guest-account-core";

export { isUnsetCustomerPassword, parseGuestCustomerEmail, pickTenantCustomer, UNSET_PASSWORD_SALT_PREFIX };

export type GuestCustomerRecord = {
  id: string;
  tenantId: string | null;
  name: string;
  email: string;
  document: string | null;
  salt: string;
  created: boolean;
};

type EnsureResult =
  | { ok: true; customer: GuestCustomerRecord }
  | { ok: false; status: 404 | 409; error: string; message: string };

function buildCustomerUsersTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(customerUsersTable.tenantId, tenantId), isNull(customerUsersTable.tenantId), eq(customerUsersTable.tenantId, ""));
  }
  return eq(customerUsersTable.tenantId, tenantId);
}

function buildOrderTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

function isDuplicateEntry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; errno?: number; cause?: unknown };
  if (record.code === "ER_DUP_ENTRY" || record.errno === 1062) return true;
  return isDuplicateEntry(record.cause);
}

function toRecord(row: {
  id: string;
  tenantId: string | null;
  name: string;
  email: string;
  document: string | null;
  salt: string;
}, created: boolean): GuestCustomerRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    document: row.document,
    salt: row.salt,
    created,
  };
}

export async function findCustomerInTenantByEmail(tenantId: string, email: string): Promise<GuestCustomerRecord | null> {
  const rows = await db
    .select({
      id: customerUsersTable.id,
      tenantId: customerUsersTable.tenantId,
      name: customerUsersTable.name,
      email: customerUsersTable.email,
      document: customerUsersTable.document,
      salt: customerUsersTable.salt,
    })
    .from(customerUsersTable)
    .where(and(buildCustomerUsersTenantWhere(tenantId), eq(customerUsersTable.email, email)))
    .limit(5);
  const row = pickTenantCustomer(rows, tenantId);
  return row ? toRecord(row, false) : null;
}

async function loadGuestProfile(tenantId: string, email: string): Promise<{ name: string; document: string | null } | null> {
  const rows = await db
    .select({
      clientName: ordersTable.clientName,
      clientDocument: ordersTable.clientDocument,
    })
    .from(ordersTable)
    .where(and(
      buildOrderTenantWhere(tenantId),
      sql`lower(trim(${ordersTable.clientEmail})) = ${email}`,
    ))
    .orderBy(desc(ordersTable.createdAt))
    .limit(20);
  if (rows.length === 0) return null;
  const name = String(rows[0]?.clientName || "").trim() || "Cliente";
  let document: string | null = null;
  for (const row of rows) {
    const digits = normalizeCustomerDocument(row.clientDocument);
    if (digits.length === 11) {
      document = digits;
      break;
    }
  }
  return { name, document };
}

function createUnsetPassword(): { salt: string; passwordHash: string } {
  const salt = `${UNSET_PASSWORD_SALT_PREFIX}${generateSalt()}`;
  const passwordHash = hashPassword(crypto.randomBytes(32).toString("hex"), salt);
  return { salt, passwordHash };
}

async function rememberDocumentIfEmpty(customer: GuestCustomerRecord, document: string | null): Promise<GuestCustomerRecord> {
  if (!document || normalizeCustomerDocument(customer.document)) return customer;
  await db
    .update(customerUsersTable)
    .set({ document, updatedAt: new Date() })
    .where(eq(customerUsersTable.id, customer.id));
  return { ...customer, document };
}

export async function findCustomerInTenantById(tenantId: string, userId: string): Promise<GuestCustomerRecord | null> {
  const rows = await db
    .select({
      id: customerUsersTable.id,
      tenantId: customerUsersTable.tenantId,
      name: customerUsersTable.name,
      email: customerUsersTable.email,
      document: customerUsersTable.document,
      salt: customerUsersTable.salt,
    })
    .from(customerUsersTable)
    .where(and(buildCustomerUsersTenantWhere(tenantId), eq(customerUsersTable.id, userId)))
    .limit(1);
  const row = rows[0];
  return row ? toRecord(row, false) : null;
}

export async function guestEmailHasOrders(tenantId: string, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(and(
      buildOrderTenantWhere(tenantId),
      sql`lower(trim(${ordersTable.clientEmail})) = ${email}`,
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Abre (ou reusa) a conta do convidado na loja do admin.
 * A senha nova é aleatória e o salt começa com `nopass:`, então o login recusa até o cliente criar a senha.
 */
export async function ensureGuestCustomerAccount(input: { tenantId: string; email: string }): Promise<EnsureResult> {
  const tenantId = String(input.tenantId || "").trim() || DEFAULT_TENANT_ID;
  const email = String(input.email || "").trim().toLowerCase();
  if (!parseGuestCustomerEmail(`guest:${email}`)) {
    return { ok: false, status: 404, error: "NOT_FOUND", message: "Comprador convidado não encontrado nesta loja." };
  }

  const existing = await findCustomerInTenantByEmail(tenantId, email);
  if (existing) {
    const profile = await loadGuestProfile(tenantId, email);
    const customer = await rememberDocumentIfEmpty(existing, profile?.document || null);
    await attachGuestOrdersForCustomer({
      userId: customer.id,
      email: customer.email,
      document: customer.document,
      tenantId,
    });
    return { ok: true, customer };
  }

  const profile = await loadGuestProfile(tenantId, email);
  if (!profile) {
    return { ok: false, status: 404, error: "NOT_FOUND", message: "Comprador convidado não encontrado nesta loja." };
  }

  const id = crypto.randomBytes(8).toString("hex");
  const password = createUnsetPassword();
  try {
    await db.insert(customerUsersTable).values({
      id,
      tenantId,
      name: profile.name,
      email,
      document: profile.document,
      passwordHash: password.passwordHash,
      salt: password.salt,
      updatedAt: new Date(),
    });
  } catch (err) {
    if (!isDuplicateEntry(err)) throw err;
    const raced = await findCustomerInTenantByEmail(tenantId, email);
    if (!raced) {
      return {
        ok: false,
        status: 409,
        error: "EMAIL_IN_OTHER_STORE",
        message: "Este e-mail já tem conta em outra loja. O saldo desta loja não foi alterado.",
      };
    }
    await attachGuestOrdersForCustomer({
      userId: raced.id,
      email: raced.email,
      document: raced.document,
      tenantId,
    });
    return { ok: true, customer: raced };
  }

  await attachGuestOrdersForCustomer({
    userId: id,
    email,
    document: profile.document,
    tenantId,
  });

  return {
    ok: true,
    customer: {
      id,
      tenantId,
      name: profile.name,
      email,
      document: profile.document,
      salt: password.salt,
      created: true,
    },
  };
}
