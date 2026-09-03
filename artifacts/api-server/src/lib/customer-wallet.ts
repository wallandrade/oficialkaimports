import crypto from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { customerWalletLedgerTable, db, ordersTable } from "@workspace/db";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { parseInsurancePlan } from "./checkout-insurance";
import { parseInsuranceClaimStatus } from "./insurance-claims-policy";

export type WalletLedgerType = "insurance_cashback" | "product_refund" | "store_credit_use" | "admin_adjust";

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export async function getWalletBalance(userId: string, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${customerWalletLedgerTable.amount}), 0)`,
    })
    .from(customerWalletLedgerTable)
    .where(and(eq(customerWalletLedgerTable.tenantId, tenantId), eq(customerWalletLedgerTable.userId, userId)));

  return roundMoney(Number(rows[0]?.total || 0));
}

export async function listWalletEntries(userId: string, tenantId = DEFAULT_TENANT_ID, limit = 50) {
  const rows = await db
    .select()
    .from(customerWalletLedgerTable)
    .where(and(eq(customerWalletLedgerTable.tenantId, tenantId), eq(customerWalletLedgerTable.userId, userId)))
    .orderBy(desc(customerWalletLedgerTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    type: row.type,
    amount: Number(row.amount),
    note: row.note,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function creditWallet(input: {
  tenantId: string;
  userId: string;
  amount: number;
  type: WalletLedgerType;
  orderId?: string | null;
  note?: string | null;
}): Promise<number> {
  const amount = roundMoney(input.amount);
  if (amount === 0 || !input.userId) return 0;
  if (input.type !== "admin_adjust" && input.type !== "store_credit_use" && amount < 0) return 0;

  await db.insert(customerWalletLedgerTable).values({
    id: crypto.randomBytes(8).toString("hex"),
    tenantId: input.tenantId,
    userId: input.userId,
    orderId: input.orderId || null,
    type: input.type,
    amount: String(amount),
    note: input.note || null,
  });

  return amount;
}

export async function applyStoreCreditToOrder(input: {
  tenantId: string;
  userId: string;
  orderId: string;
  requestedAmount: number;
}): Promise<number> {
  const requested = roundMoney(input.requestedAmount);
  if (requested <= 0 || !input.userId) return 0;

  const available = await getWalletBalance(input.userId, input.tenantId);
  const toApply = roundMoney(Math.min(available, requested));
  if (toApply <= 0) return 0;

  await db.insert(customerWalletLedgerTable).values({
    id: crypto.randomBytes(8).toString("hex"),
    tenantId: input.tenantId,
    userId: input.userId,
    orderId: input.orderId,
    type: "store_credit_use",
    amount: String(-toApply),
    note: `Abatimento no pedido ${input.orderId}`,
  });

  return toApply;
}

export async function grantInsuranceCashbackIfEligible(order: typeof ordersTable.$inferSelect): Promise<boolean> {
  const tenantId = order.tenantId || DEFAULT_TENANT_ID;
  const plan = parseInsurancePlan(order.includeInsurance, order.insurancePlan);
  const claimStatus = parseInsuranceClaimStatus(order.insuranceClaimStatus);
  const cashbackAmount = roundMoney(Number(order.insuranceCashbackAmount || 0));
  const alreadyGranted = Boolean(order.insuranceCashbackGranted);
  const isChild = Boolean(String(order.parentOrderId || "").trim());

  if (
    plan !== "full"
    || !order.userId
    || isChild
    || alreadyGranted
    || claimStatus !== "none"
    || cashbackAmount <= 0
  ) {
    return false;
  }

  await creditWallet({
    tenantId,
    userId: order.userId,
    amount: cashbackAmount,
    type: "insurance_cashback",
    orderId: order.id,
    note: "Cashback do seguro completo na entrega",
  });

  await db
    .update(ordersTable)
    .set({ insuranceCashbackGranted: true, updatedAt: new Date() })
    .where(eq(ordersTable.id, order.id));

  return true;
}

export async function creditProductRefund(input: {
  tenantId: string;
  userId: string | null | undefined;
  orderId: string;
  subtotal: number;
}): Promise<number> {
  if (!input.userId) return 0;
  const amount = roundMoney(input.subtotal);
  if (amount <= 0) return 0;
  return creditWallet({
    tenantId: input.tenantId,
    userId: input.userId,
    amount,
    type: "product_refund",
    orderId: input.orderId,
    note: "Estorno do subtotal (seguro não volta)",
  });
}
