import { Router, type IRouter, type Response } from "express";
import crypto from "crypto";
import {
  db,
  flashCampaignItemsTable,
  flashCampaignsTable,
  flashReservationsTable,
  flashVisitsTable,
  productsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";
import { getCustomerSession } from "../middlewares/customer-auth";
import {
  claimFlashOffer,
  drawFlashOffer,
  FlashOfferError,
  hashFlashIp,
  releaseFlashReservation,
} from "../lib/flash-offers";
import { normalizeHour, normalizeVisitorKey } from "../lib/flash-offers-core";
import { ensureFlashOfferSchema } from "../runtime-schema";

const router: IRouter = Router();

function requestIp(req: { ip?: string; headers?: Record<string, unknown> }): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = String(raw || "").split(",")[0]?.trim();
  return first || String(req.ip || "").trim();
}

function flashErrorMessage(err: unknown, fallback: string): string {
  const error = err as { code?: string; message?: string } | null;
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code === "ER_NO_SUCH_TABLE" || message.toLowerCase().includes("doesn't exist")) {
    return "A tabela da promoção ainda não existe no banco. Clique de novo. Se continuar, reinicie a API.";
  }
  if (message) return `${fallback} ${message}`.slice(0, 240);
  return fallback;
}

async function readyFlashSchema(res: Response): Promise<boolean> {
  try {
    await ensureFlashOfferSchema();
    return true;
  } catch (err) {
    console.error("[FlashOffer] schema:", err);
    res.status(500).json({ error: "SCHEMA", message: flashErrorMessage(err, "Não foi possível preparar a promoção.") });
    return false;
  }
}

function canManageFlash(scope: ReturnType<typeof getAdminScope>): boolean {
  if (!scope) return false;
  return scope.isPrimary || scope.tenantId !== DEFAULT_TENANT_ID;
}

function readVisitor(body: unknown): string {
  const record = body && typeof body === "object" ? body as { visitorId?: unknown } : {};
  return normalizeVisitorKey(record.visitorId);
}

router.post("/flash-offers/draw", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req);
    const visitorKey = readVisitor(req.body);
    if (!visitorKey) {
      res.json({ offer: null });
      return;
    }
    const session = getCustomerSession(req);
    const drawn = await drawFlashOffer({
      tenantId,
      visitorKey,
      customerUserId: session?.userId ?? null,
      ipHash: hashFlashIp(requestIp(req)),
    });
    res.json(drawn);
  } catch (err) {
    console.error("[FlashOffer] draw:", err);
    res.json({ offer: null });
  }
});

router.post("/flash-offers/claim", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req);
    const session = getCustomerSession(req);
    const claimed = await claimFlashOffer({
      tenantId,
      visitorKey: readVisitor(req.body),
      customerUserId: session?.userId ?? null,
      campaignId: String(req.body?.campaignId || "").trim(),
      productId: String(req.body?.productId || "").trim(),
    });
    res.json(claimed);
  } catch (err) {
    if (err instanceof FlashOfferError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    console.error("[FlashOffer] claim:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Não foi possível reservar a oferta." });
  }
});

router.post("/flash-offers/release", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req);
    const session = getCustomerSession(req);
    const result = await releaseFlashReservation({
      tenantId,
      visitorKey: readVisitor(req.body),
      customerUserId: session?.userId ?? null,
      reservationId: String(req.body?.reservationId || "").trim(),
    });
    res.json(result);
  } catch (err) {
    console.error("[FlashOffer] release:", err);
    res.json({ released: false });
  }
});

type ItemInput = { productId?: unknown; flashPrice?: unknown };

function productTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(productsTable.tenantId, tenantId), isNull(productsTable.tenantId), eq(productsTable.tenantId, ""));
  }
  return eq(productsTable.tenantId, tenantId);
}

async function assertCheaperThanCatalog(tenantId: string, items: Array<{ productId: string; flashPrice: number }>): Promise<string | null> {
  const rows = await db
    .select({ id: productsTable.id, name: productsTable.name, price: productsTable.price })
    .from(productsTable)
    .where(and(productTenantWhere(tenantId), inArray(productsTable.id, items.map((item) => item.productId))));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) return "Um dos produtos não está nesta loja.";
    if (!(item.flashPrice < Number(product.price))) return `${product.name} precisa ficar abaixo do preço da loja.`;
  }
  return null;
}

