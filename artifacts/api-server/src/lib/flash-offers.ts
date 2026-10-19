import crypto from "crypto";
import {
  db,
  flashCampaignItemsTable,
  flashCampaignsTable,
  flashReservationsTable,
  flashVisitsTable,
  productsTable,
} from "@workspace/db";
import { and, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { parseVariantGroups } from "./product-variants";
import {
  flashLineQuantityError,
  isCampaignHourOpen,
  normalizeVisitorKey,
  rollDraw,
  saoPauloClock,
  saoPauloDayStart,
  unitPriceWithFlash,
  type FlashPriceHit,
} from "./flash-offers-core";

const RESERVATION_MS = 60 * 60 * 1000;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class FlashOfferError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "FlashOfferError";
    this.code = code;
    this.status = status;
  }
}

export type CheckoutFlashHit = FlashPriceHit & { reservationId: string };

function newId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function hashFlashIp(ip: string | null | undefined): string | null {
  const clean = String(ip || "").trim();
  if (!clean || clean.toUpperCase() === "IP_NAO_ENCONTRADO" || clean.toLowerCase() === "unknown") return null;
  return crypto.createHash("sha256").update(`flash-ip:${clean}`).digest("hex");
}

function productTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(productsTable.tenantId, tenantId), isNull(productsTable.tenantId), eq(productsTable.tenantId, ""));
  }
  return eq(productsTable.tenantId, tenantId);
}

function sellingPrice(product: { price: string; promoPrice: string | null; promoEndsAt: Date | null }): number {
  const regular = Number(product.price || 0);
  const promo = product.promoPrice == null ? null : Number(product.promoPrice);
  if (!Number.isFinite(promo) || promo == null || promo <= 0) return regular;
  if (product.promoEndsAt && new Date() > product.promoEndsAt) return regular;
  return promo;
}

function visitBlocks(visit: { outcome: string; createdAt: Date } | undefined, dayStart: Date): boolean {
  if (!visit) return false;
  if (visit.outcome === "seen") return true;
  return visit.createdAt >= dayStart;
}

async function findVisit(campaignId: string, visitorKey: string) {
  const [row] = await db
    .select()
    .from(flashVisitsTable)
    .where(and(eq(flashVisitsTable.campaignId, campaignId), eq(flashVisitsTable.visitorKey, visitorKey)))
    .limit(1);
  return row;
}

async function saveVisit(input: {
  tenantId: string;
  campaignId: string;
  visitorKey: string;
  customerUserId: string | null;
  ipHash: string | null;
  outcome: "seen" | "miss";
}): Promise<void> {
  const existing = await findVisit(input.campaignId, input.visitorKey);
  const now = new Date();
  if (existing) {
    await db
      .update(flashVisitsTable)
      .set({
        outcome: input.outcome,
        customerUserId: input.customerUserId || existing.customerUserId,
        ipHash: input.ipHash || existing.ipHash,
        createdAt: now,
      })
      .where(eq(flashVisitsTable.id, existing.id));
    return;
  }
  await db.insert(flashVisitsTable).values({
    id: newId(),
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    visitorKey: input.visitorKey,
    customerUserId: input.customerUserId,
    ipHash: input.ipHash,
    outcome: input.outcome,
    createdAt: now,
  });
}

async function activeReservationCount(campaignId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(flashReservationsTable)
    .where(and(
      eq(flashReservationsTable.campaignId, campaignId),
      eq(flashReservationsTable.status, "active"),
      gt(flashReservationsTable.expiresAt, now),
    ));
  return Number(row?.n || 0);
}

