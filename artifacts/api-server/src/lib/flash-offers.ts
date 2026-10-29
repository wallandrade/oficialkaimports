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
import { getTenantSettingsMap } from "./envioecom-config";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { parseVariantGroups } from "./product-variants";
import {
  compareFlashCampaigns,
  isCampaignHourOpen,
  mergeFlashOffers,
  normalizeVisitorKey,
  rollDraw,
  saoPauloClock,
  saoPauloDayStart,
  unitPriceWithFlash,
  visitStillBlocks,
  type FlashPriceHit,
} from "./flash-offers-core";

const RESERVATION_MS = 60 * 60 * 1000;
export const FLASH_FORCE_FIRST_VISIT_KEY = "flash_force_first_visit";
const FLASH_FIRST_VISIT_CAMPAIGN_ID = "flash-first-visit";

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

function visitBlocks(visit: { outcome: string; createdAt: Date } | undefined, dayStart: Date, now: Date, repeatAfterHours: number): boolean {
  if (!visit) return false;
  return visitStillBlocks({
    outcome: visit.outcome,
    createdAt: visit.createdAt,
    now,
    repeatAfterHours,
    dayStart,
  });
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

export type DrawnFlashOffer = {
  campaignId: string;
  productId: string;
  name: string;
  image: string | null;
  regularPrice: number;
  flashPrice: number;
  needsVariants: boolean;
};

function emptyFlashDraw(): { offers: DrawnFlashOffer[]; offer: DrawnFlashOffer | null } {
  return { offers: [], offer: null };
}

export async function isFlashForceFirstVisit(tenantId: string): Promise<boolean> {
  const settings = await getTenantSettingsMap(tenantId);
  return String(settings[FLASH_FORCE_FIRST_VISIT_KEY] || "").trim() === "1";
}

function visitTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(flashVisitsTable.tenantId, tenantId), isNull(flashVisitsTable.tenantId), eq(flashVisitsTable.tenantId, ""));
  }
  return eq(flashVisitsTable.tenantId, tenantId);
}

async function hasFirstVisitMark(tenantId: string, visitorKey: string, customerUserId: string | null): Promise<boolean> {
  const [byVisitor] = await db
    .select({ id: flashVisitsTable.id })
    .from(flashVisitsTable)
    .where(and(
      eq(flashVisitsTable.campaignId, FLASH_FIRST_VISIT_CAMPAIGN_ID),
      eq(flashVisitsTable.visitorKey, visitorKey),
      visitTenantWhere(tenantId),
    ))
    .limit(1);
  if (byVisitor) return true;
  if (!customerUserId) return false;
  const [byAccount] = await db
    .select({ id: flashVisitsTable.id })
    .from(flashVisitsTable)
    .where(and(
      eq(flashVisitsTable.campaignId, FLASH_FIRST_VISIT_CAMPAIGN_ID),
      eq(flashVisitsTable.customerUserId, customerUserId),
      visitTenantWhere(tenantId),
    ))
    .limit(1);
  return Boolean(byAccount);
}

async function campaignOffers(tenantId: string, campaignId: string, productIds?: ReadonlySet<string>): Promise<DrawnFlashOffer[]> {
  const items = await db
    .select()
    .from(flashCampaignItemsTable)
    .where(eq(flashCampaignItemsTable.campaignId, campaignId));
  const selected = productIds ? items.filter((item) => productIds.has(item.productId)) : items;
  if (selected.length === 0) return [];
  const products = await db
    .select()
    .from(productsTable)
    .where(and(productTenantWhere(tenantId), inArray(productsTable.id, selected.map((item) => item.productId))));
  const byId = new Map(products.map((product) => [product.id, product]));
  const eligible = selected
    .filter((item) => {
      const product = byId.get(item.productId);
      if (!product || product.isActive === false || product.isSoldOut === true) return false;
      const flashPrice = Number(item.flashPrice);
      const current = sellingPrice(product);
      return Number.isFinite(flashPrice) && flashPrice > 0 && flashPrice < current;
    })
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const offers: DrawnFlashOffer[] = [];
  for (const item of eligible) {
    const product = byId.get(item.productId);
    if (!product) continue;
    offers.push({
      campaignId,
      productId: product.id,
      name: product.name,
      image: product.image ?? null,
      regularPrice: sellingPrice(product),
      flashPrice: Number(item.flashPrice),
      needsVariants: parseVariantGroups(product.variantGroups).length > 0,
    });
  }
  return offers;
}