function normalizeItems(raw: unknown): Array<{ productId: string; flashPrice: number }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: Array<{ productId: string; flashPrice: number }> = [];
  for (const entry of raw as ItemInput[]) {
    const productId = String(entry?.productId || "").trim();
    const flashPrice = Number(entry?.flashPrice);
    if (!productId || seen.has(productId)) continue;
    if (!Number.isFinite(flashPrice) || flashPrice <= 0) continue;
    seen.add(productId);
    items.push({ productId, flashPrice: Math.round(flashPrice * 100) / 100 });
  }
  return items;
}

router.get("/admin/flash-campaigns", requireAdminAuth, async (req, res) => {
  try {
    if (!(await readyFlashSchema(res))) return;
    const scope = getAdminScope(req);
    if (!canManageFlash(scope)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para promoções." });
      return;
    }
    const tenantId = scope?.tenantId || DEFAULT_TENANT_ID;
    const campaigns = await db
      .select()
      .from(flashCampaignsTable)
      .where(eq(flashCampaignsTable.tenantId, tenantId));
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const items = campaignIds.length
      ? await db.select().from(flashCampaignItemsTable).where(inArray(flashCampaignItemsTable.campaignId, campaignIds))
      : [];
    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = productIds.length
      ? await db.select().from(productsTable).where(and(productTenantWhere(tenantId), inArray(productsTable.id, productIds)))
      : [];
    const productById = new Map(products.map((product) => [product.id, product]));
    const reservations = campaignIds.length
      ? await db.select().from(flashReservationsTable).where(inArray(flashReservationsTable.campaignId, campaignIds))
      : [];
    const visits = campaignIds.length
      ? await db
        .select({
          campaignId: flashVisitsTable.campaignId,
          outcome: flashVisitsTable.outcome,
          n: sql<number>`count(*)`,
        })
        .from(flashVisitsTable)
        .where(inArray(flashVisitsTable.campaignId, campaignIds))
        .groupBy(flashVisitsTable.campaignId, flashVisitsTable.outcome)
      : [];

    res.json({
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        isActive: campaign.isActive,
        slotLimit: campaign.slotLimit,
        drawPercent: campaign.drawPercent,
        activeFromHour: campaign.activeFromHour,
        activeUntilHour: campaign.activeUntilHour,
        items: items
          .filter((item) => item.campaignId === campaign.id)
          .map((item) => {
            const product = productById.get(item.productId);
            return {
              id: item.id,
              productId: item.productId,
              name: product?.name || "Produto removido",
              image: product?.image ?? null,
              regularPrice: product ? Number(product.price) : null,
              flashPrice: Number(item.flashPrice),
            };
          }),
        activeReservations: reservations.filter((row) => row.campaignId === campaign.id && row.status === "active" && row.expiresAt > new Date()).length,
        usedReservations: reservations.filter((row) => row.campaignId === campaign.id && row.status === "used").length,
        seenCount: Number(visits.find((row) => row.campaignId === campaign.id && row.outcome === "seen")?.n || 0),
      })),
    });
  } catch (err) {
    console.error("[FlashOffer] list:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: flashErrorMessage(err, "Erro ao listar promoções.") });
  }
});

