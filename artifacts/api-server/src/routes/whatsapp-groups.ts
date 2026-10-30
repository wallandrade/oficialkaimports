import crypto from "crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import {
  db,
  productsTable,
  siteSettingsTable,
  whatsappGroupCustomPostsTable,
} from "@workspace/db";
import { requirePrimaryAdmin } from "./admin-auth";
import { getR2MissingConfig, isR2Configured, uploadWhatsappGroupImageToR2 } from "../lib/r2";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import {
  GROUP_SETTING_KEYS,
  MAX_CAPTION,
  MAX_LINK,
  parseCustomSchedule,
  parseGroupChats,
  parseProductIds,
  zapiMainCredentials,
  type ScheduleInput,
  type ScheduleMode,
} from "../lib/whatsapp-group-campaign";

const router: IRouter = Router();

function mainStoreProducts() {
  return or(
    eq(productsTable.tenantId, DEFAULT_TENANT_ID),
    isNull(productsTable.tenantId),
    eq(productsTable.tenantId, ""),
  );
}

async function readSetting(key: string): Promise<string> {
  const rows = await db.select({ value: siteSettingsTable.value }).from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  return String(rows[0]?.value || "");
}

async function writeSetting(key: string, value: string): Promise<void> {
  const existing = await db.select({ key: siteSettingsTable.key }).from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  if (existing[0]) {
    await db.update(siteSettingsTable).set({ value, updatedAt: new Date() }).where(eq(siteSettingsTable.key, key));
    return;
  }
  await db.insert(siteSettingsTable).values({ key, value, updatedAt: new Date() });
}

function readJson(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readTimes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function httpsImage(value: string | null | undefined): boolean {
  return String(value || "").startsWith("https://");
}

async function snapshot() {
  const [enabledRaw, idsRaw, chatsRaw] = await Promise.all([
    readSetting(GROUP_SETTING_KEYS.campaignEnabled),
    readSetting(GROUP_SETTING_KEYS.productIds),
    readSetting(GROUP_SETTING_KEYS.chats),
  ]);
  const ids = parseProductIds(readJson(idsRaw));
  const chats = parseGroupChats(readJson(chatsRaw));
  const productRows = await db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      image: productsTable.image,
      isSoldOut: productsTable.isSoldOut,
    })
    .from(productsTable)
    .where(and(mainStoreProducts(), eq(productsTable.isActive, true)));
  const products = productRows
    .map((row) => ({
      id: row.id,
      name: row.name,
      image: httpsImage(row.image) ? String(row.image) : null,
      hasHttpsImage: httpsImage(row.image),
      isSoldOut: Boolean(row.isSoldOut),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const postRows = await db
    .select()
    .from(whatsappGroupCustomPostsTable)
    .orderBy(desc(whatsappGroupCustomPostsTable.createdAt))
    .limit(30);

  return {
    campaignEnabled: enabledRaw.trim() === "1",
    productIds: ids.ok ? ids.ids : [],
    chats: chats.ok ? chats.chats : [],
    products,
    posts: postRows.map(presentPost),
    peptide: { enabled: false as const },
    zapiConfigured: zapiMainCredentials() != null,
  };
}

function presentPost(row: typeof whatsappGroupCustomPostsTable.$inferSelect) {
  const mode: ScheduleMode = row.scheduleMode === "times" || row.scheduleMode === "interval" ? row.scheduleMode : "once";
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    caption: row.caption,
    linkUrl: row.linkUrl || "",
    scheduledAt: row.scheduledAt,
    scheduleMode: mode,
    scheduleTimes: readTimes(row.scheduleTimes),
    intervalHours: row.intervalHours,
    durationDays: row.durationDays,
  };
}

function previousSchedule(row: typeof whatsappGroupCustomPostsTable.$inferSelect): ScheduleInput {
  const mode: ScheduleMode = row.scheduleMode === "times" || row.scheduleMode === "interval" ? row.scheduleMode : "once";
  return {
    scheduledAt: row.scheduledAt,
    scheduleMode: mode,
    scheduleTimes: readTimes(row.scheduleTimes),
    intervalHours: row.intervalHours,
    durationDays: row.durationDays,
  };
}

function cleanLink(value: unknown): { ok: true; link: string } | { ok: false; message: string } {
  const link = String(value ?? "").trim();
  if (!link) return { ok: true, link: "" };
  if (!link.startsWith("https://") || link.length > MAX_LINK || /\s/.test(link)) {
    return { ok: false, message: "O link precisa começar com https://." };
  }
  return { ok: true, link };
}

function cleanCaption(value: unknown): { ok: true; caption: string } | { ok: false; message: string } {
  const caption = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!caption) return { ok: false, message: "Escreva o texto." };
  if (caption.length > MAX_CAPTION) return { ok: false, message: "O texto passa de 1000 caracteres." };
  return { ok: true, caption };
}