export async function drawFlashOffer(input: {
  tenantId: string;
  visitorKey: string;
  customerUserId: string | null;
  ipHash: string | null;
  random?: number;
}): Promise<{
  offer: null | {
    campaignId: string;
    productId: string;
    name: string;
    image: string | null;
    regularPrice: number;
    flashPrice: number;
    needsVariants: boolean;
  };
}> {
  const visitorKey = normalizeVisitorKey(input.visitorKey);
  if (!visitorKey) return { offer: null };

  const now = new Date();
  const clock = saoPauloClock(now);
  const dayStart = saoPauloDayStart(now);
  const campaigns = await db
    .select()
    .from(flashCampaignsTable)
    .where(and(eq(flashCampaignsTable.tenantId, input.tenantId), eq(flashCampaignsTable.isActive, true)));

  const open = campaigns.filter((campaign) => isCampaignHourOpen(campaign.activeFromHour, campaign.activeUntilHour, clock.hour));
  if (open.length === 0) return { offer: null };

  const picked = open[Math.floor((input.random ?? Math.random()) * open.length)] ?? open[0];
  if (!picked) return { offer: null };

  if (await activeReservationCount(picked.id, now) >= picked.slotLimit) return { offer: null };

  const visitorVisit = await findVisit(picked.id, visitorKey);
  if (visitBlocks(visitorVisit, dayStart)) return { offer: null };

  if (input.customerUserId) {
    const userVisits = await db
      .select()
      .from(flashVisitsTable)
      .where(and(
        eq(flashVisitsTable.campaignId, picked.id),
        eq(flashVisitsTable.customerUserId, input.customerUserId),
      ))
      .limit(8);
    if (userVisits.some((visit) => visitBlocks(visit, dayStart))) return { offer: null };
  }

  if (input.ipHash) {
    const [ipVisit] = await db
      .select()
      .from(flashVisitsTable)
      .where(and(
        eq(flashVisitsTable.campaignId, picked.id),
        eq(flashVisitsTable.ipHash, input.ipHash),
        gte(flashVisitsTable.createdAt, dayStart),
      ))
      .limit(1);
    if (ipVisit) return { offer: null };
  }

  const items = await db
    .select()
    .from(flashCampaignItemsTable)
    .where(eq(flashCampaignItemsTable.campaignId, picked.id));
  if (items.length === 0) return { offer: null };

  if (!rollDraw(picked.drawPercent, input.random ?? Math.random())) {
    await saveVisit({
      tenantId: input.tenantId,
      campaignId: picked.id,
      visitorKey,
      customerUserId: input.customerUserId,
      ipHash: input.ipHash,
      outcome: "miss",
    });
    return { offer: null };
  }

  const productIds = items.map((item) => item.productId);
  const products = await db
    .select()
    .from(productsTable)
    .where(and(productTenantWhere(input.tenantId), inArray(productsTable.id, productIds)));
  const byId = new Map(products.map((product) => [product.id, product]));
  const eligible = items.filter((item) => {
    const product = byId.get(item.productId);
    if (!product || product.isActive === false || product.isSoldOut === true) return false;
    const flashPrice = Number(item.flashPrice);
    const current = sellingPrice(product);
    return Number.isFinite(flashPrice) && flashPrice > 0 && flashPrice < current;
  });
  if (eligible.length === 0) return { offer: null };

  const item = eligible[Math.floor(Math.random() * eligible.length)]!;
  const product = byId.get(item.productId)!;
  await saveVisit({
    tenantId: input.tenantId,
    campaignId: picked.id,
    visitorKey,
    customerUserId: input.customerUserId,
    ipHash: input.ipHash,
    outcome: "seen",
  });

  return {
    offer: {
      campaignId: picked.id,
      productId: product.id,
      name: product.name,
      image: product.image ?? null,
      regularPrice: sellingPrice(product),
      flashPrice: Number(item.flashPrice),
      needsVariants: parseVariantGroups(product.variantGroups).length > 0,
    },
  };
}

