import { Router, type IRouter } from "express";
import { db, productsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import crypto from "crypto";
import { requirePrimaryAdmin } from "./admin-auth";

const router: IRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve effective price respecting promo expiry */
function resolvePrice(p: typeof productsTable.$inferSelect) {
  if (!p.promoPrice) return { price: Number(p.price), promoPrice: null };
  if (p.promoEndsAt && new Date() > p.promoEndsAt) {
    return { price: Number(p.price), promoPrice: null };
  }
  return { price: Number(p.price), promoPrice: Number(p.promoPrice) };
}

function mapProduct(p: typeof productsTable.$inferSelect, includeCostPrice = false) {
  const { price, promoPrice } = resolvePrice(p);
  const product = {
    id:          p.id,
    name:        p.name,
    description: p.description ?? "",
    category:    p.category,
    unit:        p.unit,
    price,
    promoPrice,
    promoEndsAt: p.promoEndsAt?.toISOString() ?? null,
    image:       p.image ?? null,
    isActive:    p.isActive,
    isSoldOut:   p.isSoldOut,
    sortOrder:   p.sortOrder,
    createdAt:   p.createdAt.toISOString(),
  };
  if (includeCostPrice) {
    return { ...product, costPrice: Number(p.costPrice ?? 0) };
  }
  return product;
}

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * GET /api/products
 * Returns active products from DB, falling back to Google Sheets if DB is empty.
 */
router.get("/products", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.isActive, true))
      .orderBy(asc(productsTable.sortOrder), asc(productsTable.createdAt));

    const products   = rows.map((row) => mapProduct(row));
    const categories = [...new Set(products.map((p) => p.category))];
    res.json({ products, categories });
  } catch (err) {
    console.error("Products error:", err);
    res.json({ products: [], categories: [] });
  }
});

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

/** GET /api/admin/products */
router.get("/admin/products", requirePrimaryAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(productsTable)
      .orderBy(asc(productsTable.sortOrder), asc(productsTable.createdAt));
    res.json({ products: rows.map((row) => mapProduct(row, true)) });
  } catch (err) {
    console.error("Admin products error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** POST /api/admin/products */
router.post("/admin/products", requirePrimaryAdmin, async (req, res) => {
  try {
    const {
      name, description, category, unit, price,
      costPrice, promoPrice, promoEndsAt, image, isActive, isSoldOut, sortOrder,
    } = req.body as {
      name: string; description?: string; category: string; unit: string;
      price: number; costPrice?: number | null; promoPrice?: number | null; promoEndsAt?: string | null;
      image?: string | null; isActive?: boolean; isSoldOut?: boolean; sortOrder?: number;
    };

    if (!name?.trim() || !category?.trim() || price == null) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Nome, categoria e preço são obrigatórios." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    await db.insert(productsTable).values({
      id,
      name:        name.trim(),
      description: description?.trim() || null,
      category:    category.trim(),
      unit:        unit || "unidade",
      price:       String(price),
      costPrice:   String(Number(costPrice ?? 0)),
      promoPrice:  promoPrice ? String(promoPrice) : null,
      promoEndsAt: promoEndsAt ? new Date(promoEndsAt) : null,
      image:       image || null,
      isActive:    isActive !== false,
      isSoldOut:   isSoldOut === true,
      sortOrder:   sortOrder ?? 0,
    });

    const [created] = await db.select().from(productsTable).where(eq(productsTable.id, id));
    res.status(201).json(mapProduct(created!, true));
  } catch (err) {
    console.error("Create product error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** PATCH /api/admin/products/:id */
router.patch("/admin/products/:id", requirePrimaryAdmin, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
      const {
        name, description, category, unit, price,
        costPrice, promoPrice, promoEndsAt, image, isActive, isSoldOut, sortOrder,
      } = req.body as Partial<{
        name: string; description: string | null; category: string; unit: string;
        price: number; costPrice: number | null; promoPrice: number | null; promoEndsAt: string | null;
        image: string | null; isActive: boolean; isSoldOut: boolean; sortOrder: number;
      }>;

    const updates: Partial<typeof productsTable.$inferInsert> = { updatedAt: new Date() };
    if (name       !== undefined) updates.name        = name?.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (category   !== undefined) updates.category    = category?.trim();
    if (unit       !== undefined) updates.unit        = unit;
    if (price      !== undefined) updates.price       = String(price);
    if (costPrice  !== undefined) updates.costPrice   = String(Number(costPrice ?? 0));
    if (promoPrice !== undefined) updates.promoPrice  = promoPrice ? String(promoPrice) : null;
    if (promoEndsAt !== undefined) updates.promoEndsAt = promoEndsAt ? new Date(promoEndsAt) : null;
    if (image      !== undefined) updates.image       = image || null;
    if (isActive   !== undefined) updates.isActive    = isActive;
    if (isSoldOut  !== undefined) updates.isSoldOut   = isSoldOut;
    if (sortOrder  !== undefined) updates.sortOrder   = sortOrder;

    await db.update(productsTable).set(updates).where(eq(productsTable.id, id));

    const [updated] = await db.select().from(productsTable).where(eq(productsTable.id, id));
    if (!updated) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    res.json(mapProduct(updated, true));
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** DELETE /api/admin/products/:id */
router.delete("/admin/products/:id", requirePrimaryAdmin, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    await db.delete(productsTable).where(eq(productsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