async function drawAlwaysShowOffers(input: { tenantId: string }): Promise<DrawnFlashOffer[]> {
  const now = new Date();
  const hour = saoPauloClock(now).hour;
  const campaigns = await db
    .select()
    .from(flashCampaignsTable)
    .where(and(eq(flashCampaignsTable.tenantId, input.tenantId), eq(flashCampaignsTable.isActive, true)));
  const offers: DrawnFlashOffer[] = [];
  for (const campaign of campaigns.sort(compareFlashCampaigns)) {
    if (!isCampaignHourOpen(campaign.activeFromHour, campaign.activeUntilHour, hour)) continue;
    if (await activeReservationCount(campaign.id, now) >= campaign.slotLimit) continue;
    const items = await db
      .select({ productId: flashCampaignItemsTable.productId })
      .from(flashCampaignItemsTable)
      .where(and(eq(flashCampaignItemsTable.campaignId, campaign.id), eq(flashCampaignItemsTable.alwaysShow, true)));
    if (items.length === 0) continue;
    offers.push(...await campaignOffers(input.tenantId, campaign.id, new Set(items.map((item) => item.productId))));
  }
  return offers;
}

async function drawFirstVisitOffers(input: {
  tenantId: string;
  visitorKey: string;
  customerUserId: string | null;
  ipHash: string | null;
}): Promise<{ offers: DrawnFlashOffer[]; offer: DrawnFlashOffer | null }> {
  if (await hasFirstVisitMark(input.tenantId, input.visitorKey, input.customerUserId)) {
    const alwaysOffers = await drawAlwaysShowOffers({ tenantId: input.tenantId });
    return { offers: alwaysOffers, offer: alwaysOffers[0] ?? null };
  }

  const campaigns = await db
    .select()
    .from(flashCampaignsTable)
    .where(and(eq(flashCampaignsTable.tenantId, input.tenantId), eq(flashCampaignsTable.isActive, true)));
  const ordered = campaigns.sort(compareFlashCampaigns);
  const offers: DrawnFlashOffer[] = [];
  for (const campaign of ordered) {
    const rows = await db
      .select({ productId: flashCampaignItemsTable.productId, alwaysShow: flashCampaignItemsTable.alwaysShow })
      .from(flashCampaignItemsTable)
      .where(eq(flashCampaignItemsTable.campaignId, campaign.id));
    const alwaysIds = new Set(rows.filter((item) => item.alwaysShow).map((item) => item.productId));
    const regularIds = new Set(rows.filter((item) => !item.alwaysShow).map((item) => item.productId));
    const alwaysBuilt = alwaysIds.size > 0
      ? await campaignOffers(input.tenantId, campaign.id, alwaysIds)
      : [];
    let regularBuilt: DrawnFlashOffer[] = [];
    if (regularIds.size > 0) {
      regularBuilt = await campaignOffers(input.tenantId, campaign.id, regularIds);
      if (regularBuilt.length > 0) {
        await saveVisit({
          tenantId: input.tenantId,
          campaignId: campaign.id,
          visitorKey: input.visitorKey,
          customerUserId: input.customerUserId,
          ipHash: input.ipHash,
          outcome: "seen",
        });
      }
    }
    offers.push(...mergeFlashOffers(alwaysBuilt, regularBuilt));
  }
  if (offers.length === 0) return emptyFlashDraw();
  await saveFirstVisitMark(input);
  return { offers, offer: offers[0] ?? null };
}

