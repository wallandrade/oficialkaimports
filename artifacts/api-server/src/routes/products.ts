import { Router, type IRouter } from "express";
import { db, productsTable, productCostHistoryTable, ordersTable, siteSettingsTable } from "@workspace/db";
import { eq, asc, desc, gte } from "drizzle-orm";
import crypto from "crypto";
import { requirePrimaryAdmin } from "./admin-auth";
import { getR2MissingConfig, isR2Configured, uploadProductImageToR2 } from "../lib/r2";

const router: IRouter = Router();

type BulkDiscountTierInput = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
  label?: string | null;
};

type ProductVariantGroupInput = {
  name: string;
  options: string[];
};

type ProductBackupEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  brand: string | null;
  unit: string;
  price: number;
  costPrice: number;
  promoPrice: number | null;
  promoEndsAt: string | null;
  bulkDiscountEnabled: boolean;
  bulkDiscountTiers: BulkDiscountTierInput[];
  variantGroups: ProductVariantGroupInput[];
  image: string | null;
  isActive: boolean;
  isSoldOut: boolean;
  isLaunch: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

const PRODUCT_BACKUP_VERSION = 1;
const ADMIN_SAVED_BRANDS_KEY = "admin_saved_brands";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve effective price respecting promo expiry */
function resolvePrice(p: typeof productsTable.$inferSelect) {
  if (!p.promoPrice) return { price: Number(p.price), promoPrice: null };
  if (p.promoEndsAt && new Date() > p.promoEndsAt) {
    return { price: Number(p.price), promoPrice: null };
  }
  return { price: Number(p.price), promoPrice: Number(p.promoPrice) };
}

function parseBulkDiscountTiers(raw: unknown): BulkDiscountTierInput[] {
  if (!raw) return [];

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];

    const tiers = parsed
      .map((tier) => {
        const item = tier as Record<string, unknown>;
        const minQty = Number(item.minQty);
        const maxQtyRaw = item.maxQty;
        const maxQty = maxQtyRaw == null ? null : Number(maxQtyRaw);
        const unitPrice = Number(item.unitPrice);
        const label = item.label == null ? null : String(item.label);

        if (!Number.isFinite(minQty) || minQty < 1) return null;
        if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) return null;
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

        return { minQty, maxQty, unitPrice, label };
      })
      .filter((tier): tier is BulkDiscountTierInput => Boolean(tier));

    return tiers.sort((a, b) => a.minQty - b.minQty);
  } catch {
    return [];
  }
}

function validateBulkDiscountTiers(tiers: BulkDiscountTierInput[]): { ok: true } | { ok: false; message: string } {
  if (tiers.length === 0) return { ok: true };

  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  let previousMax: number | null = null;

  for (let i = 0; i < sorted.length; i += 1) {
    const tier = sorted[i];
    if (!tier) continue;

    if (previousMax !== null && tier.minQty <= previousMax) {
      return { ok: false, message: "As faixas progressivas não podem se sobrepor." };
    }

    if (tier.maxQty === null && i !== sorted.length - 1) {
      return { ok: false, message: "A faixa sem limite máximo deve ser a última." };
    }

    previousMax = tier.maxQty;
  }

  return { ok: true };
}

function parseVariantGroups(raw: unknown): ProductVariantGroupInput[] {
  if (!raw) return [];

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((group) => {
        const item = group as Record<string, unknown>;
        const name = String(item.name ?? "").trim();
        const optionsRaw = Array.isArray(item.options) ? item.options : [];
        const options = optionsRaw
          .map((option) => String(option ?? "").trim())
          .filter(Boolean)
          .filter((option, index, array) => array.indexOf(option) === index);

        if (!name || options.length === 0) return null;
        return { name, options };
      })
      .filter((group): group is ProductVariantGroupInput => Boolean(group));
  } catch {
    return [];
  }
}