router.post("/admin/flash-campaigns", requireAdminAuth, async (req, res) => {
  try {
    if (!(await readyFlashSchema(res))) return;
    const scope = getAdminScope(req);
    if (!canManageFlash(scope)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para promoções." });
      return;
    }
    const tenantId = scope?.tenantId || DEFAULT_TENANT_ID;
    const name = String(req.body?.name || "").trim() || "Promoção relâmpago";
    const slotLimit = Math.min(500, Math.max(1, Math.round(Number(req.body?.slotLimit) || 5)));
    const drawPercent = Math.min(100, Math.max(1, Math.round(Number(req.body?.drawPercent) || 25)));
    const items = normalizeItems(req.body?.items);
    if (items.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Escolha ao menos um produto com preço." });
      return;
    }
    const priceError = await assertCheaperThanCatalog(tenantId, items);
    if (priceError) {
      res.status(400).json({ error: "INVALID_INPUT", message: priceError });
      return;
    }
    const id = crypto.randomBytes(8).toString("hex");
    const now = new Date();
    await db.insert(flashCampaignsTable).values({
      id,
      tenantId,
      name,
      isActive: req.body?.isActive !== false,
      slotLimit,
      drawPercent,
      activeFromHour: normalizeHour(req.body?.activeFromHour),
      activeUntilHour: normalizeHour(req.body?.activeUntilHour),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(flashCampaignItemsTable).values(items.map((item) => ({
      id: crypto.randomBytes(8).toString("hex"),
      campaignId: id,
      tenantId,
      productId: item.productId,
      flashPrice: item.flashPrice.toFixed(2),
      createdAt: now,
    })));
    res.json({ id });
  } catch (err) {
    console.error("[FlashOffer] create:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: flashErrorMessage(err, "Erro ao salvar a promoção.") });
  }
});

router.patch("/admin/flash-campaigns/:id", requireAdminAuth, async (req, res) => {
  try {
    if (!(await readyFlashSchema(res))) return;
    const scope = getAdminScope(req);
    if (!canManageFlash(scope)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para promoções." });
      return;
    }
    const tenantId = scope?.tenantId || DEFAULT_TENANT_ID;
    const id = String(req.params.id || "");
    const [current] = await db
      .select()
      .from(flashCampaignsTable)
      .where(and(eq(flashCampaignsTable.id, id), eq(flashCampaignsTable.tenantId, tenantId)))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "NOT_FOUND", message: "Promoção não encontrada." });
      return;
    }
    const items = req.body?.items == null ? null : normalizeItems(req.body.items);
    if (items && items.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Escolha ao menos um produto com preço." });
      return;
    }
    if (items) {
      const priceError = await assertCheaperThanCatalog(tenantId, items);
      if (priceError) {
        res.status(400).json({ error: "INVALID_INPUT", message: priceError });
        return;
      }
    }
    await db.update(flashCampaignsTable).set({
      name: req.body?.name == null ? current.name : (String(req.body.name || "").trim() || current.name),
      isActive: req.body?.isActive == null ? current.isActive : req.body.isActive !== false,
      slotLimit: req.body?.slotLimit == null ? current.slotLimit : Math.min(500, Math.max(1, Math.round(Number(req.body.slotLimit) || 1))),
      drawPercent: req.body?.drawPercent == null ? current.drawPercent : Math.min(100, Math.max(1, Math.round(Number(req.body.drawPercent) || 1))),
      activeFromHour: req.body?.activeFromHour === undefined ? current.activeFromHour : normalizeHour(req.body.activeFromHour),
      activeUntilHour: req.body?.activeUntilHour === undefined ? current.activeUntilHour : normalizeHour(req.body.activeUntilHour),
      updatedAt: new Date(),
    }).where(eq(flashCampaignsTable.id, id));
    if (items) {
      await db.delete(flashCampaignItemsTable).where(eq(flashCampaignItemsTable.campaignId, id));
      await db.insert(flashCampaignItemsTable).values(items.map((item) => ({
        id: crypto.randomBytes(8).toString("hex"),
        campaignId: id,
        tenantId,
        productId: item.productId,
        flashPrice: item.flashPrice.toFixed(2),
        createdAt: new Date(),
      })));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[FlashOffer] update:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: flashErrorMessage(err, "Erro ao atualizar a promoção.") });
  }
});

router.delete("/admin/flash-campaigns/:id", requireAdminAuth, async (req, res) => {
  try {
    if (!(await readyFlashSchema(res))) return;
    const scope = getAdminScope(req);
    if (!canManageFlash(scope)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para promoções." });
      return;
    }
    const tenantId = scope?.tenantId || DEFAULT_TENANT_ID;
    const id = String(req.params.id || "");
    const [current] = await db
      .select({ id: flashCampaignsTable.id })
      .from(flashCampaignsTable)
      .where(and(eq(flashCampaignsTable.id, id), eq(flashCampaignsTable.tenantId, tenantId)))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "NOT_FOUND", message: "Promoção não encontrada." });
      return;
    }
    await db.delete(flashCampaignItemsTable).where(eq(flashCampaignItemsTable.campaignId, id));
    await db.delete(flashVisitsTable).where(eq(flashVisitsTable.campaignId, id));
    await db.delete(flashReservationsTable).where(eq(flashReservationsTable.campaignId, id));
    await db.delete(flashCampaignsTable).where(eq(flashCampaignsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[FlashOffer] delete:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: flashErrorMessage(err, "Erro ao apagar a promoção.") });
  }
});

export default router;
