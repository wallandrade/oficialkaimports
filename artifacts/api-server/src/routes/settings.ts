import { Router, type IRouter } from "express";
import { db, pool, siteSettingsTable, tenantSettingsTable } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { getR2MissingConfig, isR2Configured, uploadSiteSettingImageToR2 } from "../lib/r2";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";

const router: IRouter = Router();

const PUBLIC_KEYS  = [
  "logo", "banner_desktop", "banner_mobile", "catalog_banner_desktop", "catalog_banner_mobile", "site_name", "site_protected", "payment_protected",
  "checkout_enable_pix", "checkout_enable_card", "checkout_enable_whatsapp", "checkout_pix_gateway", "checkout_free_shipping_min_subtotal",
  "logo_scale",
  "catalog_banner_product_id",
  "promo_countdown_enabled", "promo_countdown_datetime", "promo_countdown_text"
];
const ALLOWED_KEYS = [
  ...PUBLIC_KEYS,
  "site_password", "payment_password",
  // Taxas do gateway permitidas
  "gateway_fee_percent",
  "gateway_fee_fixed",
  "gateway_fee_min",
  "gateway_withdraw_percent",
  "gateway_withdraw_fixed",
  // Webhook de saída (Pushcut/automations)
  "outbound_webhook_url",
  "outbound_webhook_secret",
  "outbound_webhook_enabled",
  "outbound_webhook_event_new_order",
  "outbound_webhook_event_order_paid",
  // Admin helpers
  "admin_saved_brands"
];

const IMAGE_SETTING_KEYS = new Set([
  "logo",
  "banner_desktop",
  "banner_mobile",
  "catalog_banner_desktop",
  "catalog_banner_mobile",
]);

function canManageSettings(scope: ReturnType<typeof getAdminScope>): boolean {
  if (!scope) return false;
  if (scope.isPrimary) return true;
  return scope.tenantId !== DEFAULT_TENANT_ID;
}

function buildTenantSettingsTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(
      eq(tenantSettingsTable.tenantId, tenantId),
      isNull(tenantSettingsTable.tenantId),
      eq(tenantSettingsTable.tenantId, ""),
    );
  }

  return eq(tenantSettingsTable.tenantId, tenantId);
}

function isMissingTenantSettingsTableError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; sqlMessage?: string } | null;
  const text = `${String(e?.message || "")} ${String(e?.sqlMessage || "")}`.toLowerCase();
  return String(e?.code || "") === "ER_NO_SUCH_TABLE" || text.includes("tenant_settings") && text.includes("doesn't exist");
}

async function ensureTenantSettingsTableExists(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id VARCHAR(255) NOT NULL,
      \`key\` VARCHAR(255) NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, \`key\`),
      KEY tenant_settings_key_idx (\`key\`)
    )
  `);
}

async function getTenantSettingsMap(tenantId: string): Promise<Record<string, string>> {
  let rows: Array<typeof tenantSettingsTable.$inferSelect> = [];
  try {
    rows = await db
      .select()
      .from(tenantSettingsTable)
      .where(buildTenantSettingsTenantWhere(tenantId));
  } catch (err) {
    if (!isMissingTenantSettingsTableError(err)) throw err;
    await ensureTenantSettingsTableExists();
    rows = await db
      .select()
      .from(tenantSettingsTable)
      .where(buildTenantSettingsTenantWhere(tenantId));
  }

  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.key] = row.value;
  }

  if (tenantId === DEFAULT_TENANT_ID) {
    const legacyRows = await db.select().from(siteSettingsTable);
    for (const row of legacyRows) {
      if (!(row.key in out)) out[row.key] = row.value;
    }
  }

  return out;
}

async function deleteTenantSetting(tenantId: string, key: string): Promise<void> {
  try {
    await db.delete(tenantSettingsTable).where(and(buildTenantSettingsTenantWhere(tenantId), eq(tenantSettingsTable.key, key)));
  } catch (err) {
    if (!isMissingTenantSettingsTableError(err)) throw err;
    await ensureTenantSettingsTableExists();
    await db.delete(tenantSettingsTable).where(and(buildTenantSettingsTenantWhere(tenantId), eq(tenantSettingsTable.key, key)));
  }
  if (tenantId === DEFAULT_TENANT_ID) {
    await db.delete(siteSettingsTable).where(eq(siteSettingsTable.key, key));
  }
}

