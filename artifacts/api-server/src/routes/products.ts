import { Router, type IRouter } from "express";
import { db, productsTable, productCostHistoryTable, ordersTable } from "@workspace/db";
import { eq, asc, desc, gte } from "drizzle-orm";
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
    isLaunch:    p.isLaunch,
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
      .orderBy(desc(productsTable.isLaunch), asc(productsTable.createdAt));

    // Products with explicit positive position (1,2,3...) come first.
    // Zero/negative means "no manual position" and is pushed to the end.
    rows.sort((a, b) => {
      const aSort = a.sortOrder > 0 ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const bSort = b.sortOrder > 0 ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (aSort !== bSort) return aSort - bSort;

      if (a.isLaunch !== b.isLaunch) return a.isLaunch ? -1 : 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const products   = rows.map((row) => mapProduct(row));
    const categories = [...new Set(products.map((p) => p.category))];
    
    // Log successful response
    console.log(`[API] GET /api/products - Found ${products.length} active products, ${categories.length} categories`);
    
    res.json({ products, categories });
  } catch (err) {
    console.error("[API] GET /api/products - Database error:", err);
    // Return proper error response instead of empty data
    res.status(500).json({ 
      error: "DATABASE_ERROR",
      message: "Falha ao carregar produtos. Tente novamente em alguns instantes."
    });
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
      costPrice, promoPrice, promoEndsAt, image, isActive, isSoldOut, isLaunch, sortOrder,
    } = req.body as {
      name: string; description?: string; category: string; unit: string;
      price: number; costPrice?: number | null; promoPrice?: number | null; promoEndsAt?: string | null;
      image?: string | null; isActive?: boolean; isSoldOut?: boolean; isLaunch?: boolean; sortOrder?: number;
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
      isLaunch:    isLaunch === true,
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
        costPrice, promoPrice, promoEndsAt, image, isActive, isSoldOut, isLaunch, sortOrder,
      } = req.body as Partial<{
        name: string; description: string | null; category: string; unit: string;
        price: number; costPrice: number | null; promoPrice: number | null; promoEndsAt: string | null;
        image: string | null; isActive: boolean; isSoldOut: boolean; isLaunch: boolean; sortOrder: number;
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
    if (isLaunch   !== undefined) updates.isLaunch    = isLaunch;
    if (sortOrder  !== undefined) updates.sortOrder   = sortOrder;

    // Record cost price history and backfill recent orders when costPrice changes
    if (costPrice !== undefined) {
      const [current] = await db.select({ costPrice: productsTable.costPrice }).from(productsTable).where(eq(productsTable.id, id));
      const newCost = Number(costPrice ?? 0);
      if (current && Number(current.costPrice) !== newCost) {
        // 1. Gravar histórico
        await db.insert(productCostHistoryTable).values({
          productId: id,
          costPrice: String(newCost),
        });

        // 2. Atualizar costPrice nos pedidos das últimas 24h que contêm este produto
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentOrders = await db
          .select({ id: ordersTable.id, products: ordersTable.products })
          .from(ordersTable)
          .where(gte(ordersTable.createdAt, since));

        for (const order of recentOrders) {
          let items: Array<Record<string, unknown>>;
          try {
            items = Array.isArray(order.products)
              ? (order.products as Array<Record<string, unknown>>)
              : JSON.parse(String(order.products));
          } catch {
            continue;
          }
          const hasProduct = items.some((item) => String(item.id ?? item.productId ?? "").trim() === id);
          if (!hasProduct) continue;
          const patched = items.map((item) =>
            String(item.id ?? item.productId ?? "").trim() === id
              ? { ...item, costPrice: newCost }
              : item,
          );
          await db.update(ordersTable).set({ products: patched }).where(eq(ordersTable.id, order.id));
        }
      }
    }

    await db.update(productsTable).set(updates).where(eq(productsTable.id, id));

    const [updated] = await db.select().from(productsTable).where(eq(productsTable.id, id));
    if (!updated) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    res.json(mapProduct(updated, true));
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** GET /api/admin/products/:id/cost-history */
router.get("/admin/products/:id/cost-history", requirePrimaryAdmin, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const rows = await db
      .select()
      .from(productCostHistoryTable)
      .where(eq(productCostHistoryTable.productId, id))
      .orderBy(desc(productCostHistoryTable.changedAt));
    res.json({ history: rows.map((r) => ({ id: r.id, costPrice: Number(r.costPrice), changedAt: r.changedAt.toISOString() })) });
  } catch (err) {
    console.error("Cost history error:", err);
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