export async function claimFlashOffer(input: {
  tenantId: string;
  visitorKey: string;
  customerUserId: string | null;
  campaignId: string;
  productId: string;
}): Promise<{ reservationId: string; expiresAt: string; productId: string; name: string; image: string | null; flashPrice: number; regularPrice: number; needsVariants: boolean }> {
  const visitorKey = normalizeVisitorKey(input.visitorKey);
  if (!visitorKey) throw new FlashOfferError("FLASH_VISITOR", "Não foi possível identificar esta visita.", 400);

  const now = new Date();
  const [campaign] = await db
    .select()
    .from(flashCampaignsTable)
    .where(and(
      eq(flashCampaignsTable.id, input.campaignId),
      eq(flashCampaignsTable.tenantId, input.tenantId),
      eq(flashCampaignsTable.isActive, true),
    ))
    .limit(1);
  if (!campaign) throw new FlashOfferError("FLASH_UNAVAILABLE", "Essa oferta não está mais disponível.");
  if (!isCampaignHourOpen(campaign.activeFromHour, campaign.activeUntilHour, saoPauloClock(now).hour)) {
    throw new FlashOfferError("FLASH_UNAVAILABLE", "Essa oferta não está mais disponível.");
  }

  const visit = await findVisit(campaign.id, visitorKey);
  if (!visit || visit.outcome !== "seen") {
    throw new FlashOfferError("FLASH_UNAVAILABLE", "Essa oferta não está mais disponível.");
  }

  const [item] = await db
    .select()
    .from(flashCampaignItemsTable)
    .where(and(
      eq(flashCampaignItemsTable.campaignId, campaign.id),
      eq(flashCampaignItemsTable.productId, input.productId),
    ))
    .limit(1);
  if (!item) throw new FlashOfferError("FLASH_UNAVAILABLE", "Essa oferta não está mais disponível.");

  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, item.productId), productTenantWhere(input.tenantId)))
    .limit(1);
  const flashPrice = Number(item.flashPrice);
  if (!product || product.isActive === false || product.isSoldOut === true || !(flashPrice > 0) || !(flashPrice < sellingPrice(product))) {
    throw new FlashOfferError("FLASH_UNAVAILABLE", "Essa oferta não está mais disponível.");
  }

  const [existing] = await db
    .select()
    .from(flashReservationsTable)
    .where(and(
      eq(flashReservationsTable.campaignId, campaign.id),
      eq(flashReservationsTable.visitorKey, visitorKey),
      eq(flashReservationsTable.status, "active"),
      gt(flashReservationsTable.expiresAt, now),
    ))
    .limit(1);
  if (existing && existing.productId === product.id) {
    return {
      reservationId: existing.id,
      expiresAt: existing.expiresAt.toISOString(),
      productId: product.id,
      name: product.name,
      image: product.image ?? null,
      flashPrice: Number(existing.unitPrice),
      regularPrice: sellingPrice(product),
      needsVariants: parseVariantGroups(product.variantGroups).length > 0,
    };
  }

  if (await activeReservationCount(campaign.id, now) >= campaign.slotLimit) {
    throw new FlashOfferError("SLOT_TAKEN", "Essa vaga já foi para outro cliente.");
  }

  const reservationId = newId();
  const expiresAt = new Date(now.getTime() + RESERVATION_MS);
  await db.insert(flashReservationsTable).values({
    id: reservationId,
    tenantId: input.tenantId,
    campaignId: campaign.id,
    visitorKey,
    customerUserId: input.customerUserId,
    productId: product.id,
    unitPrice: flashPrice.toFixed(2),
    status: "active",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  if (await activeReservationCount(campaign.id, now) > campaign.slotLimit) {
    await db
      .update(flashReservationsTable)
      .set({ status: "released", updatedAt: new Date() })
      .where(and(eq(flashReservationsTable.id, reservationId), eq(flashReservationsTable.status, "active")));
    throw new FlashOfferError("SLOT_TAKEN", "Essa vaga já foi para outro cliente.");
  }

  return {
    reservationId,
    expiresAt: expiresAt.toISOString(),
    productId: product.id,
    name: product.name,
    image: product.image ?? null,
    flashPrice,
    regularPrice: sellingPrice(product),
    needsVariants: parseVariantGroups(product.variantGroups).length > 0,
  };
}

export async function releaseFlashReservation(input: {
  tenantId: string;
  visitorKey: string;
  customerUserId: string | null;
  reservationId: string;
}): Promise<{ released: boolean }> {
  const visitorKey = normalizeVisitorKey(input.visitorKey);
  const [row] = await db
    .select()
    .from(flashReservationsTable)
    .where(and(
      eq(flashReservationsTable.id, input.reservationId),
      eq(flashReservationsTable.tenantId, input.tenantId),
    ))
    .limit(1);
  if (!row || row.status !== "active") return { released: false };
  const sameVisitor = visitorKey && row.visitorKey === visitorKey;
  const sameUser = !!input.customerUserId && row.customerUserId === input.customerUserId;
  if (!sameVisitor && !sameUser) return { released: false };
  await db
    .update(flashReservationsTable)
    .set({ status: "released", updatedAt: new Date() })
    .where(and(eq(flashReservationsTable.id, row.id), eq(flashReservationsTable.status, "active")));
  return { released: true };
}

function reservationMatches(row: { visitorKey: string; customerUserId: string | null }, visitorKey: string, customerUserId: string | null): boolean {
  if (visitorKey && row.visitorKey === visitorKey) return true;
  return !!customerUserId && row.customerUserId === customerUserId;
}

export async function resolveCheckoutFlash(input: {
  tenantId: string;
  reservationId: unknown;
  visitorKey: unknown;
  customerUserId: string | null;
  paymentMethod: string;
  couponCode: unknown;
  lines: Array<{ id?: string; quantity?: number; isBump?: boolean }>;
}): Promise<{ ok: true; hit: CheckoutFlashHit | null } | { ok: false; status: number; error: string; message: string }> {
  if (input.paymentMethod === "card_simulation") return { ok: true, hit: null };
  const reservationId = String(input.reservationId || "").trim();
  if (!reservationId) return { ok: true, hit: null };

  const now = new Date();
  const [row] = await db
    .select()
    .from(flashReservationsTable)
    .where(and(
      eq(flashReservationsTable.id, reservationId),
      eq(flashReservationsTable.tenantId, input.tenantId),
    ))
    .limit(1);
  const visitorKey = normalizeVisitorKey(input.visitorKey);
  if (!row || row.status !== "active" || row.expiresAt <= now || !reservationMatches(row, visitorKey, input.customerUserId)) {
    return { ok: false, status: 409, error: "FLASH_EXPIRED", message: "A promoção relâmpago expirou. O preço voltou ao normal." };
  }

  const coupon = String(input.couponCode || "").trim();
  if (coupon) {
    return { ok: false, status: 400, error: "FLASH_NO_COUPON", message: "A promoção relâmpago não combina com cupom." };
  }

  const quantityError = flashLineQuantityError({ flashProductId: row.productId, lines: input.lines });
  if (quantityError) return { ok: false, status: 400, error: "FLASH_QTY", message: quantityError };

  const inCart = input.lines.some((line) => line.isBump !== true && String(line.id || "").trim() === row.productId);
  if (!inCart) return { ok: true, hit: null };

  return {
    ok: true,
    hit: { reservationId: row.id, productId: row.productId, unitPrice: Number(row.unitPrice) },
  };
}

export { unitPriceWithFlash };

export async function consumeFlashReservation(tx: DbTransaction, reservationId: string, orderId: string): Promise<boolean> {
  const now = new Date();
  const result = await tx
    .update(flashReservationsTable)
    .set({ status: "used", orderId, updatedAt: now })
    .where(and(
      eq(flashReservationsTable.id, reservationId),
      eq(flashReservationsTable.status, "active"),
      gt(flashReservationsTable.expiresAt, now),
    ));
  const affected = (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
  return affected > 0;
}

export async function expireFlashReservations(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(flashReservationsTable)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(flashReservationsTable.status, "active"), lte(flashReservationsTable.expiresAt, now)));
  return (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}