function cleanImageUrl(value: unknown): string | null {
  const imageUrl = String(value ?? "").trim();
  if (!imageUrl.startsWith("https://") || imageUrl.length > 2000 || /\s/.test(imageUrl)) return null;
  return imageUrl;
}

router.get("/admin/whatsapp/groups", requirePrimaryAdmin, async (_req, res) => {
  try {
    res.json(await snapshot());
  } catch (error) {
    console.error("[WhatsAppGroups] GET falhou", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Não foi possível carregar a automação." });
  }
});

router.put("/admin/whatsapp/groups", requirePrimaryAdmin, async (req, res) => {
  try {
    const body = req.body as { campaignEnabled?: unknown; productIds?: unknown; chats?: unknown };
    const enabled = body.campaignEnabled === true || body.campaignEnabled === 1 || body.campaignEnabled === "1";
    const ids = parseProductIds(body.productIds);
    if (!ids.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: ids.message });
      return;
    }
    const chats = parseGroupChats(body.chats);
    if (!chats.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: chats.message });
      return;
    }
    await writeSetting(GROUP_SETTING_KEYS.campaignEnabled, enabled ? "1" : "0");
    await writeSetting(GROUP_SETTING_KEYS.productIds, JSON.stringify(ids.ids));
    await writeSetting(GROUP_SETTING_KEYS.chats, JSON.stringify(chats.chats));
    await writeSetting(GROUP_SETTING_KEYS.peptideEnabled, "0");
    res.json(await snapshot());
  } catch (error) {
    console.error("[WhatsAppGroups] PUT falhou", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Não foi possível salvar a automação." });
  }
});

router.post("/admin/whatsapp/groups/upload-image", requirePrimaryAdmin, async (req, res) => {
  try {
    const imageData = String((req.body as { imageData?: unknown })?.imageData || "");
    if (!imageData.startsWith("data:image/")) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Envie uma imagem válida em JPG, PNG, WebP ou GIF." });
      return;
    }
    if (!isR2Configured()) {
      res.status(503).json({
        error: "R2_NOT_CONFIGURED",
        message: "Cloudflare R2 não está configurado no servidor.",
        missing: getR2MissingConfig(),
      });
      return;
    }
    const imageUrl = await uploadWhatsappGroupImageToR2({ dataUrl: imageData });
    res.status(201).json({ imageUrl });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (code === "IMAGE_TOO_LARGE") {
      res.status(400).json({ error: code, message: "Arquivo acima de 10 MB." });
      return;
    }
    if (code === "INVALID_IMAGE_DATA_URL" || code === "UNSUPPORTED_IMAGE_TYPE" || code === "EMPTY_IMAGE") {
      res.status(400).json({ error: code, message: "Envie uma imagem válida em JPG, PNG, WebP ou GIF." });
      return;
    }
    if (code === "CLOUDFLARE_R2_NOT_CONFIGURED") {
      res.status(503).json({ error: code, message: "Cloudflare R2 não está configurado no servidor." });
      return;
    }
    console.error("[WhatsAppGroups] upload falhou", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Não foi possível enviar a imagem." });
  }
});

function scheduleBody(body: Record<string, unknown>) {
  return {
    scheduledAt: body.scheduledAt,
    scheduleMode: body.scheduleMode,
    scheduleTimes: body.scheduleTimes,
    intervalHours: body.intervalHours,
    durationDays: body.durationDays,
  };
}

