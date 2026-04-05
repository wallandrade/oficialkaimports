import crypto from "crypto";
import {
  affiliateCommissionsTable,
  affiliateReferralsTable,
  affiliatesTable,
  db,
  ordersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

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

export async function getOrCreateAffiliateByUserId(userId: string) {
  const existing = await db
    .select()
    .from(affiliatesTable)
    .where(eq(affiliatesTable.userId, userId))
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
      .where(eq(affiliatesTable.affiliateCode, candidate))
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
    userId,
    affiliateCode: createdCode,
    updatedAt: new Date(),
  };

  await db.insert(affiliatesTable).values(newAffiliate);

  const fresh = await db
    .select()
    .from(affiliatesTable)
    .where(eq(affiliatesTable.userId, userId))
    .limit(1);

  if (!fresh[0]) {
    throw new Error("Failed to create affiliate profile.");
  }

  return fresh[0];
}

export async function resolveAffiliateByCode(code: string) {
  const normalized = normalizeAffiliateCode(code);
  if (!normalized) return null;

  const rows = await db
    .select()
    .from(affiliatesTable)
    .where(eq(affiliatesTable.affiliateCode, normalized))
    .limit(1);

  return rows[0] || null;
}

export async function registerAffiliateLead(input: {
  affiliateUserId: string;
  referredUserId?: string | null;
  referredEmail?: string | null;
}) {
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
    affiliateUserId: input.affiliateUserId,
    referredUserId,
    referredEmail,
    updatedAt: new Date(),
  });
}

export async function ensureOrderCommission(orderId: string): Promise<boolean> {
  const orderRows = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      total: ordersTable.total,
      products: ordersTable.products,
      userId: ordersTable.userId,
      clientEmail: ordersTable.clientEmail,
      affiliateUserId: ordersTable.affiliateUserId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  const order = orderRows[0];
  if (!order) return false;

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

  const already = await db
    .select({ id: affiliateCommissionsTable.id })
    .from(affiliateCommissionsTable)
    .where(eq(affiliateCommissionsTable.orderId, order.id))
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
    affiliateUserId,
    orderId: order.id,
    referredUserId: order.userId || null,
    referredEmail: (order.clientEmail || "").trim().toLowerCase() || null,
    rate: COMMISSION_RATE.toFixed(4),
    baseAmount: baseAmount.toFixed(2),
    commissionAmount: commissionAmount.toFixed(2),
    status: "pending",
    updatedAt: new Date(),
  });

  if (order.userId || order.clientEmail) {
    await registerAffiliateLead({
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