async function upsertTenantSetting(tenantId: string, key: string, value: string): Promise<void> {
  try {
    await db
      .insert(tenantSettingsTable)
      .values({ tenantId, key, value, updatedAt: new Date() })
      .onDuplicateKeyUpdate({
        set: { value, updatedAt: new Date() },
      });
  } catch (err) {
    if (!isMissingTenantSettingsTableError(err)) throw err;
    await ensureTenantSettingsTableExists();
    await db
      .insert(tenantSettingsTable)
      .values({ tenantId, key, value, updatedAt: new Date() })
      .onDuplicateKeyUpdate({
        set: { value, updatedAt: new Date() },
      });
  }

  if (tenantId === DEFAULT_TENANT_ID) {
    await db
      .insert(siteSettingsTable)
      .values({ tenantId, key, value, updatedAt: new Date() })
      .onDuplicateKeyUpdate({
        set: { value, updatedAt: new Date() },
      });
  }
}

/** GET /api/settings — public, returns only safe display keys */
router.get("/settings", async (_req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(_req as any);
    const allSettings = await getTenantSettingsMap(tenantId);
    const out: Record<string, string> = {};
    for (const key of PUBLIC_KEYS) {
      if (key in allSettings) out[key] = allSettings[key]!;
    }
    res.json(out);
  } catch {
    res.json({});
  }
});

/** GET /api/admin/settings — admin only, returns all allowed keys */
router.get("/admin/settings", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!canManageSettings(scope)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para gerenciar configurações." });
      return;
    }

    const tenantId = scope?.tenantId || DEFAULT_TENANT_ID;
    const allSettings = await getTenantSettingsMap(tenantId);
    const out: Record<string, string> = {};
    for (const key of ALLOWED_KEYS) {
      if (key in allSettings) out[key] = allSettings[key]!;
    }
    res.json(out);
  } catch {
    res.status(500).json({});
  }
});

/** PUT /api/admin/settings/:key — admin only, upsert a setting value */
router.put("/admin/settings/:key", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!canManageSettings(scope)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para gerenciar configurações." });
      return;
    }

    const tenantId = scope?.tenantId || DEFAULT_TENANT_ID;
    const key = String(req.params.key);
    if (!ALLOWED_KEYS.includes(key)) {
      res.status(400).json({ error: "INVALID_KEY" });
      return;
    }
    const { value } = req.body as { value?: string };
    if (!value) {
      await deleteTenantSetting(tenantId, key);
    } else {
      let storedValue = value;
      if (IMAGE_SETTING_KEYS.has(key) && value.startsWith("data:image/")) {
        if (!isR2Configured()) {
          res.status(503).json({
            error: "R2_NOT_CONFIGURED",
            message: "Cloudflare R2 não está configurado no servidor.",
            missing: getR2MissingConfig(),
          });
          return;
        }
        storedValue = await uploadSiteSettingImageToR2({ dataUrl: value, settingKey: key });
      }
      await upsertTenantSetting(tenantId, key, storedValue);
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
    const tenantId = await resolvePublicTenantId(req);
    const { type, password } = req.body as { type?: string; password?: string };
    if (!type || !password) { res.status(400).json({ ok: false }); return; }
    const key = type === "payment" ? "payment_password" : "site_password";
    const settings = await getTenantSettingsMap(tenantId);
    const stored = settings[key];
    if (!stored) { res.json({ ok: true, protected: false }); return; }
    res.json({ ok: password === stored, protected: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/** GET /api/is-protected — check if site/payment is password protected */
router.get("/is-protected", async (_req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(_req as any);
    const settings = await getTenantSettingsMap(tenantId);
    const siteProtected = Boolean(settings.site_password);
    const paymentProtected = Boolean(settings.payment_password);
    res.json({ site: siteProtected, payment: paymentProtected });
  } catch {
    res.json({ site: false, payment: false });
  }
});

/** DELETE /api/admin/settings/:key — remove a setting (restore default) */
router.delete("/admin/settings/:key", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!canManageSettings(scope)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para gerenciar configurações." });
      return;
    }

    const tenantId = scope?.tenantId || DEFAULT_TENANT_ID;
    const key = String(req.params.key);
    if (!ALLOWED_KEYS.includes(key)) {
      res.status(400).json({ error: "INVALID_KEY" });
      return;
    }
    await deleteTenantSetting(tenantId, key);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Settings] Delete error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