router.post("/admin/whatsapp/groups/custom", requirePrimaryAdmin, async (req, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const imageUrl = cleanImageUrl(body.imageUrl);
    if (!imageUrl) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Envie a foto antes de salvar." });
      return;
    }
    const caption = cleanCaption(body.caption);
    if (!caption.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: caption.message });
      return;
    }
    const link = cleanLink(body.linkUrl);
    if (!link.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: link.message });
      return;
    }
    const schedule = parseCustomSchedule(scheduleBody(body), new Date(), null);
    if (!schedule.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: schedule.message });
      return;
    }
    const id = crypto.randomBytes(12).toString("hex");
    const now = new Date();
    await db.insert(whatsappGroupCustomPostsTable).values({
      id,
      imageUrl,
      caption: caption.caption,
      linkUrl: link.link || null,
      scheduledAt: schedule.value.scheduledAt,
      scheduleMode: schedule.value.scheduleMode,
      scheduleTimes: schedule.value.scheduleTimes.length ? JSON.stringify(schedule.value.scheduleTimes) : null,
      intervalHours: schedule.value.intervalHours,
      durationDays: schedule.value.durationDays,
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await db.select().from(whatsappGroupCustomPostsTable).where(eq(whatsappGroupCustomPostsTable.id, id)).limit(1);
    res.status(201).json({ post: row ? presentPost(row) : null });
  } catch (error) {
    console.error("[WhatsAppGroups] aviso falhou", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Não foi possível salvar o aviso." });
  }
});

router.put("/admin/whatsapp/groups/custom/:id", requirePrimaryAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{24}$/.test(id)) {
      res.status(404).json({ error: "NOT_FOUND", message: "Aviso não encontrado." });
      return;
    }
    const [current] = await db.select().from(whatsappGroupCustomPostsTable).where(eq(whatsappGroupCustomPostsTable.id, id)).limit(1);
    if (!current) {
      res.status(404).json({ error: "NOT_FOUND", message: "Aviso não encontrado." });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const imageUrl = cleanImageUrl(body.imageUrl);
    if (!imageUrl) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Envie a foto antes de salvar." });
      return;
    }
    const caption = cleanCaption(body.caption);
    if (!caption.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: caption.message });
      return;
    }
    const link = cleanLink(body.linkUrl);
    if (!link.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: link.message });
      return;
    }
    const schedule = parseCustomSchedule(scheduleBody(body), new Date(), previousSchedule(current));
    if (!schedule.ok) {
      res.status(400).json({ error: "INVALID_INPUT", message: schedule.message });
      return;
    }
    await db.update(whatsappGroupCustomPostsTable).set({
      imageUrl,
      caption: caption.caption,
      linkUrl: link.link || null,
      scheduledAt: schedule.value.scheduledAt,
      scheduleMode: schedule.value.scheduleMode,
      scheduleTimes: schedule.value.scheduleTimes.length ? JSON.stringify(schedule.value.scheduleTimes) : null,
      intervalHours: schedule.value.intervalHours,
      durationDays: schedule.value.durationDays,
      updatedAt: new Date(),
    }).where(eq(whatsappGroupCustomPostsTable.id, id));
    const [row] = await db.select().from(whatsappGroupCustomPostsTable).where(eq(whatsappGroupCustomPostsTable.id, id)).limit(1);
    res.json({ post: row ? presentPost(row) : null });
  } catch (error) {
    console.error("[WhatsAppGroups] edição falhou", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Não foi possível salvar o aviso." });
  }
});

router.delete("/admin/whatsapp/groups/custom/:id", requirePrimaryAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{24}$/.test(id)) {
      res.status(404).json({ error: "NOT_FOUND", message: "Aviso não encontrado." });
      return;
    }
    await db.delete(whatsappGroupCustomPostsTable).where(eq(whatsappGroupCustomPostsTable.id, id));
    res.json({ ok: true });
  } catch (error) {
    console.error("[WhatsAppGroups] exclusão falhou", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Não foi possível apagar o aviso." });
  }
});

export default router;
