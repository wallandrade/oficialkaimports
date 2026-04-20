import { Router, type IRouter } from "express";
import { db, shippingOptionsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import crypto from "crypto";
import { requirePrimaryAdmin } from "./admin-auth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/shipping-options  (public)
// Returns all active shipping options ordered by sortOrder.
// ---------------------------------------------------------------------------
router.get("/shipping-options", async (_req, res) => {
  try {
    const options = await db
      .select()
      .from(shippingOptionsTable)
      .where(eq(shippingOptionsTable.isActive, true))
      .orderBy(asc(shippingOptionsTable.sortOrder), asc(shippingOptionsTable.createdAt));

    res.json({ options });
  } catch (err) {
    console.error("[ShippingOptions] list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar fretes." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/shipping-options  (admin)
// Returns ALL shipping options (active + inactive).
// ---------------------------------------------------------------------------
router.get("/admin/shipping-options", requirePrimaryAdmin, async (_req, res) => {
  try {
    const options = await db
      .select()
      .from(shippingOptionsTable)
      .orderBy(asc(shippingOptionsTable.sortOrder), asc(shippingOptionsTable.createdAt));

    res.json({ options });
  } catch (err) {
    console.error("[ShippingOptions] admin list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar fretes." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/shipping-options  (admin)
// Create a new shipping option.
// ---------------------------------------------------------------------------
router.post("/admin/shipping-options", requirePrimaryAdmin, async (req, res) => {
  try {
    const { name, description, price, sortOrder } = req.body as {
      name?: string;
      description?: string;
      price?: number;
      sortOrder?: number;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Nome do frete é obrigatório." });
      return;
    }

    if (price == null || Number(price) < 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Preço inválido." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");

    await db.insert(shippingOptionsTable).values({
      id,
      name:        name.trim(),
      description: description?.trim() || null,
      price:       String(Number(price).toFixed(2)),
      sortOrder:   Number(sortOrder ?? 0),
      isActive:    true,
    });

    const created = await db
      .select()
      .from(shippingOptionsTable)
      .where(eq(shippingOptionsTable.id, id))
      .limit(1);

    res.status(201).json({ option: created[0] });
  } catch (err) {
    console.error("[ShippingOptions] create error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar frete." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/shipping-options/:id  (admin)
// Update an existing shipping option.
// ---------------------------------------------------------------------------
router.patch("/admin/shipping-options/:id", requirePrimaryAdmin, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { name, description, price, sortOrder, isActive } = req.body as {
      name?: string;
      description?: string;
      price?: number;
      sortOrder?: number;
      isActive?: boolean;
    };

    const updates: Partial<typeof shippingOptionsTable.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (name !== undefined)        updates.name        = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (price !== undefined)       updates.price       = String(Number(price).toFixed(2));
    if (sortOrder !== undefined)   updates.sortOrder   = Number(sortOrder);
    if (isActive !== undefined)    updates.isActive    = Boolean(isActive);

    await db
      .update(shippingOptionsTable)
      .set(updates)
      .where(eq(shippingOptionsTable.id, id));

    const updated = await db
      .select()
      .from(shippingOptionsTable)
      .where(eq(shippingOptionsTable.id, id))
      .limit(1);

    if (!updated[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Frete não encontrado." });
      return;
    }

    res.json({ option: updated[0] });
  } catch (err) {
    console.error("[ShippingOptions] update error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar frete." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/shipping-options/:id  (admin)
// ---------------------------------------------------------------------------
router.delete("/admin/shipping-options/:id", requirePrimaryAdmin, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    await db.delete(shippingOptionsTable).where(eq(shippingOptionsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[ShippingOptions] delete error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao excluir frete." });
  }
});

export default router;
