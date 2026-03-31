import { Router, type IRouter } from "express";
import { db, sellersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdminAuth } from "./admin-auth";

const router: IRouter = Router();

/** GET /api/sellers — public, returns all sellers [{slug, whatsapp}] */
router.get("/sellers", async (_req, res) => {
  try {
    const rows = await db.select({
      slug:     sellersTable.slug,
      whatsapp: sellersTable.whatsapp,
    }).from(sellersTable);
    res.json({ sellers: rows });
  } catch {
    res.json({ sellers: [] });
  }
});

/** GET /api/sellers/:slug — public, returns single seller or 404 */
router.get("/sellers/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const rows = await db.select({
      slug:     sellersTable.slug,
      whatsapp: sellersTable.whatsapp,
    }).from(sellersTable).where(eq(sellersTable.slug, slug.toLowerCase()));
    if (!rows[0]) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** POST /api/admin/sellers — admin only, upsert seller */
router.post("/admin/sellers", requireAdminAuth, async (req, res) => {
  try {
    const { slug, whatsapp } = req.body as { slug?: string; whatsapp?: string };
    if (!slug?.trim()) { res.status(400).json({ error: "MISSING_SLUG" }); return; }
    const clean = slug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!clean) { res.status(400).json({ error: "INVALID_SLUG" }); return; }
    const wNum = (whatsapp || "").replace(/\D/g, "");
    await db
      .insert(sellersTable)
      .values({ slug: clean, whatsapp: wNum, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: sellersTable.slug,
        set: { whatsapp: wNum, updatedAt: new Date() },
      });
    res.json({ ok: true, seller: { slug: clean, whatsapp: wNum } });
  } catch (err) {
    console.error("[Sellers] POST error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** DELETE /api/admin/sellers/:slug — admin only */
router.delete("/admin/sellers/:slug", requireAdminAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    await db.delete(sellersTable).where(eq(sellersTable.slug, slug.toLowerCase()));
    res.json({ ok: true });
  } catch (err) {
    console.error("[Sellers] DELETE error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