function parseSavedBrands(raw: unknown): string[] {
  if (!raw) return [];

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];

    return Array.from(
      new Set(
        parsed
          .map((item) => String(item ?? "").trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  } catch {
    return [];
  }
}

function toIsoStringOrNow(value: unknown): string {
  const parsed = value ? new Date(String(value)) : new Date();
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function mapProductForBackup(p: typeof productsTable.$inferSelect): ProductBackupEntry {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    category: p.category,
    brand: p.brand ?? null,
    unit: p.unit,
    price: Number(p.price),
    costPrice: Number(p.costPrice ?? 0),
    promoPrice: p.promoPrice == null ? null : Number(p.promoPrice),
    promoEndsAt: p.promoEndsAt?.toISOString() ?? null,
    bulkDiscountEnabled: Boolean(p.bulkDiscountEnabled),
    bulkDiscountTiers: parseBulkDiscountTiers(p.bulkDiscountTiers),
    variantGroups: parseVariantGroups(p.variantGroups),
    image: p.image ?? null,
    isActive: Boolean(p.isActive),
    isSoldOut: Boolean(p.isSoldOut),
    isLaunch: Boolean(p.isLaunch),
    sortOrder: Number(p.sortOrder ?? 0),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function normalizeBackupProduct(raw: unknown, index: number): ProductBackupEntry {
  const item = raw as Record<string, unknown>;
  const id = String(item.id ?? "").trim();
  const name = String(item.name ?? "").trim();
  const category = String(item.category ?? "").trim();
  const unit = String(item.unit ?? "unidade").trim() || "unidade";
  const price = Number(item.price);
  const costPrice = Number(item.costPrice ?? 0);
  const promoPriceRaw = item.promoPrice;
  const promoPrice = promoPriceRaw == null || promoPriceRaw === "" ? null : Number(promoPriceRaw);
  const sortOrder = Number(item.sortOrder ?? 0);

  if (!id) {
    throw new Error(`Produto #${index + 1} sem ID.`);
  }
  if (!name || !category) {
    throw new Error(`Produto ${id} sem nome ou categoria.`);
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Produto ${id} com preço inválido.`);
  }
  if (!Number.isFinite(costPrice) || costPrice < 0) {
    throw new Error(`Produto ${id} com custo inválido.`);
  }
  if (promoPrice !== null && (!Number.isFinite(promoPrice) || promoPrice <= 0)) {
    throw new Error(`Produto ${id} com preço promocional inválido.`);
  }
  if (!Number.isFinite(sortOrder)) {
    throw new Error(`Produto ${id} com ordem inválida.`);
  }

  const bulkDiscountTiers = parseBulkDiscountTiers(item.bulkDiscountTiers);
  const validation = validateBulkDiscountTiers(bulkDiscountTiers);
  if (!validation.ok) {
    throw new Error(`Produto ${id}: ${validation.message}`);
  }

  return {
    id,
    name,
    description: String(item.description ?? "").trim(),
    category,
    brand: item.brand == null ? null : String(item.brand).trim() || null,
    unit,
    price,
    costPrice,
    promoPrice,
    promoEndsAt: item.promoEndsAt ? toIsoStringOrNow(item.promoEndsAt) : null,
    bulkDiscountEnabled: item.bulkDiscountEnabled === true,
    bulkDiscountTiers,
    variantGroups: parseVariantGroups(item.variantGroups),
    image: item.image == null ? null : String(item.image).trim() || null,
    isActive: item.isActive !== false,
    isSoldOut: item.isSoldOut === true,
    isLaunch: item.isLaunch === true,
    sortOrder,
    createdAt: toIsoStringOrNow(item.createdAt),
    updatedAt: toIsoStringOrNow(item.updatedAt),
  };
}

function mapProduct(p: typeof productsTable.$inferSelect, includeCostPrice = false) {
  const { price, promoPrice } = resolvePrice(p);
  const bulkDiscountTiers = parseBulkDiscountTiers(p.bulkDiscountTiers);
  const variantGroups = parseVariantGroups(p.variantGroups);
  const product = {
    id:          p.id,
    name:        p.name,
    description: p.description ?? "",
    category:    p.category,
    brand:       p.brand ?? null,
    unit:        p.unit,
    price,
    promoPrice,
    promoEndsAt: p.promoEndsAt?.toISOString() ?? null,
    bulkDiscountEnabled: Boolean(p.bulkDiscountEnabled),
    bulkDiscountTiers,
    variantGroups,
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
    const brands     = [...new Set(products.map((p) => p.brand).filter((b): b is string => Boolean(b)))];
    
    // Log successful response
    console.log(`[API] GET /api/products - Found ${products.length} active products, ${categories.length} categories`);
    
    res.json({ products, categories, brands });
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

/** GET /api/admin/products/backup */
router.get("/admin/products/backup", requirePrimaryAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(productsTable)
      .orderBy(asc(productsTable.sortOrder), asc(productsTable.createdAt));

    const settingsRows = await db
      .select()
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.key, ADMIN_SAVED_BRANDS_KEY));

    const savedBrands = parseSavedBrands(settingsRows[0]?.value ?? "[]");
    const exportedAt = new Date().toISOString();
    const payload = {
      version: PRODUCT_BACKUP_VERSION,
      exportedAt,
      productCount: rows.length,
      savedBrands,
      products: rows.map((row) => mapProductForBackup(row)),
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="produtos-backup-${exportedAt.slice(0, 10)}.json"`);
    res.json(payload);
  } catch (err) {
    console.error("Product backup export error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** POST /api/admin/products/restore */
router.post("/admin/products/restore", requirePrimaryAdmin, async (req, res) => {
  try {
    const { mode, backup } = req.body as {
      mode?: "merge" | "replace";
      backup?: unknown;
    };

    const normalizedMode = mode === "replace" ? "replace" : "merge";
    if (!backup || typeof backup !== "object") {
      res.status(400).json({ error: "INVALID_INPUT", message: "Arquivo de backup inválido." });
      return;
    }

    const payload = backup as Record<string, unknown>;
    const rawProducts = Array.isArray(payload.products) ? payload.products : null;
    if (!rawProducts) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Backup sem lista de produtos." });
      return;
    }

    const products = rawProducts.map((item, index) => normalizeBackupProduct(item, index));
    const hasSavedBrands = Object.prototype.hasOwnProperty.call(payload, "savedBrands");
    const savedBrands = hasSavedBrands ? parseSavedBrands(payload.savedBrands) : [];

    await db.transaction(async (tx) => {
      if (normalizedMode === "replace") {
        await tx.delete(productsTable);
      }

      for (const product of products) {
        await tx
          .insert(productsTable)
          .values({
            id: product.id,
            name: product.name,
            description: product.description || null,
            category: product.category,
            brand: product.brand,
            unit: product.unit,
            price: String(product.price),
            costPrice: String(product.costPrice),
            promoPrice: product.promoPrice == null ? null : String(product.promoPrice),
            promoEndsAt: product.promoEndsAt ? new Date(product.promoEndsAt) : null,
            bulkDiscountEnabled: product.bulkDiscountEnabled === true,
            bulkDiscountTiers: product.bulkDiscountTiers.length > 0 ? JSON.stringify(product.bulkDiscountTiers) : null,
            variantGroups: product.variantGroups.length > 0 ? JSON.stringify(product.variantGroups) : null,
            image: product.image,
            isActive: product.isActive !== false,
            isSoldOut: product.isSoldOut === true,
            isLaunch: product.isLaunch === true,
            sortOrder: product.sortOrder,
            createdAt: new Date(product.createdAt),
            updatedAt: new Date(product.updatedAt),
          })
          .onDuplicateKeyUpdate({
            set: {
              name: product.name,
              description: product.description || null,
              category: product.category,
              brand: product.brand,
              unit: product.unit,
              price: String(product.price),
              costPrice: String(product.costPrice),
              promoPrice: product.promoPrice == null ? null : String(product.promoPrice),
              promoEndsAt: product.promoEndsAt ? new Date(product.promoEndsAt) : null,
              bulkDiscountEnabled: product.bulkDiscountEnabled === true,
              bulkDiscountTiers: product.bulkDiscountTiers.length > 0 ? JSON.stringify(product.bulkDiscountTiers) : null,
              variantGroups: product.variantGroups.length > 0 ? JSON.stringify(product.variantGroups) : null,
              image: product.image,
              isActive: product.isActive !== false,
              isSoldOut: product.isSoldOut === true,
              isLaunch: product.isLaunch === true,
              sortOrder: product.sortOrder,
              updatedAt: new Date(product.updatedAt),
            },
          });
      }

      if (hasSavedBrands) {
        if (savedBrands.length === 0) {
          await tx.delete(siteSettingsTable).where(eq(siteSettingsTable.key, ADMIN_SAVED_BRANDS_KEY));
        } else {
          await tx
            .insert(siteSettingsTable)
            .values({
              key: ADMIN_SAVED_BRANDS_KEY,
              value: JSON.stringify(savedBrands),
              updatedAt: new Date(),
            })
            .onDuplicateKeyUpdate({
              set: {
                value: JSON.stringify(savedBrands),
                updatedAt: new Date(),
              },
            });
        }
      }
    });

    res.json({
      ok: true,
      mode: normalizedMode,
      imported: products.length,
      savedBrands: savedBrands.length,
    });
  } catch (err) {
    console.error("Product backup restore error:", err);
    const message = err instanceof Error ? err.message : "Falha ao restaurar backup.";
    res.status(400).json({ error: "INVALID_INPUT", message });
  }
});

/** POST /api/admin/products/upload-image */
router.post("/admin/products/upload-image", requirePrimaryAdmin, async (req, res) => {
  try {
    const { imageData, productId } = req.body as {
      imageData?: string;
      productId?: string | null;
    };

    if (!imageData?.startsWith("data:image/")) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Envie uma imagem válida em JPG, PNG, WebP ou GIF." });
      return;
    }

    if (!isR2Configured()) {
      const missing = getR2MissingConfig();
      res.status(503).json({
        error: "R2_NOT_CONFIGURED",
        message: "Cloudflare R2 não está configurado no servidor.",
        missing,
      });
      return;
    }

    const imageUrl = await uploadProductImageToR2({ dataUrl: imageData, productId });
    res.status(201).json({ imageUrl });
  } catch (err) {
    console.error("Upload product image error:", err);
    const code = err instanceof Error ? err.message : "INTERNAL_ERROR";
    if (code === "INVALID_IMAGE_DATA_URL" || code === "UNSUPPORTED_IMAGE_TYPE" || code === "EMPTY_IMAGE") {
      res.status(400).json({ error: code, message: "Imagem inválida para upload." });
      return;
    }
    if (code === "CLOUDFLARE_R2_NOT_CONFIGURED") {
      res.status(503).json({
        error: code,
        message: "Cloudflare R2 não está configurado no servidor.",
        missing: getR2MissingConfig(),
      });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** POST /api/admin/products */
router.post("/admin/products", requirePrimaryAdmin, async (req, res) => {
  try {
    const {
      name, description, category, brand, unit, price,
      costPrice, promoPrice, promoEndsAt, bulkDiscountEnabled, bulkDiscountTiers, variantGroups, image, isActive, isSoldOut, isLaunch, sortOrder,
    } = req.body as {
      name: string; description?: string; category: string; brand?: string | null; unit: string;
      price: number; costPrice?: number | null; promoPrice?: number | null; promoEndsAt?: string | null;
      bulkDiscountEnabled?: boolean;
      bulkDiscountTiers?: BulkDiscountTierInput[] | null;
      variantGroups?: ProductVariantGroupInput[] | null;
      image?: string | null; isActive?: boolean; isSoldOut?: boolean; isLaunch?: boolean; sortOrder?: number;
    };

    if (!name?.trim() || !category?.trim() || price == null) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Nome, categoria e preço são obrigatórios." });
      return;
    }

    const normalizedTiers = parseBulkDiscountTiers(bulkDiscountTiers);
    const validation = validateBulkDiscountTiers(normalizedTiers);
    if (!validation.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: validation.message });
      return;
    }
    const normalizedVariantGroups = parseVariantGroups(variantGroups);

    const id = crypto.randomBytes(8).toString("hex");
    await db.insert(productsTable).values({
      id,
      name:        name.trim(),
      description: description?.trim() || null,
      category:    category.trim(),
      brand:       brand?.trim() || null,
      unit:        unit || "unidade",
      price:       String(price),
      costPrice:   String(Number(costPrice ?? 0)),
      promoPrice:  promoPrice ? String(promoPrice) : null,
      promoEndsAt: promoEndsAt ? new Date(promoEndsAt) : null,
      bulkDiscountEnabled: bulkDiscountEnabled === true,
      bulkDiscountTiers: normalizedTiers.length > 0 ? JSON.stringify(normalizedTiers) : null,
      variantGroups: normalizedVariantGroups.length > 0 ? JSON.stringify(normalizedVariantGroups) : null,
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
        name, description, category, brand, unit, price,
        costPrice, promoPrice, promoEndsAt, bulkDiscountEnabled, bulkDiscountTiers, variantGroups, image, isActive, isSoldOut, isLaunch, sortOrder,
      } = req.body as Partial<{
        name: string; description: string | null; category: string; brand: string | null; unit: string;
        price: number; costPrice: number | null; promoPrice: number | null; promoEndsAt: string | null;
        bulkDiscountEnabled: boolean;
        bulkDiscountTiers: BulkDiscountTierInput[] | null;
        variantGroups: ProductVariantGroupInput[] | null;
        image: string | null; isActive: boolean; isSoldOut: boolean; isLaunch: boolean; sortOrder: number;
      }>;

    const updates: Partial<typeof productsTable.$inferInsert> = { updatedAt: new Date() };
    if (name       !== undefined) updates.name        = name?.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (category   !== undefined) updates.category    = category?.trim();
    if (brand      !== undefined) updates.brand       = brand?.trim() || null;
    if (unit       !== undefined) updates.unit        = unit;
    if (price      !== undefined) updates.price       = String(price);
    if (costPrice  !== undefined) updates.costPrice   = String(Number(costPrice ?? 0));
    if (promoPrice !== undefined) updates.promoPrice  = promoPrice ? String(promoPrice) : null;
    if (promoEndsAt !== undefined) updates.promoEndsAt = promoEndsAt ? new Date(promoEndsAt) : null;
    if (bulkDiscountEnabled !== undefined) updates.bulkDiscountEnabled = bulkDiscountEnabled;
    if (bulkDiscountTiers !== undefined) {
      const normalizedTiers = parseBulkDiscountTiers(bulkDiscountTiers);
      const validation = validateBulkDiscountTiers(normalizedTiers);
      if (!validation.ok) {
        res.status(400).json({ error: "INVALID_INPUT", message: validation.message });
        return;
      }
      updates.bulkDiscountTiers = normalizedTiers.length > 0 ? JSON.stringify(normalizedTiers) : null;
    }
    if (variantGroups !== undefined) {
      const normalizedVariantGroups = parseVariantGroups(variantGroups);
      updates.variantGroups = normalizedVariantGroups.length > 0 ? JSON.stringify(normalizedVariantGroups) : null;
    }
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
