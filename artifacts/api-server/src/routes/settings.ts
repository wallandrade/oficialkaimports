import { Router, type IRouter } from "express";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requirePrimaryAdmin } from "./admin-auth";

const router: IRouter = Router();

const PUBLIC_KEYS  = [
  "logo", "banner_desktop", "banner_mobile", "site_name", "site_protected", "payment_protected",
  "checkout_enable_pix", "checkout_enable_card"
];
const ALLOWED_KEYS = [
  ...PUBLIC_KEYS,
  "site_password", "payment_password",
  // Taxas do gateway permitidas
  "gateway_fee_percent",
  "gateway_fee_fixed",
  "gateway_fee_min",
  "gateway_withdraw_percent",
  "gateway_withdraw_fixed"
];

/** GET /api/settings — public, returns only safe display keys */
router.get("/settings", async (_req, res) => {
  try {
    const rows = await db.select().from(siteSettingsTable);
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (PUBLIC_KEYS.includes(row.key)) out[row.key] = row.value;
    }
    res.json(out);
  } catch {
    res.json({});
  }
});

/** GET /api/admin/settings — admin only, returns all allowed keys */
router.get("/admin/settings", requirePrimaryAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(siteSettingsTable);
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (ALLOWED_KEYS.includes(row.key)) out[row.key] = row.value;
    }
    res.json(out);
  } catch {
    res.status(500).json({});
  }
});

/** PUT /api/admin/settings/:key — admin only, upsert a setting value */
router.put("/admin/settings/:key", requirePrimaryAdmin, async (req, res) => {
  try {
    const key = String(req.params.key);
    if (!ALLOWED_KEYS.includes(key)) {
      res.status(400).json({ error: "INVALID_KEY" });
      return;
    }
    const { value } = req.body as { value?: string };
    if (!value) {
      await db.delete(siteSettingsTable).where(eq(siteSettingsTable.key, key));
    } else {
      await db
        .insert(siteSettingsTable)
        .values({ key, value, updatedAt: new Date() })
        .onDuplicateKeyUpdate({
          set: { value, updatedAt: new Date() },
        });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[Settings] Error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** POST /api/verify-password — public endpoint to verify site or payment password */
router.post("/verify-password", async (req, res) => {
  try {
    const { type, password } = req.body as { type?: string; password?: string };
    if (!type || !password) { res.status(400).json({ ok: false }); return; }
    const key = type === "payment" ? "payment_password" : "site_password";
    const row = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key));
    const stored = row[0]?.value;
    if (!stored) { res.json({ ok: true, protected: false }); return; }
    res.json({ ok: password === stored, protected: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/** GET /api/is-protected — check if site/payment is password protected */
router.get("/is-protected", async (_req, res) => {
  try {
    const rows = await db.select().from(siteSettingsTable);
    const siteProtected = rows.some((r) => r.key === "site_password" && r.value);
    const paymentProtected = rows.some((r) => r.key === "payment_password" && r.value);
    res.json({ site: siteProtected, payment: paymentProtected });
  } catch {
    res.json({ site: false, payment: false });
  }
});

/** DELETE /api/admin/settings/:key — remove a setting (restore default) */
router.delete("/admin/settings/:key", requirePrimaryAdmin, async (req, res) => {
  try {
    const key = String(req.params.key);
    if (!ALLOWED_KEYS.includes(key)) {
      res.status(400).json({ error: "INVALID_KEY" });
      return;
    }
    await db.delete(siteSettingsTable).where(eq(siteSettingsTable.key, key));
    res.json({ ok: true });
  } catch (err) {
    console.error("[Settings] Delete error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
