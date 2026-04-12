import { Router, type IRouter } from "express";
import { db, couponsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { requireAdminAuth, requirePrimaryAdmin } from "./admin-auth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/coupons/validate  — public: validate a coupon before checkout
// ---------------------------------------------------------------------------
router.post("/coupons/validate", async (req, res) => {
  try {
    const { code, orderValue } = req.body as { code: string; orderValue?: number };

    if (!code?.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Código de cupom obrigatório." });
      return;
    }

    const [coupon] = await db
      .select()
      .from(couponsTable)
      .where(eq(couponsTable.code, code.trim().toUpperCase()));

    if (!coupon) {
      res.status(404).json({ error: "NOT_FOUND", message: "Cupom não encontrado." });
      return;
    }
    if (!coupon.isActive) {
      res.status(400).json({ error: "INACTIVE", message: "Este cupom está desativado." });
      return;
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      res.status(400).json({ error: "EXHAUSTED", message: "Este cupom atingiu o limite de usos." });
      return;
    }
    if (coupon.minOrderValue !== null && orderValue !== undefined && orderValue < Number(coupon.minOrderValue)) {
      res.status(400).json({
        error: "MIN_VALUE",
        message: `Pedido mínimo de R$ ${Number(coupon.minOrderValue).toFixed(2).replace(".", ",")} para usar este cupom.`,
      });
      return;
    }

    res.json({
      valid:         true,
      code:          coupon.code,
      discountType:  coupon.discountType,
      discountValue: Number(coupon.discountValue),
      minOrderValue: coupon.minOrderValue ? Number(coupon.minOrderValue) : null,
      maxUses:       coupon.maxUses,
      usedCount:     coupon.usedCount,
    });
  } catch (err) {
    console.error("Validate coupon error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao validar cupom." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/coupons  (protected)
// ---------------------------------------------------------------------------
router.get("/admin/coupons", requireAdminAuth, async (_req, res) => {
  try {
    const coupons = await db.select().from(couponsTable).orderBy(couponsTable.createdAt);
    res.json({ coupons: coupons.map(mapCoupon) });
  } catch (err) {
    console.error("List coupons error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar cupons." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/coupons  (primary admin)
// ---------------------------------------------------------------------------
router.post("/admin/coupons", requireAdminAuth, requirePrimaryAdmin, async (req, res) => {
  try {
    const { code, discountType, discountValue, minOrderValue, maxUses } =
      req.body as {
        code: string; discountType: string; discountValue: number;
        minOrderValue?: number | null; maxUses?: number | null;
      };

    if (!code?.trim() || !discountType || !discountValue) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Campos obrigatórios: código, tipo, valor." });
      return;
    }
    if (!["percent", "fixed"].includes(discountType)) {
      res.status(400).json({ error: "INVALID_TYPE", message: "Tipo inválido. Use 'percent' ou 'fixed'." });
      return;
    }
    if (discountType === "percent" && (discountValue <= 0 || discountValue > 100)) {
      res.status(400).json({ error: "INVALID_VALUE", message: "Desconto percentual deve ser entre 1 e 100." });
      return;
    }

    const cleanCode = code.trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9_-]/g, "");
    if (!cleanCode) {
      res.status(400).json({ error: "INVALID_CODE", message: "Código inválido." });
      return;
    }

    // Check duplicate
    const [existing] = await db.select().from(couponsTable).where(eq(couponsTable.code, cleanCode));
    if (existing) {
      res.status(409).json({ error: "DUPLICATE", message: `Cupom "${cleanCode}" já existe.` });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    await db.insert(couponsTable).values({
      id,
      code:          cleanCode,
      discountType,
      discountValue: String(discountValue),
      minOrderValue: minOrderValue ? String(minOrderValue) : null,
      maxUses:       maxUses || null,
      isActive:      true,
    });

    const [created] = await db.select().from(couponsTable).where(eq(couponsTable.id, id));
    res.status(201).json(mapCoupon(created!));
  } catch (err) {
    console.error("Create coupon error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar cupom." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/coupons/:id  — toggle active or update (primary admin)
// ---------------------------------------------------------------------------
router.patch("/admin/coupons/:id", requireAdminAuth, requirePrimaryAdmin, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { isActive } = req.body as { isActive: boolean };

    await db.update(couponsTable)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(couponsTable.id, id));

    res.json({ ok: true });
  } catch (err) {
    console.error("Update coupon error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar cupom." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/coupons/:id  (primary admin)
// ---------------------------------------------------------------------------
router.delete("/admin/coupons/:id", requireAdminAuth, requirePrimaryAdmin, async (req, res) => {
  try {
    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    await db.delete(couponsTable).where(eq(couponsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete coupon error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao remover cupom." });
  }
});

// ---------------------------------------------------------------------------
// Internal: increment usedCount (called after successful payment)
// ---------------------------------------------------------------------------
export async function incrementCouponUse(code: string) {
  try {
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code.toUpperCase()));
    if (coupon) {
      await db.update(couponsTable)
        .set({ usedCount: coupon.usedCount + 1, updatedAt: new Date() })
        .where(eq(couponsTable.id, coupon.id));
    }
  } catch (err) {
    console.error("incrementCouponUse error:", err);
  }
}

function mapCoupon(c: typeof couponsTable.$inferSelect) {
  return {
    id:            c.id,
    code:          c.code,
    discountType:  c.discountType,
    discountValue: Number(c.discountValue),
    minOrderValue: c.minOrderValue ? Number(c.minOrderValue) : null,
    maxUses:       c.maxUses,
    usedCount:     c.usedCount,
    isActive:      c.isActive,
    createdAt:     c.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export default router;
