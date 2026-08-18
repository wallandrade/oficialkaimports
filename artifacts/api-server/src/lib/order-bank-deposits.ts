import crypto from "crypto";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, orderBankDepositsTable, ordersTable, type OrderBankDeposit } from "@workspace/db";
import { centsToAmountString, moneyToCents } from "./order-bank-deposits-math";

export { centsToAmountString, depositLinkRequiresNote, moneyToCents } from "./order-bank-deposits-math";

export async function listDepositsForOrder(orderId: string): Promise<OrderBankDeposit[]> {
  return db
    .select()
    .from(orderBankDepositsTable)
    .where(eq(orderBankDepositsTable.orderId, orderId));
}

export async function listDepositsForOrders(orderIds: string[]): Promise<Map<string, OrderBankDeposit[]>> {
  const map = new Map<string, OrderBankDeposit[]>();
  if (!orderIds.length) return map;
  const rows = await db
    .select()
    .from(orderBankDepositsTable)
    .where(inArray(orderBankDepositsTable.orderId, orderIds));
  for (const row of rows) {
    const list = map.get(row.orderId) || [];
    list.push(row);
    map.set(row.orderId, list);
  }
  return map;
}

export async function findDepositByFitid(fitid: string): Promise<OrderBankDeposit | null> {
  const rows = await db
    .select()
    .from(orderBankDepositsTable)
    .where(eq(orderBankDepositsTable.fitid, fitid))
    .limit(1);
  return rows[0] || null;
}

export async function listUsedFitids(tenantWhere: SQL | undefined): Promise<Set<string>> {
  const fromTable = await db.select({ fitid: orderBankDepositsTable.fitid }).from(orderBankDepositsTable);
  const fromOrders = await db
    .select({ fitid: ordersTable.bankDepositFitid })
    .from(ordersTable)
    .where(
      and(
        tenantWhere,
        isNotNull(ordersTable.bankDepositFitid),
        or(eq(ordersTable.bankDepositMatchStatus, "ok"), eq(ordersTable.bankDepositMatchStatus, "confirmed_100")),
      ),
    );
  const used = new Set<string>();
  for (const row of fromTable) {
    const fitid = String(row.fitid || "").trim();
    if (fitid) used.add(fitid);
  }
  for (const row of fromOrders) {
    const fitid = String(row.fitid || "").trim();
    if (fitid) used.add(fitid);
  }
  return used;
}

export async function ensureOrderDepositsMirrored(order: {
  id: string;
  tenantId?: string | null;
  bankDepositFitid?: string | null;
  bankDepositAmount?: unknown;
  bankDepositPayerName?: string | null;
  bankDepositPostedAt?: string | null;
  bankDepositMatchStatus?: string | null;
}): Promise<OrderBankDeposit[]> {
  const existing = await listDepositsForOrder(order.id);
  if (existing.length) return existing;
  const fitid = String(order.bankDepositFitid || "").trim();
  const status = String(order.bankDepositMatchStatus || "").trim();
  if (!fitid || (status !== "ok" && status !== "confirmed_100")) return existing;
  await insertOrderDeposit({
    tenantId: order.tenantId ?? null,
    orderId: order.id,
    fitid,
    amount: Number(order.bankDepositAmount) || 0,
    payerName: order.bankDepositPayerName ?? null,
    postedAt: order.bankDepositPostedAt ?? null,
    matchStatus: status as "ok" | "confirmed_100",
  });
  return listDepositsForOrder(order.id);
}

export async function insertOrderDeposit(params: {
  tenantId: string | null;
  orderId: string;
  fitid: string;
  amount: number;
  payerName: string | null;
  postedAt: string | null;
  matchStatus: "ok" | "confirmed_100";
  note?: string | null;
}): Promise<void> {
  await db.insert(orderBankDepositsTable).values({
    id: `obd_${crypto.randomBytes(8).toString("hex")}`,
    tenantId: params.tenantId,
    orderId: params.orderId,
    fitid: params.fitid,
    amount: centsToAmountString(moneyToCents(params.amount)),
    payerName: params.payerName,
    postedAt: params.postedAt,
    matchStatus: params.matchStatus,
    note: params.note || null,
  });
}

export async function deleteOrderDeposits(orderId: string, fitid?: string): Promise<number> {
  const where = fitid
    ? and(eq(orderBankDepositsTable.orderId, orderId), eq(orderBankDepositsTable.fitid, fitid))
    : eq(orderBankDepositsTable.orderId, orderId);
  const result = await db.delete(orderBankDepositsTable).where(where);
  return Number((result as { rowsAffected?: number } | undefined)?.rowsAffected || 0);
}

export async function syncOrderDepositSummary(params: {
  orderId: string;
  tenantWhere: SQL | undefined;
  orderTotal: unknown;
}): Promise<{ count: number; sumCents: number; matchStatus: "ok" | "confirmed_100" | null }> {
  const links = await listDepositsForOrder(params.orderId);
  if (!links.length) {
    await db
      .update(ordersTable)
      .set({
        bankDepositMatchStatus: null,
        bankDepositFitid: null,
        bankDepositAmount: null,
        bankDepositPayerName: null,
        bankDepositPostedAt: null,
        bankDepositMatchedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(ordersTable.id, params.orderId), params.tenantWhere));
    return { count: 0, sumCents: 0, matchStatus: null };
  }

  const sorted = [...links].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  const latest = sorted[0]!;
  const sumCents = links.reduce((acc, row) => acc + moneyToCents(row.amount), 0);
  const names = [...new Set(links.map((row) => String(row.payerName || "").trim()).filter(Boolean))];
  const orderCents = moneyToCents(params.orderTotal);
  const singleConfirmed =
    links.length === 1 &&
    links[0]!.matchStatus === "confirmed_100" &&
    moneyToCents(links[0]!.amount) === orderCents;
  const matchStatus = singleConfirmed ? "confirmed_100" : "ok";

  await db
    .update(ordersTable)
    .set({
      bankDepositMatchStatus: matchStatus,
      bankDepositFitid: latest.fitid,
      bankDepositAmount: centsToAmountString(sumCents),
      bankDepositPayerName: names.join(" · ").slice(0, 255) || null,
      bankDepositPostedAt: latest.postedAt || null,
      bankDepositMatchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(ordersTable.id, params.orderId), params.tenantWhere));

  return { count: links.length, sumCents, matchStatus };
}
