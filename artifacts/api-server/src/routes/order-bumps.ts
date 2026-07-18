import { Router, type IRouter } from "express";
import { db, orderBumpsTable } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";
import crypto from "crypto";
import { getAdminScope, requirePrimaryAdmin } from "./admin-auth";

const router: IRouter = Router();
const DEFAULT_TENANT_ID = "tenant_loja1";

function mapBump(b: typeof orderBumpsTable.$inferSelect) {
  return {
    id:            b.id,
    productId:     b.productId,
    offerProductId: b.offerProductId ?? b.productId,
    title:         b.title,
    cardTitle:     b.cardTitle ?? null,
    description:   b.description ?? null,
    image:         b.image ?? null,
    discountType:  b.discountType,
    discountValue: b.discountValue ? Number(b.discountValue) : null,
    buyQuantity:   b.buyQuantity ?? null,
    getQuantity:   b.getQuantity ?? null,
    tiers:         b.tiers ? (JSON.parse(b.tiers) as Array<{ qty: number; price: number; image?: string }>) : null,
    unit:          b.unit ?? "unidade",
    discountTagType: b.discountTagType ?? "none",
    isActive:      b.isActive,
    sortOrder:     b.sortOrder,
    createdAt:     b.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /api/order-bumps?productId=xxx   (public — for product page)
// ---------------------------------------------------------------------------
router.get("/order-bumps", async (req, res) => {
  try {
    const { productId } = req.query as Record<string, string>;
    const rows = await db
      .select()
      .from(orderBumpsTable)
      .where(
        productId
          ? and(eq(orderBumpsTable.tenantId, DEFAULT_TENANT_ID), eq(orderBumpsTable.productId, productId))
          : and(eq(orderBumpsTable.tenantId, DEFAULT_TENANT_ID), eq(orderBumpsTable.isActive, true))
      )
      .orderBy(asc(orderBumpsTable.sortOrder), asc(orderBumpsTable.createdAt));

    const bumps = rows.filter((b) => b.isActive).map(mapBump);
    res.json({ bumps });
  } catch (err) {
    console.error("Order bumps fetch error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/order-bumps   (admin — all bumps for all products)
// ---------------------------------------------------------------------------
router.get("/admin/order-bumps", requirePrimaryAdmin, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const rows = await db
      .select()
      .from(orderBumpsTable)
      .where(eq(orderBumpsTable.tenantId, tenantId))
      .orderBy(asc(orderBumpsTable.sortOrder), asc(orderBumpsTable.createdAt));
    res.json({ bumps: rows.map(mapBump) });
  } catch (err) {
    console.error("Admin order-bumps fetch error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/order-bumps   (admin — create)
// ---------------------------------------------------------------------------
router.post("/admin/order-bumps", requirePrimaryAdmin, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const { productId, offerProductId, title, cardTitle, description, image, discountType, discountValue, buyQuantity, getQuantity, tiers, unit, isActive, sortOrder } = req.body as {
      productId: string;
      offerProductId?: string;
      title: string;
      cardTitle?: string;
      description?: string;
      image?: string;
      discountType: string;
      discountValue?: number;
      buyQuantity?: number;
      getQuantity?: number;
      tiers?: Array<{ qty: number; price: number }>;
      unit?: string;
      isActive?: boolean;
      sortOrder?: number;
    };

    if (!productId?.trim()) return res.status(400).json({ error: "productId obrigatório." });
    if (!title?.trim())     return res.status(400).json({ error: "Título obrigatório." });
    if (!discountType)      return res.status(400).json({ error: "Tipo de desconto obrigatório." });

    const id = crypto.randomBytes(10).toString("hex");
    await db.insert(orderBumpsTable).values({
      id,
      tenantId,
      productId:    productId.trim(),
      offerProductId: offerProductId?.trim() || productId.trim(),
      title:        title.trim(),
      cardTitle:    cardTitle?.trim() || null,
      description:  description?.trim() || null,
      image:        image || null,
      discountType,
      discountValue: discountValue != null ? String(discountValue) : null,
      buyQuantity:  buyQuantity ?? null,
      getQuantity:  getQuantity ?? null,
      tiers:        tiers ? JSON.stringify(tiers) : null,
      unit:         unit || "unidade",
      discountTagType: (req.body as { discountTagType?: string }).discountTagType ?? "none",
      isActive:     isActive !== false,
      sortOrder:    sortOrder ?? 0,
      updatedAt:    new Date(),
    });
    const [row] = await db.select().from(orderBumpsTable).where(and(eq(orderBumpsTable.tenantId, tenantId), eq(orderBumpsTable.id, id)));

    res.status(201).json({ bump: mapBump(row) });
  } catch (err) {
    console.error("Create order-bump error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/order-bumps/:id   (admin — update)
// ---------------------------------------------------------------------------
router.patch("/admin/order-bumps/:id", requirePrimaryAdmin, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const body = req.body as {
      productId?: string;
      offerProductId?: string;
      title?: string;
      cardTitle?: string | null;
      description?: string | null;
      image?: string | null;
      discountType?: string;
      discountValue?: number | null;
      buyQuantity?: number | null;
      getQuantity?: number | null;
      tiers?: Array<{ qty: number; price: number }> | null;
      unit?: string;
      isActive?: boolean;
      sortOrder?: number;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.productId   !== undefined) updates.productId    = body.productId.trim();
    if (body.offerProductId !== undefined) updates.offerProductId = body.offerProductId?.trim() || body.productId?.trim() || null;
    if (body.title       !== undefined) updates.title        = body.title.trim();
    if (body.cardTitle   !== undefined) updates.cardTitle    = body.cardTitle?.trim() || null;
    if (body.description !== undefined) updates.description  = body.description?.trim() || null;
    if (body.image       !== undefined) updates.image        = body.image;
    if (body.discountType !== undefined) updates.discountType = body.discountType;
    if (body.discountValue !== undefined) updates.discountValue = body.discountValue != null ? String(body.discountValue) : null;
    if (body.buyQuantity !== undefined) updates.buyQuantity  = body.buyQuantity;
    if (body.getQuantity !== undefined) updates.getQuantity  = body.getQuantity;
    if (body.tiers       !== undefined) updates.tiers        = body.tiers ? JSON.stringify(body.tiers) : null;
    if (body.unit        !== undefined) updates.unit         = body.unit || "unidade";
    if ((body as { discountTagType?: string }).discountTagType !== undefined) updates.discountTagType = (body as { discountTagType?: string }).discountTagType ?? "none";
    if (body.isActive    !== undefined) updates.isActive     = body.isActive;
    if (body.sortOrder   !== undefined) updates.sortOrder    = body.sortOrder;

    await db
      .update(orderBumpsTable)
      .set(updates)
      .where(and(eq(orderBumpsTable.tenantId, tenantId), eq(orderBumpsTable.id, id)));
    const [row] = await db.select().from(orderBumpsTable).where(and(eq(orderBumpsTable.tenantId, tenantId), eq(orderBumpsTable.id, id)));

    if (!row) return res.status(404).json({ error: "Order bump não encontrado." });
    res.json({ bump: mapBump(row) });
  } catch (err) {
    console.error("Update order-bump error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/order-bumps/:id   (admin — delete)
// ---------------------------------------------------------------------------
router.delete("/admin/order-bumps/:id", requirePrimaryAdmin, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const id = String(req.params.id);
    await db.delete(orderBumpsTable).where(and(eq(orderBumpsTable.tenantId, tenantId), eq(orderBumpsTable.id, id)));
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete order-bump error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
