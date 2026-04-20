import { Router, type IRouter } from "express";
import { db, couponsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { requireAdminAuth, requirePrimaryAdmin } from "./admin-auth";

const router: IRouter = Router();

function getCouponSchemaErrorMessage(err: unknown, fallback: string): string {
  const e = err as { code?: string; message?: string } | null;
  const code = String(e?.code || "");
  const message = String(e?.message || "").toLowerCase();

  const missingEligibleProductsColumn =
    code === "ER_BAD_FIELD_ERROR" ||
    message.includes("eligible_product_ids") ||
    message.includes("unknown column");

  if (missingEligibleProductsColumn) {
    return "Atualização pendente no banco: execute ALTER TABLE coupons ADD COLUMN eligible_product_ids JSON NULL; e tente novamente.";
  }

  return fallback;
}

type CouponProductInput = {
  id?: string;
  quantity?: number;
  price?: number;
};

type CouponEvaluation = {
  valid: boolean;
  error?: string;
  message?: string;
  eligibleProductIds: string[];
  eligibleSubtotal: number;
  discountAmount: number;
};

function normalizeEligibleProductIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item || "").trim();
    if (id) seen.add(id);
  }
  return Array.from(seen);
}

function getProductsSubtotal(products: CouponProductInput[]): number {
  return products.reduce((acc, p) => {
    const qty = Number(p.quantity) || 0;
    const price = Number(p.price) || 0;
    if (qty <= 0 || price <= 0) return acc;
    return acc + qty * price;
  }, 0);
}

function getEligibleSubtotal(products: CouponProductInput[], eligibleProductIds: string[]): number {
  if (eligibleProductIds.length === 0) return getProductsSubtotal(products);
  const eligibleSet = new Set(eligibleProductIds);
  return products.reduce((acc, p) => {
    const id = String(p.id || "").trim();
    const qty = Number(p.quantity) || 0;
    const price = Number(p.price) || 0;
    if (!id || !eligibleSet.has(id) || qty <= 0 || price <= 0) return acc;
    return acc + qty * price;
  }, 0);
}

function calculateDiscount(discountType: string, discountValue: number, baseAmount: number): number {
  if (baseAmount <= 0 || discountValue <= 0) return 0;
  if (discountType === "percent") return baseAmount * (discountValue / 100);
  if (discountType === "fixed") return Math.min(discountValue, baseAmount);
  return 0;
}

export function evaluateCouponForProducts(
  coupon: typeof couponsTable.$inferSelect,
  products: CouponProductInput[],
  orderValue?: number,
): CouponEvaluation {
  const eligibleProductIds = normalizeEligibleProductIds(coupon.eligibleProductIds);

  if (!coupon.isActive) {
    return { valid: false, error: "INACTIVE", message: "Este cupom está desativado.", eligibleProductIds, eligibleSubtotal: 0, discountAmount: 0 };
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, error: "EXHAUSTED", message: "Este cupom atingiu o limite de usos.", eligibleProductIds, eligibleSubtotal: 0, discountAmount: 0 };
  }
  if (coupon.minOrderValue !== null && orderValue !== undefined && orderValue < Number(coupon.minOrderValue)) {
    return {
      valid: false,
      error: "MIN_VALUE",
      message: `Pedido mínimo de R$ ${Number(coupon.minOrderValue).toFixed(2).replace(".", ",")} para usar este cupom.`,
      eligibleProductIds,
      eligibleSubtotal: 0,
      discountAmount: 0,
    };
  }

  const eligibleSubtotal = getEligibleSubtotal(products, eligibleProductIds);
  if (eligibleProductIds.length > 0 && eligibleSubtotal <= 0) {
    return {
      valid: false,
      error: "PRODUCT_NOT_ELIGIBLE",
      message: "Este cupom só é válido para produtos específicos do carrinho.",
      eligibleProductIds,
      eligibleSubtotal: 0,
      discountAmount: 0,
    };
  }

  const discountAmount = calculateDiscount(coupon.discountType, Number(coupon.discountValue), eligibleSubtotal);
  if (discountAmount <= 0) {
    return {
      valid: false,
      error: "INVALID_DISCOUNT",
      message: "Este cupom não gera desconto para os produtos elegíveis deste carrinho.",
      eligibleProductIds,
      eligibleSubtotal,
      discountAmount: 0,
    };
  }

  return { valid: true, eligibleProductIds, eligibleSubtotal, discountAmount };
}