async function saveFirstVisitMark(input: {
  tenantId: string;
  visitorKey: string;
  customerUserId: string | null;
  ipHash: string | null;
}): Promise<void> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(flashVisitsTable)
    .where(and(
      eq(flashVisitsTable.campaignId, FLASH_FIRST_VISIT_CAMPAIGN_ID),
      eq(flashVisitsTable.visitorKey, input.visitorKey),
      visitTenantWhere(input.tenantId),
    ))
    .limit(1);
  if (existing) {
    await db
      .update(flashVisitsTable)
      .set({
        outcome: "seen",
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
    campaignId: FLASH_FIRST_VISIT_CAMPAIGN_ID,
    visitorKey: input.visitorKey,
    customerUserId: input.customerUserId,
    ipHash: input.ipHash,
    outcome: "seen",
    createdAt: now,
  });
}

export async function drawFlashOffer(input: {
  tenantId: string;
  visitorKey: string;
  customerUserId: string | null;
  ipHash: string | null;
  random?: number;
}): Promise<{ offers: DrawnFlashOffer[]; offer: DrawnFlashOffer | null }> {
  const visitorKey = normalizeVisitorKey(input.visitorKey);
  if (!visitorKey) return emptyFlashDraw();
  if (await isFlashForceFirstVisit(input.tenantId)) {
    return drawFirstVisitOffers({
      tenantId: input.tenantId,
      visitorKey,
      customerUserId: input.customerUserId,
      ipHash: input.ipHash,
    });
  }

  const now = new Date();
  const clock = saoPauloClock(now);
  const dayStart = saoPauloDayStart(now);
  const campaigns = await db
    .select()
    .from(flashCampaignsTable)
    .where(and(eq(flashCampaignsTable.tenantId, input.tenantId), eq(flashCampaignsTable.isActive, true)));

  const open = campaigns
    .filter((campaign) => isCampaignHourOpen(campaign.activeFromHour, campaign.activeUntilHour, clock.hour))
    .sort(compareFlashCampaigns);
  if (open.length === 0) return emptyFlashDraw();

  const offers: DrawnFlashOffer[] = [];
  for (const picked of open) {
    if (await activeReservationCount(picked.id, now) >= picked.slotLimit) continue;

    const items = await db
      .select()
      .from(flashCampaignItemsTable)
      .where(eq(flashCampaignItemsTable.campaignId, picked.id));
    if (items.length === 0) continue;
    const alwaysIds = new Set(items.filter((item) => Boolean(item.alwaysShow)).map((item) => item.productId));
    const alwaysOffers = alwaysIds.size > 0
      ? await campaignOffers(input.tenantId, picked.id, alwaysIds)
      : [];

    let regularOffers: DrawnFlashOffer[] = [];
    const hasRegular = items.some((item) => !item.alwaysShow);
    if (hasRegular) {
      let blocked = visitBlocks(await findVisit(picked.id, visitorKey), dayStart, now, picked.repeatAfterHours);
      if (!blocked && input.customerUserId) {
        const userVisits = await db
          .select()
          .from(flashVisitsTable)
          .where(and(
            eq(flashVisitsTable.campaignId, picked.id),
            eq(flashVisitsTable.customerUserId, input.customerUserId),
          ))
          .limit(8);
        blocked = userVisits.some((visit) => visitBlocks(visit, dayStart, now, picked.repeatAfterHours));
      }
      if (!blocked && input.ipHash) {
        const ipSince = picked.repeatAfterHours > 0
          ? new Date(now.getTime() - picked.repeatAfterHours * 60 * 60 * 1000)
          : dayStart;
        const [ipVisit] = await db
          .select()
          .from(flashVisitsTable)
          .where(and(
            eq(flashVisitsTable.campaignId, picked.id),
            eq(flashVisitsTable.ipHash, input.ipHash),
            gte(flashVisitsTable.createdAt, ipSince),
          ))
          .limit(1);
        blocked = Boolean(ipVisit);
      }
      if (!blocked) {
        if (!rollDraw(picked.drawPercent, input.random ?? Math.random())) {
          await saveVisit({
            tenantId: input.tenantId,
            campaignId: picked.id,
            visitorKey,
            customerUserId: input.customerUserId,
            ipHash: input.ipHash,
            outcome: "miss",
          });
        } else {
          const regularIds = new Set(items.filter((item) => !item.alwaysShow).map((item) => item.productId));
          regularOffers = await campaignOffers(input.tenantId, picked.id, regularIds);
          if (regularOffers.length > 0) {
            await saveVisit({
              tenantId: input.tenantId,
              campaignId: picked.id,
              visitorKey,
              customerUserId: input.customerUserId,
              ipHash: input.ipHash,
              outcome: "seen",
            });
          }
        }
      }
    }

    offers.push(...mergeFlashOffers(alwaysOffers, regularOffers));
  }

  return { offers, offer: offers[0] ?? null };
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
  const forceFirstVisit = await isFlashForceFirstVisit(input.tenantId);

  const [item] = await db
    .select()
    .from(flashCampaignItemsTable)
    .where(and(
      eq(flashCampaignItemsTable.campaignId, campaign.id),
      eq(flashCampaignItemsTable.productId, input.productId),
    ))
    .limit(1);
  if (!item) throw new FlashOfferError("FLASH_UNAVAILABLE", "Essa oferta não está mais disponível.");
  const alwaysShow = Boolean(item.alwaysShow);
  const hourOpen = isCampaignHourOpen(campaign.activeFromHour, campaign.activeUntilHour, saoPauloClock(now).hour);
  if (alwaysShow && !hourOpen) throw new FlashOfferError("FLASH_UNAVAILABLE", "Essa oferta não está mais disponível.");
  if (!alwaysShow && !forceFirstVisit && !hourOpen) {
    throw new FlashOfferError("FLASH_UNAVAILABLE", "Essa oferta não está mais disponível.");
  }

  const visit = await findVisit(campaign.id, visitorKey);
  if (!alwaysShow && (!visit || visit.outcome !== "seen")) {
    throw new FlashOfferError("FLASH_UNAVAILABLE", "Essa oferta não está mais disponível.");
  }

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

  if ((alwaysShow || !forceFirstVisit) && await activeReservationCount(campaign.id, now) >= campaign.slotLimit) {
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

  if ((alwaysShow || !forceFirstVisit) && await activeReservationCount(campaign.id, now) > campaign.slotLimit) {
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

function readReservationIds(reservationId: unknown, reservationIds: unknown): string[] {
  const many = Array.isArray(reservationIds) ? reservationIds : [];
  const ids = [...many, reservationId].map((value) => String(value || "").trim()).filter(Boolean);
  return [...new Set(ids)];
}

export async function resolveCheckoutFlash(input: {
  tenantId: string;
  reservationId: unknown;
  reservationIds?: unknown;
  visitorKey: unknown;
  customerUserId: string | null;
  paymentMethod: string;
  couponCode: unknown;
  lines: Array<{ id?: string; quantity?: number; isBump?: boolean }>;
}): Promise<{ ok: true; hits: CheckoutFlashHit[] } | { ok: false; status: number; error: string; message: string }> {
  if (input.paymentMethod === "card_simulation") return { ok: true, hits: [] };
  const reservationIds = readReservationIds(input.reservationId, input.reservationIds);
  if (reservationIds.length === 0) return { ok: true, hits: [] };

  const coupon = String(input.couponCode || "").trim();
  if (coupon) {
    return { ok: false, status: 400, error: "FLASH_NO_COUPON", message: "A promoção relâmpago não combina com cupom." };
  }

  const now = new Date();
  const visitorKey = normalizeVisitorKey(input.visitorKey);
  const hits: CheckoutFlashHit[] = [];
  for (const reservationId of reservationIds) {
    const [row] = await db
      .select()
      .from(flashReservationsTable)
      .where(and(
        eq(flashReservationsTable.id, reservationId),
        eq(flashReservationsTable.tenantId, input.tenantId),
      ))
      .limit(1);
    if (!row || row.status !== "active" || row.expiresAt <= now || !reservationMatches(row, visitorKey, input.customerUserId)) {
      return { ok: false, status: 409, error: "FLASH_EXPIRED", message: "A promoção relâmpago expirou. O preço voltou ao normal." };
    }

    const inCart = input.lines.some((line) => line.isBump !== true && String(line.id || "").trim() === row.productId);
    if (!inCart) continue;
    hits.push({ reservationId: row.id, productId: row.productId, unitPrice: Number(row.unitPrice) });
  }

  return { ok: true, hits };
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
