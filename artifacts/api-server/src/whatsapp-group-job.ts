import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  pool,
  productsTable,
  siteSettingsTable,
  whatsappGroupCustomPostsTable,
} from "@workspace/db";
import { DEFAULT_TENANT_ID } from "./lib/tenant-context";
import {
  GROUP_SETTING_KEYS,
  buildCustomCaption,
  customSendKey,
  customSlots,
  formatSpLocal,
  groupWindowContains,
  parseGroupChats,
  parseProductIds,
  pickCampaignProduct,
  productAnchor,
  productCaption,
  productSendKey,
  saoPauloClock,
  zapiMainCredentials,
  type ScheduleInput,
  type ScheduleMode,
} from "./lib/whatsapp-group-campaign";

const INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 60_000;
const ZAPI_TIMEOUT_MS = 20_000;
let running = false;

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

function readJson(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function claimSend(id: string): Promise<boolean> {
  const [header] = await pool.query(
    "INSERT IGNORE INTO whatsapp_group_send_log (id, sent_at) VALUES (?, CURRENT_TIMESTAMP)",
    [id],
  );
  return Number((header as { affectedRows?: number }).affectedRows || 0) === 1;
}

async function releaseSend(id: string): Promise<void> {
  await pool.query("DELETE FROM whatsapp_group_send_log WHERE id = ?", [id]);
}

async function sendImage(input: {
  instanceId: string;
  token: string;
  clientToken: string;
  phone: string;
  image: string;
  caption: string;
  logId: string;
}): Promise<void> {
  const claimed = await claimSend(input.logId);
  if (!claimed) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ZAPI_TIMEOUT_MS);
  try {
    const url = `https://api.z-api.io/instances/${input.instanceId}/token/${input.token}/send-image`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": input.clientToken,
      },
      body: JSON.stringify({ phone: input.phone, image: input.image, caption: input.caption }),
      signal: controller.signal,
    });
    if (response.status >= 300) {
      await releaseSend(input.logId);
      console.error("[WhatsAppGroups] Z-API recusou", { status: response.status, phone: input.phone });
      return;
    }
    console.log("[WhatsAppGroups] enviado", { phone: input.phone });
  } catch (error) {
    await releaseSend(input.logId);
    console.error("[WhatsAppGroups] falha", {
      phone: input.phone,
      error: error instanceof Error ? error.message : "request_failed",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function postSchedule(row: {
  scheduledAt: string;
  scheduleMode: string;
  scheduleTimes: string | null;
  intervalHours: number | null;
  durationDays: number | null;
}): ScheduleInput | null {
  const mode = row.scheduleMode;
  if (mode !== "once" && mode !== "times" && mode !== "interval") return null;
  let scheduleTimes: string[] = [];
  if (row.scheduleTimes) {
    try {
      const parsed = JSON.parse(row.scheduleTimes);
      if (Array.isArray(parsed)) scheduleTimes = parsed.filter((item) => typeof item === "string");
    } catch {
      scheduleTimes = [];
    }
  }
  return {
    scheduledAt: row.scheduledAt,
    scheduleMode: mode,
    scheduleTimes,
    intervalHours: row.intervalHours,
    durationDays: row.durationDays,
  };
}

export async function runWhatsappGroupTick(now = new Date()): Promise<void> {
  const creds = zapiMainCredentials();
  if (!creds) return;

  const [enabledRaw, idsRaw, chatsRaw] = await Promise.all([
    readSetting(GROUP_SETTING_KEYS.campaignEnabled),
    readSetting(GROUP_SETTING_KEYS.productIds),
    readSetting(GROUP_SETTING_KEYS.chats),
  ]);
  const chats = parseGroupChats(readJson(chatsRaw));
  const groups = chats.ok ? chats.chats : [];
  if (!groups.length) return;

  const anchor = productAnchor(now);
  if (enabledRaw.trim() === "1" && anchor) {
    const ids = parseProductIds(readJson(idsRaw));
    const productIds = ids.ok ? ids.ids : [];
    if (productIds.length) {
      const rows = await db
        .select({ id: productsTable.id, name: productsTable.name, image: productsTable.image })
        .from(productsTable)
        .where(and(
          mainStoreProducts(),
          eq(productsTable.isActive, true),
          eq(productsTable.isSoldOut, false),
          inArray(productsTable.id, productIds),
          sql`${productsTable.image} LIKE 'https://%'`,
        ));
      const clock = saoPauloClock(now);
      const product = pickCampaignProduct(
        rows.map((row) => ({ id: row.id, name: row.name, image: String(row.image || "") })),
        clock.day,
        clock.hour,
      );
      if (product?.image.startsWith("https://")) {
        const caption = productCaption(product.name, product.id);
        for (let index = 0; index < groups.length; index += 1) {
          if (!groupWindowContains(now, anchor, index)) continue;
          const group = groups[index];
          if (!group) continue;
          await sendImage({
            ...creds,
            phone: group.phone,
            image: product.image,
            caption,
            logId: productSendKey(clock.dateKey, clock.hour, group.phone),
          });
        }
      }
    }
  }

  const posts = await db.select().from(whatsappGroupCustomPostsTable);
  for (const post of posts) {
    const schedule = postSchedule(post);
    if (!schedule || !post.imageUrl.startsWith("https://")) continue;
    const slots = customSlots(schedule);
    const caption = buildCustomCaption(post.caption, post.linkUrl || "", post.imageUrl);
    for (const slot of slots) {
      const slotKey = formatSpLocal(slot);
      for (let index = 0; index < groups.length; index += 1) {
        if (!groupWindowContains(now, slot, index)) continue;
        const group = groups[index];
        if (!group) continue;
        await sendImage({
          ...creds,
          phone: group.phone,
          image: post.imageUrl,
          caption,
          logId: customSendKey(post.id, schedule.scheduleMode as ScheduleMode, group.phone, slotKey),
        });
      }
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runWhatsappGroupTick();
  } catch (error) {
    console.error("[WhatsAppGroups] falha", error);
  } finally {
    running = false;
  }
}

export function startWhatsappGroupJob(): void {
  setTimeout(() => void tick(), STARTUP_DELAY_MS);
  setInterval(() => void tick(), INTERVAL_MS);
}