// ---------------------------------------------------------------------------
// POST /api/coupons/validate  — public: validate a coupon before checkout
// ---------------------------------------------------------------------------
router.post("/coupons/validate", async (req, res) => {
  try {
    const { code, orderValue, products } = req.body as {
      code: string;
      orderValue?: number;
      products?: CouponProductInput[];
    };

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
    const productList = Array.isArray(products) ? products : [];
    const evaluation = evaluateCouponForProducts(coupon, productList, orderValue);
    if (!evaluation.valid) {
      res.status(400).json({
        error: evaluation.error || "INVALID_COUPON",
        message: evaluation.message || "Cupom inválido.",
      });
      return;
    }

    res.json({
      valid:         true,
      code:          coupon.code,
      discountType:  coupon.discountType,
      discountValue: Number(coupon.discountValue),
      discountAmount: evaluation.discountAmount,
      eligibleSubtotal: evaluation.eligibleSubtotal,
      eligibleProductIds: evaluation.eligibleProductIds,
      minOrderValue: coupon.minOrderValue ? Number(coupon.minOrderValue) : null,
      maxUses:       coupon.maxUses,
      usedCount:     coupon.usedCount,
    });
  } catch (err) {
    console.error("Validate coupon error:", err);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: getCouponSchemaErrorMessage(err, "Erro ao validar cupom."),
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/coupons  (protected)
// ---------------------------------------------------------------------------
router.get("/admin/coupons", requireAdminAuth, requirePrimaryAdmin, async (_req, res) => {
  try {
    const coupons = await db.select().from(couponsTable).orderBy(couponsTable.createdAt);
    res.json({ coupons: coupons.map(mapCoupon) });
  } catch (err) {
    console.error("List coupons error:", err);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: getCouponSchemaErrorMessage(err, "Erro ao listar cupons."),
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/coupons  (primary admin)
// ---------------------------------------------------------------------------
router.post("/admin/coupons", requireAdminAuth, requirePrimaryAdmin, async (req, res) => {
  try {
    const { code, discountType, discountValue, minOrderValue, maxUses, eligibleProductIds } =
      req.body as {
        code: string; discountType: string; discountValue: number;
        minOrderValue?: number | null; maxUses?: number | null;
        eligibleProductIds?: string[] | null;
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

    const cleanEligibleProductIds = normalizeEligibleProductIds(eligibleProductIds);

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
      eligibleProductIds: cleanEligibleProductIds.length > 0 ? cleanEligibleProductIds : null,
      minOrderValue: minOrderValue ? String(minOrderValue) : null,
      maxUses:       maxUses || null,
      isActive:      true,
    });

    const [created] = await db.select().from(couponsTable).where(eq(couponsTable.id, id));
    res.status(201).json(mapCoupon(created!));
  } catch (err) {
    console.error("Create coupon error:", err);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: getCouponSchemaErrorMessage(err, "Erro ao criar cupom."),
    });
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
  const eligibleProductIds = normalizeEligibleProductIds(c.eligibleProductIds);
  return {
    id:            c.id,
    code:          c.code,
    discountType:  c.discountType,
    discountValue: Number(c.discountValue),
    eligibleProductIds,
    minOrderValue: c.minOrderValue ? Number(c.minOrderValue) : null,
    maxUses:       c.maxUses,
    usedCount:     c.usedCount,
    isActive:      c.isActive,
    createdAt:     c.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export default router;
