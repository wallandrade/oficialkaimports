import { Router, type IRouter } from "express";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requirePrimaryAdmin } from "./admin-auth";
import { syncCustomersToBrevo, testBrevoConnection } from "../lib/brevo";

const router: IRouter = Router();

async function getSettingValue(key: string): Promise<string> {
  const rows = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  return String(rows[0]?.value || "").trim();
}

async function setSetting(key: string, value: string): Promise<void> {
  const existing = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(siteSettingsTable).set({ value, updatedAt: new Date() }).where(eq(siteSettingsTable.key, key));
  } else {
    await db.insert(siteSettingsTable).values({
      key,
      value,
      updatedAt: new Date(),
    });
  }
}

// GET /api/admin/brevo/config — get current Brevo config
router.get("/admin/brevo/config", requirePrimaryAdmin, async (_req, res) => {
  try {
    const apiKey = await getSettingValue("brevo_api_key");
    const configured = !!apiKey;

    res.json({
      configured,
      apiKeySet: configured ? "***" : null,
    });
  } catch (err) {
    console.error("[BREVO] Config error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar configuração." });
  }
});

// PUT /api/admin/brevo/config — update Brevo API key
router.put("/admin/brevo/config", requirePrimaryAdmin, async (req, res) => {
  try {
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey || !apiKey.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "API key é obrigatória." });
      return;
    }

    // Test connection
    const test = await testBrevoConnection(apiKey.trim());
    if (!test.ok) {
      res.status(400).json({
        error: "INVALID_API_KEY",
        message: `Conexão com Brevo falhou: ${test.error}`,
      });
      return;
    }

    // Save API key
    await setSetting("brevo_api_key", apiKey.trim());

    res.json({ ok: true, message: "Brevo API key salva com sucesso." });
  } catch (err) {
    console.error("[BREVO] Config update error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar configuração." });
  }
});

// POST /api/admin/brevo/sync-customers — sync customers to Brevo
router.post("/admin/brevo/sync-customers", requirePrimaryAdmin, async (req, res) => {
  try {
    const { listId } = req.body as { listId?: number };

    console.log(`[BREVO] Starting sync of customers to Brevo${listId ? ` (listId=${listId})` : ""}`);

    const result = await syncCustomersToBrevo(listId);

    if (result.synced === 0 && result.failed === 0) {
      res.status(400).json({
        ok: false,
        ...result,
      });
      return;
    }

    res.json({
      ok: result.failed === 0,
      ...result,
    });
  } catch (err) {
    console.error("[BREVO] Sync error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao sincronizar contatos." });
  }
});

export default router;
