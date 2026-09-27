import crypto from "crypto";
import {
  affiliateCreditUsesTable,
  affiliateCommissionsTable,
  affiliateReferralsTable,
  affiliatesTable,
  db,
  ordersTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { DEFAULT_TENANT_ID } from "./tenant-context";
import {
  priorSellerLinkCode,
  type AffiliateBuyerIdentity,
  type SellerLinkOrder,
} from "./affiliate-seller-customer";

const COMMISSION_RATE = 0.01;

function randomId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function generateCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export function normalizeAffiliateCode(input: unknown): string {
  return String(input || "").trim().toUpperCase();
}

function ordersTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

export async function priorSellerLinkCodesByOrderId(orders: AffiliateBuyerIdentity[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (orders.length === 0) return result;

  const emails = Array.from(new Set(orders.map((order) => String(order.clientEmail || "").trim().toLowerCase()).filter(Boolean)));
  const userIds = Array.from(new Set(orders.map((order) => String(order.userId || "").trim()).filter(Boolean)));
  const documents = Array.from(new Set(orders.map((order) => String(order.clientDocument || "").replace(/\D/g, "")).filter((value) => value.length === 11 || value.length === 14)));
  const identityFilters: SQL[] = [];
  if (emails.length > 0) {
    identityFilters.push(sql`lower(trim(${ordersTable.clientEmail})) IN (${sql.join(emails.map((email) => sql`${email}`), sql`, `)})`);
  }
  if (userIds.length > 0) {
    identityFilters.push(inArray(ordersTable.userId, userIds));
  }
  if (documents.length > 0) {
    identityFilters.push(sql`REPLACE(REPLACE(REPLACE(REPLACE(${ordersTable.clientDocument}, '.', ''), '-', ''), '/', ''), ' ', '') IN (${sql.join(documents.map((document) => sql`${document}`), sql`, `)})`);
  }
  if (identityFilters.length === 0) return result;

  const tenantIds = Array.from(new Set(orders.map((order) => String(order.tenantId || "").trim() || DEFAULT_TENANT_ID)));
  const rows = await db
    .select({
      id: ordersTable.id,
      createdAt: ordersTable.createdAt,
      tenantId: ordersTable.tenantId,
      userId: ordersTable.userId,
      clientEmail: ordersTable.clientEmail,
      clientDocument: ordersTable.clientDocument,
      sellerCode: ordersTable.sellerCode,
      sellerSource: ordersTable.sellerSource,
    })
    .from(ordersTable)
    .where(and(
      tenantIds.length === 1 ? ordersTenantWhere(tenantIds[0]) : undefined,
      inArray(ordersTable.status, ["paid", "completed"]),
      sql`TRIM(COALESCE(${ordersTable.sellerCode}, '')) <> ''`,
      or(...identityFilters),
    ));

  const candidates = rows as SellerLinkOrder[];
  for (const order of orders) {
    const code = priorSellerLinkCode(order, candidates);
    if (code) result.set(order.id, code);
  }
  return result;
}

export async function revokeSellerCustomerAffiliateCommissions(): Promise<number> {
  const commissionOrders = await db
    .select({
      commissionId: affiliateCommissionsTable.id,
      id: ordersTable.id,
      createdAt: ordersTable.createdAt,
      tenantId: ordersTable.tenantId,
      userId: ordersTable.userId,
      clientEmail: ordersTable.clientEmail,
      clientDocument: ordersTable.clientDocument,
    })
    .from(affiliateCommissionsTable)
    .innerJoin(ordersTable, eq(affiliateCommissionsTable.orderId, ordersTable.id));

  const blocked = await priorSellerLinkCodesByOrderId(commissionOrders);
  const dropIds = commissionOrders
    .filter((row) => blocked.has(row.id))
    .map((row) => row.commissionId);
  if (dropIds.length === 0) return 0;

  for (let index = 0; index < dropIds.length; index += 200) {
    const chunk = dropIds.slice(index, index + 200);
    await db.delete(affiliateCommissionsTable).where(inArray(affiliateCommissionsTable.id, chunk));
  }

  console.log(`[Affiliate] ${dropIds.length} comissão(ões) de cliente de vendedor deixaram de contar.`);
  return dropIds.length;
}

export async function getOrCreateAffiliateByUserId(userId: string, tenantId = DEFAULT_TENANT_ID) {
  const existing = await db
    .select()
    .from(affiliatesTable)
    .where(and(eq(affiliatesTable.tenantId, tenantId), eq(affiliatesTable.userId, userId)))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  let createdCode = "";
  for (let i = 0; i < 5; i += 1) {
    const candidate = generateCode();
    const codeExists = await db
      .select({ id: affiliatesTable.id })
      .from(affiliatesTable)
      .where(and(eq(affiliatesTable.tenantId, tenantId), eq(affiliatesTable.affiliateCode, candidate)))
      .limit(1);

    if (!codeExists[0]) {
      createdCode = candidate;
      break;
    }
  }

  if (!createdCode) {
    throw new Error("Unable to generate unique affiliate code.");
  }

  const newAffiliate = {
    id: randomId(),
    tenantId,
    userId,
    affiliateCode: createdCode,
    updatedAt: new Date(),
  };

  await db.insert(affiliatesTable).values(newAffiliate);

  const fresh = await db
    .select()
    .from(affiliatesTable)
    .where(and(eq(affiliatesTable.tenantId, tenantId), eq(affiliatesTable.userId, userId)))
    .limit(1);

  if (!fresh[0]) {
    throw new Error("Failed to create affiliate profile.");
  }

  return fresh[0];
}

export async function resolveAffiliateByCode(code: string, tenantId = DEFAULT_TENANT_ID) {
  const normalized = normalizeAffiliateCode(code);
  if (!normalized) return null;

  const rows = await db
    .select()
    .from(affiliatesTable)
    .where(and(eq(affiliatesTable.tenantId, tenantId), eq(affiliatesTable.affiliateCode, normalized)))
    .limit(1);

  return rows[0] || null;
}

export async function registerAffiliateLead(input: {
  tenantId?: string;
  affiliateUserId: string;
  referredUserId?: string | null;
  referredEmail?: string | null;
}) {
  const tenantId = String(input.tenantId || "").trim() || DEFAULT_TENANT_ID;
  const referredUserId = input.referredUserId || null;
  const referredEmail = (input.referredEmail || "").trim().toLowerCase() || null;

  if (!referredUserId && !referredEmail) {
    return;
  }

  if (referredUserId) {
    const existingByUser = await db
      .select({ id: affiliateReferralsTable.id })
      .from(affiliateReferralsTable)
      .where(
        and(
          eq(affiliateReferralsTable.tenantId, tenantId),
          eq(affiliateReferralsTable.affiliateUserId, input.affiliateUserId),
          eq(affiliateReferralsTable.referredUserId, referredUserId)
        )
      )
      .limit(1);

    if (existingByUser[0]) {
      return;
    }
  }

  if (!referredUserId && referredEmail) {
    const existingByEmail = await db
      .select({ id: affiliateReferralsTable.id })
      .from(affiliateReferralsTable)
      .where(
        and(
          eq(affiliateReferralsTable.tenantId, tenantId),
          eq(affiliateReferralsTable.affiliateUserId, input.affiliateUserId),
          eq(affiliateReferralsTable.referredEmail, referredEmail)
        )
      )
      .limit(1);

    if (existingByEmail[0]) {
      return;
    }
  }

  await db.insert(affiliateReferralsTable).values({
    id: randomId(),
    tenantId,
    affiliateUserId: input.affiliateUserId,
    referredUserId,
    referredEmail,
    updatedAt: new Date(),
  });
}

export async function ensureOrderCommission(orderId: string): Promise<boolean> {
  const orderRows = await db
    .select({
      tenantId: ordersTable.tenantId,
      id: ordersTable.id,
      status: ordersTable.status,
      total: ordersTable.total,
      products: ordersTable.products,
      userId: ordersTable.userId,
      clientEmail: ordersTable.clientEmail,
      clientDocument: ordersTable.clientDocument,
      createdAt: ordersTable.createdAt,
      affiliateUserId: ordersTable.affiliateUserId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  const order = orderRows[0];
  if (!order) return false;
  const tenantId = String(order.tenantId || "").trim() || DEFAULT_TENANT_ID;

  const isPaid = order.status === "paid" || order.status === "completed";
  if (!isPaid) return false;

  const affiliateUserId = order.affiliateUserId || null;
  if (!affiliateUserId) return false;

  if (order.userId && order.userId === affiliateUserId) {
    // Prevent self-referral commission.
    return false;
  }

  let products: unknown[] = [];
  if (Array.isArray(order.products)) {
    products = order.products;
  } else if (typeof order.products === "string") {
    try {
      const parsed = JSON.parse(order.products);
      products = Array.isArray(parsed) ? parsed : [];
    } catch {
      products = [];
    }
  }

  if (products.length === 0) {
    return false;
  }

  const priorSeller = await priorSellerLinkCodesByOrderId([{
    id: order.id,
    createdAt: order.createdAt,
    tenantId,
    userId: order.userId,
    clientEmail: order.clientEmail,
    clientDocument: order.clientDocument,
  }]);
  if (priorSeller.has(order.id)) {
    await db.delete(affiliateCommissionsTable).where(eq(affiliateCommissionsTable.orderId, order.id));
    return false;
  }

  const already = await db
    .select({ id: affiliateCommissionsTable.id })
    .from(affiliateCommissionsTable)
    .where(and(eq(affiliateCommissionsTable.tenantId, tenantId), eq(affiliateCommissionsTable.orderId, order.id)))
    .limit(1);

  if (already[0]) {
    return false;
  }

  const baseAmount = Number(order.total || 0);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    return false;
  }

  const commissionAmount = Math.round(baseAmount * COMMISSION_RATE * 100) / 100;
  if (commissionAmount <= 0) {
    return false;
  }

  await db.insert(affiliateCommissionsTable).values({
    id: randomId(),
    tenantId,
    affiliateUserId,
    orderId: order.id,
    referredUserId: order.userId || null,
    referredEmail: (order.clientEmail || "").trim().toLowerCase() || null,
    rate: COMMISSION_RATE.toFixed(4),
    baseAmount: baseAmount.toFixed(2),
    commissionAmount: commissionAmount.toFixed(2),
    status: "released",
    updatedAt: new Date(),
  });

  if (order.userId || order.clientEmail) {
    await registerAffiliateLead({
      tenantId,
      affiliateUserId,
      referredUserId: order.userId || null,
      referredEmail: order.clientEmail,
    });

    if (order.userId) {
      const existingReferral = await db
        .select({ id: affiliateReferralsTable.id, convertedOrders: affiliateReferralsTable.convertedOrders })
        .from(affiliateReferralsTable)
        .where(
          and(
            eq(affiliateReferralsTable.tenantId, tenantId),
            eq(affiliateReferralsTable.affiliateUserId, affiliateUserId),
            eq(affiliateReferralsTable.referredUserId, order.userId)
          )
        )
        .limit(1);

      if (existingReferral[0]) {
        await db
          .update(affiliateReferralsTable)
          .set({
            hasConverted: true,
            convertedOrders: Number(existingReferral[0].convertedOrders || 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(affiliateReferralsTable.id, existingReferral[0].id));
      }
    } else {
      const normalizedEmail = (order.clientEmail || "").trim().toLowerCase();
      if (normalizedEmail) {
        const existingReferral = await db
          .select({ id: affiliateReferralsTable.id, convertedOrders: affiliateReferralsTable.convertedOrders })
          .from(affiliateReferralsTable)
          .where(
            and(
              eq(affiliateReferralsTable.tenantId, tenantId),
              eq(affiliateReferralsTable.affiliateUserId, affiliateUserId),
              eq(affiliateReferralsTable.referredEmail, normalizedEmail)
            )
          )
          .limit(1);

        if (existingReferral[0]) {
          await db
            .update(affiliateReferralsTable)
            .set({
              hasConverted: true,
              convertedOrders: Number(existingReferral[0].convertedOrders || 0) + 1,
              updatedAt: new Date(),
            })
            .where(eq(affiliateReferralsTable.id, existingReferral[0].id));
        }
      }
    }
  }

  return true;
}

export async function getAffiliateAvailableCreditByUserId(userId: string, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const affiliateRows = await db
    .select({ userId: affiliatesTable.userId })
    .from(affiliatesTable)
    .where(and(eq(affiliatesTable.tenantId, tenantId), eq(affiliatesTable.userId, userId)))
    .limit(1);

  if (!affiliateRows[0]) {
    return 0;
  }

  const releasedRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${affiliateCommissionsTable.commissionAmount}), 0)`,
    })
    .from(affiliateCommissionsTable)
    .where(
      and(
        eq(affiliateCommissionsTable.tenantId, tenantId),
        eq(affiliateCommissionsTable.affiliateUserId, userId),
        eq(affiliateCommissionsTable.status, "released"),
      )
    );

  const usedRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${affiliateCreditUsesTable.amount}), 0)`,
    })
    .from(affiliateCreditUsesTable)
    .where(and(eq(affiliateCreditUsesTable.tenantId, tenantId), eq(affiliateCreditUsesTable.affiliateUserId, userId)));

  const released = Number(releasedRows[0]?.total || 0);
  const used = Number(usedRows[0]?.total || 0);
  const available = released - used;

  if (!Number.isFinite(available) || available <= 0) {
    return 0;
  }

  return Math.round(available * 100) / 100;
}

export async function applyAffiliateCreditToOrder(input: {
  tenantId?: string;
  userId: string;
  orderId: string;
  requestedAmount: number;
}): Promise<number> {
  const tenantId = String(input.tenantId || "").trim() || DEFAULT_TENANT_ID;
  if (!input.userId) return 0;
  if (!Number.isFinite(input.requestedAmount) || input.requestedAmount <= 0) return 0;

  return db.transaction(async (tx) => {
    const affiliateRows = await tx
      .select({ userId: affiliatesTable.userId })
      .from(affiliatesTable)
      .where(and(eq(affiliatesTable.tenantId, tenantId), eq(affiliatesTable.userId, input.userId)))
      .limit(1);

    if (!affiliateRows[0]) {
      return 0;
    }

    await tx.execute(sql`SELECT user_id FROM affiliates WHERE tenant_id = ${tenantId} AND user_id = ${input.userId} FOR UPDATE`);

    const releasedRows = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${affiliateCommissionsTable.commissionAmount}), 0)`,
      })
      .from(affiliateCommissionsTable)
      .where(
        and(
          eq(affiliateCommissionsTable.tenantId, tenantId),
          eq(affiliateCommissionsTable.affiliateUserId, input.userId),
          eq(affiliateCommissionsTable.status, "released"),
        )
      );

    const usedRows = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${affiliateCreditUsesTable.amount}), 0)`,
      })
      .from(affiliateCreditUsesTable)
      .where(and(eq(affiliateCreditUsesTable.tenantId, tenantId), eq(affiliateCreditUsesTable.affiliateUserId, input.userId)));

    const released = Number(releasedRows[0]?.total || 0);
    const used = Number(usedRows[0]?.total || 0);
    const available = Math.max(0, released - used);
    const toApply = Math.min(available, input.requestedAmount);
    const rounded = Math.round(toApply * 100) / 100;

    if (rounded <= 0) {
      return 0;
    }

    await tx.insert(affiliateCreditUsesTable).values({
      id: randomId(),
      tenantId,
      affiliateUserId: input.userId,
      orderId: input.orderId,
      amount: rounded.toFixed(2),
      updatedAt: new Date(),
    });

    return rounded;
  });
}
