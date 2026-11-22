import { WHATSAPP_AUTOMATION_SENDER } from "./whatsapp-outbound-policy";

const MAIN_STORE_TENANT_ID = "tenant_loja1";

/**
 * Moderação de convite nos grupos da instância main da loja 1.
 * Nasce desligada. Sem lista de IDs, não age em grupo nenhum.
 * Não manda texto no grupo e não entra na fila de envio do cliente.
 * Z-API direto: GET /group-metadata/{id}, DELETE /messages?owner=false, POST /remove-participant.
 */

export const GROUP_MODERATION_ENABLED_SETTING = "whatsapp_group_moderation_enabled";
export const GROUP_MODERATION_DRY_RUN_SETTING = "whatsapp_group_moderation_dry_run";
export const GROUP_MODERATION_GROUP_IDS_SETTING = "whatsapp_group_moderation_group_ids";
export const GROUP_MODERATION_ALLOW_PHONES_SETTING = "whatsapp_group_moderation_allow_phones";
export const GROUP_MODERATION_STORE_PHONE_SETTING = "whatsapp_group_moderation_store_phone";

export const GROUP_MODERATION_STORE_PHONE = WHATSAPP_AUTOMATION_SENDER;
export const GROUP_MODERATION_LOG_INSERT =
  "INSERT IGNORE INTO whatsapp_group_moderation_log (message_id, group_id, participant_tail, reason, action) VALUES (?, ?, ?, ?, ?)";

const ADMIN_CACHE_MS = 10 * 60 * 1000;
const PENDING_RETRY_MS = 2 * 60 * 1000;
const ZAPI_HOST = "https://api.z-api.io";
const GROUP_ID_RE = /^(\d{8,32})(?:-(\d{1,32}|group))?$/;
const MAX_GROUP_IDS = 30;
const MAX_ALLOW_PHONES = 40;

export type GroupModerationMode = "off" | "dry_run" | "enforce";
export type GroupModerationShield = "admin" | "store" | "allowlist";

export type GroupModerationInbound = {
  groupId: string;
  participantPhone: string;
  connectedPhone: string;
  messageId: string;
  fromMe: boolean;
  text: string;
  instanceId: string;
};

export type GroupModerationResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  action?: string;
  groupTail?: string;
};

export type GroupModerationLogRow = {
  messageId: string;
  groupId: string;
  participantTail: string;
  reason: string;
  action: string;
};

export type GroupModerationDeps = {
  env?: NodeJS.ProcessEnv;
  now?: number;
  fetchImpl?: typeof fetch;
  settings?: Record<string, string> | (() => Promise<Record<string, string>>);
  claimLog?: (row: GroupModerationLogRow) => Promise<"claimed" | "duplicate">;
  finishLog?: (messageId: string, action: string) => Promise<void>;
};

type AdminCacheEntry = { at: number; admins: string[] };

const adminCache = new Map<string, AdminCacheEntry>();

export function clearGroupModerationCache(): void {
  adminCache.clear();
}

export function moderationFlag(envValue: string | undefined, settingValue: string | undefined): boolean {
  const env = String(envValue ?? "").trim().toLowerCase();
  if (env === "1" || env === "true" || env === "yes") return true;
  if (env === "0" || env === "false" || env === "no") return false;
  return String(settingValue ?? "").trim() === "1";
}

export function moderationMode(input: {
  enabledEnv?: string;
  enabledSetting?: string;
  dryEnv?: string;
  drySetting?: string;
}): GroupModerationMode {
  if (moderationFlag(input.dryEnv, input.drySetting)) return "dry_run";
  if (moderationFlag(input.enabledEnv, input.enabledSetting)) return "enforce";
  return "off";
}

export function splitModerationList(raw: string): string[] {
  return String(raw || "").split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
}

/** Telefone pode ter espaço e parêntese. A quebra é vírgula, ponto e vírgula ou linha. */
export function splitPhoneList(raw: string): string[] {
  return String(raw || "").split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
}

export function normalizeGroupId(value: string): string {
  return String(value || "").trim().replace(/@(g\.us|s\.whatsapp\.net)$/i, "");
}

export function validGroupId(value: string): boolean {
  const id = normalizeGroupId(value);
  return id.length <= 64 && GROUP_ID_RE.test(id);
}

export function parseModerationGroupIds(raw: unknown): { ok: true; ids: string[] } | { ok: false; message: string } {
  const parts = splitModerationList(String(raw ?? ""));
  if (parts.length > MAX_GROUP_IDS) return { ok: false, message: "No máximo 30 grupos." };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const id = normalizeGroupId(part);
    if (!validGroupId(id)) {
      return { ok: false, message: "Identificador de grupo inválido. Use o número do grupo da Z-API, não o nome." };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ok: true, ids };
}

export function parseModerationPhones(raw: unknown, emptyLabel: string): { ok: true; phones: string[] } | { ok: false; message: string } {
  const parts = splitPhoneList(String(raw ?? ""));
  if (parts.length > MAX_ALLOW_PHONES) return { ok: false, message: "No máximo 40 números." };
  const phones: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const digits = phoneDigits(part);
    if (digits.length < 10 || digits.length > 15) {
      return { ok: false, message: emptyLabel };
    }
    if (seen.has(digits)) continue;
    seen.add(digits);
    phones.push(digits);
  }
  return { ok: true, phones };
}

export function phoneDigits(value: string): string {
  return String(value || "").replace(/\D/g, "").replace(/^0+/, "");
}

export function phonesMatch(left: string, right: string): boolean {
  const a = phoneDigits(left);
  const b = phoneDigits(right);
  if (a.length < 10 || b.length < 10) return false;
  if (a === b) return true;
  const size = Math.min(a.length, b.length);
  return size >= 10 && (a.endsWith(b) || b.endsWith(a));
}

export function groupIsListed(groupId: string, configuredIds: readonly string[]): boolean {
  const id = normalizeGroupId(groupId);
  if (!id) return false;
  return configuredIds.some((item) => normalizeGroupId(item) === id);
}

export function participantTail(phone: string): string {
  return phoneDigits(phone).slice(-4);
}

function pushText(parts: string[], value: unknown): void {
  if (typeof value === "string" && value.trim()) parts.push(value.trim());
}

function collectButtons(parts: string[], buttons: unknown): void {
  if (!Array.isArray(buttons)) return;
  for (const button of buttons) {
    if (!button || typeof button !== "object") continue;
    const row = button as {
      urlButton?: { displayText?: unknown; url?: unknown };
      quickReplyButton?: { displayText?: unknown };
      buttonText?: { displayText?: unknown };
      url?: unknown;
    };
    pushText(parts, row.urlButton?.displayText);
    pushText(parts, row.urlButton?.url);
    pushText(parts, row.quickReplyButton?.displayText);
    pushText(parts, row.buttonText?.displayText);
    pushText(parts, row.url);
  }
}

/** Texto da pessoa: mensagem, legenda e botão. Não inclui a URL de mídia da Z-API. */
export function groupModerationScanText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const row = body as Record<string, unknown>;
  const parts: string[] = [];
  const text = row.text;
  if (typeof text === "string") pushText(parts, text);
  if (text && typeof text === "object") {
    const block = text as Record<string, unknown>;
    pushText(parts, block.message);
    pushText(parts, block.description);
    pushText(parts, block.title);
    pushText(parts, block.url);
  }
  pushText(parts, row.message);
  for (const key of ["image", "video", "document"]) {
    const block = row[key];
    if (!block || typeof block !== "object") continue;
    pushText(parts, (block as { caption?: unknown }).caption);
  }
  const buttonsResponse = row.buttonsResponseMessage;
  if (buttonsResponse && typeof buttonsResponse === "object") {
    pushText(parts, (buttonsResponse as { message?: unknown }).message);
  }
  const list = row.listResponseMessage;
  if (list && typeof list === "object") {
    const block = list as { message?: unknown; title?: unknown };
    pushText(parts, block.message);
    pushText(parts, block.title);
  }
  const buttonsMessage = row.buttonsMessage;
  if (buttonsMessage && typeof buttonsMessage === "object") {
    const block = buttonsMessage as { message?: unknown; buttons?: unknown };
    pushText(parts, block.message);
    collectButtons(parts, block.buttons);
  }
  const hydrated = row.hydratedTemplate;
  if (hydrated && typeof hydrated === "object") {
    const block = hydrated as { message?: unknown; title?: unknown; footer?: unknown; hydratedButtons?: unknown };
    pushText(parts, block.message);
    pushText(parts, block.title);
    pushText(parts, block.footer);
    collectButtons(parts, block.hydratedButtons);
  }
  return parts.join("\n");
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function readGroupModerationInbound(body: unknown): GroupModerationInbound | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (!flag(row.isGroup) || flag(row.isNewsletter) || flag(row.broadcast)) return null;
  const type = String(row.type || "");
  if (type && !/received/i.test(type)) return null;
  const participant = typeof row.participantPhone === "string"
    ? row.participantPhone
    : typeof row.participant === "string"
      ? row.participant
      : "";
  const groupId = normalizeGroupId(String(row.phone || ""));
  if (!groupId) return null;
  return {
    groupId,
    participantPhone: participant.trim(),
    connectedPhone: String(row.connectedPhone || "").trim(),
    messageId: String(row.messageId || "").trim(),
    fromMe: flag(row.fromMe),
    text: groupModerationScanText(body),
    instanceId: String(row.instanceId || "").trim(),
  };
}

export function isGroupModerationCandidate(body: unknown): boolean {
  return readGroupModerationInbound(body) != null;
}

/** Só a instância main da loja 1. Filial e a instância poly ficam de fora. */
export function groupModerationAllowed(input: {
  tenantId: string;
  instanceId: unknown;
  polyInstanceId: string;
  mainInstanceId: string;
}): boolean {
  if (input.tenantId !== MAIN_STORE_TENANT_ID) return false;
  const incoming = String(input.instanceId || "").trim();
  const poly = String(input.polyInstanceId || "").trim();
  if (poly && incoming === poly) return false;
  const main = String(input.mainInstanceId || "").trim();
  if (incoming && main && incoming !== main) return false;
  return true;
}

export function detectGroupInvite(text: string): boolean {
  return /chat\.whatsapp\.com/i.test(String(text || ""));
}

export function groupShield(input: {
  participantPhone: string;
  storePhone: string;
  connectedPhone: string;
  allowPhones: readonly string[];
  adminPhones: readonly string[];
}): GroupModerationShield | null {
  if (input.adminPhones.some((phone) => phonesMatch(phone, input.participantPhone))) return "admin";
  if (phonesMatch(input.storePhone, input.participantPhone) || phonesMatch(input.connectedPhone, input.participantPhone)) {
    return "store";
  }
  if (input.allowPhones.some((phone) => phonesMatch(phone, input.participantPhone))) return "allowlist";
  return null;
}

export function groupAdminPhones(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as { owner?: unknown; participants?: unknown };
  if (!Array.isArray(row.participants)) return null;
  const admins: string[] = [];
  const owner = String(row.owner || "").trim();
  if (owner) admins.push(owner);
  for (const person of row.participants) {
    if (!person || typeof person !== "object") continue;
    const item = person as { phone?: unknown; isAdmin?: unknown; isSuperAdmin?: unknown };
    const admin = flag(item.isAdmin) || flag(item.isSuperAdmin);
    const phone = String(item.phone || "").trim();
    if (admin && phone) admins.push(phone);
  }
  return admins;
}

export function moderationActionLabel(deleted: boolean, removed: boolean): string {
  if (deleted && removed) return "deleted_and_removed";
  if (deleted) return "deleted_remove_failed";
  if (removed) return "delete_failed_removed";
  return "failed";
}

function configuredText(envValue: string | undefined, settingValue: string | undefined): string {
  const env = String(envValue ?? "").trim();
  if (env) return env;
  return String(settingValue ?? "").trim();
}

function storePhoneFrom(envValue: string | undefined, settingValue: string | undefined): string {
  const digits = phoneDigits(configuredText(envValue, settingValue));
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return GROUP_MODERATION_STORE_PHONE;
}

function listedIds(raw: string): string[] {
  const parsed = parseModerationGroupIds(raw);
  return parsed.ok ? parsed.ids : [];
}

function listedPhones(raw: string): string[] {
  const phones: string[] = [];
  const seen = new Set<string>();
  for (const part of splitPhoneList(raw)) {
    const digits = phoneDigits(part);
    if (digits.length < 10 || digits.length > 15 || seen.has(digits)) continue;
    seen.add(digits);
    phones.push(digits);
    if (phones.length >= MAX_ALLOW_PHONES) break;
  }
  return phones;
}

function skip(reason: string, groupId = ""): GroupModerationResult {
  return { ok: true, skipped: true, reason, groupTail: groupId ? groupId.slice(-6) : "" };
}

function mysqlAffectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  if (!header || typeof header !== "object") return 0;
  return Number((header as { affectedRows?: unknown }).affectedRows || 0);
}

async function loadSettings(deps: GroupModerationDeps): Promise<Record<string, string>> {
  try {
    if (typeof deps.settings === "function") return await deps.settings();
    if (deps.settings) return deps.settings;
    const { db, siteSettingsTable } = await import("@workspace/db");
    const { inArray } = await import("drizzle-orm");
    const keys = [
      GROUP_MODERATION_ENABLED_SETTING,
      GROUP_MODERATION_DRY_RUN_SETTING,
      GROUP_MODERATION_GROUP_IDS_SETTING,
      GROUP_MODERATION_ALLOW_PHONES_SETTING,
      GROUP_MODERATION_STORE_PHONE_SETTING,
    ];
    const rows = await db
      .select({ key: siteSettingsTable.key, value: siteSettingsTable.value })
      .from(siteSettingsTable)
      .where(inArray(siteSettingsTable.key, keys));
    return Object.fromEntries(rows.map((row) => [String(row.key), String(row.value || "")]));
  } catch {
    return {};
  }
}

async function claimLogDefault(row: GroupModerationLogRow): Promise<"claimed" | "duplicate"> {
  const { pool } = await import("@workspace/db");
  const messageId = row.messageId.slice(0, 160);
  const [header] = await pool.query(GROUP_MODERATION_LOG_INSERT, [
    messageId,
    row.groupId.slice(0, 64),
    row.participantTail.slice(0, 4),
    row.reason.slice(0, 32),
    row.action.slice(0, 64),
  ]);
  if (mysqlAffectedRows(header) > 0) return "claimed";
  if (row.action === "dry_run") return "duplicate";
  const [rows] = await pool.query(
    "SELECT action, created_at AS createdAt FROM whatsapp_group_moderation_log WHERE message_id = ? LIMIT 1",
    [messageId],
  );
  const existing = Array.isArray(rows) ? rows[0] as { action?: unknown; createdAt?: unknown } : null;
  const action = String(existing?.action || "");
  if (action !== "pending" && action !== "failed") return "duplicate";
  const created = existing?.createdAt instanceof Date
    ? existing.createdAt.getTime()
    : new Date(String(existing?.createdAt || "")).getTime();
  if (!Number.isFinite(created) || Date.now() - created < PENDING_RETRY_MS) return "duplicate";
  const [updated] = await pool.query(
    "UPDATE whatsapp_group_moderation_log SET action = 'pending' WHERE message_id = ? AND action IN ('pending', 'failed')",
    [messageId],
  );
  return mysqlAffectedRows(updated) > 0 ? "claimed" : "duplicate";
}

async function finishLogDefault(messageId: string, action: string): Promise<void> {
  const { pool } = await import("@workspace/db");
  await pool.query(
    "UPDATE whatsapp_group_moderation_log SET action = ? WHERE message_id = ?",
    [action.slice(0, 64), messageId.slice(0, 160)],
  );
}

type ZapiCreds = { instanceId: string; token: string; clientToken: string };

function mainCreds(env: NodeJS.ProcessEnv): ZapiCreds | null {
  const instanceId = String(env.ZAPI_MAIN_INSTANCE_ID || "").trim();
  const token = String(env.ZAPI_MAIN_TOKEN || "").trim();
  const clientToken = String(env.ZAPI_CLIENT_TOKEN || "").trim();
  if (!instanceId || !token || !clientToken) return null;
  if (instanceId.includes("/") || token.includes("/") || clientToken.includes("/")) return null;
  return { instanceId, token, clientToken };
}

async function zapiCall(input: {
  creds: ZapiCreds;
  method: "GET" | "POST" | "DELETE";
  suffix: string;
  body?: unknown;
  fetchImpl: typeof fetch;
}): Promise<{ ok: boolean; json: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const url = `${ZAPI_HOST}/instances/${encodeURIComponent(input.creds.instanceId)}/token/${encodeURIComponent(input.creds.token)}${input.suffix}`;
    const response = await input.fetchImpl(url, {
      method: input.method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Client-Token": input.creds.clientToken,
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let json: unknown = null;
    if (raw.trim()) {
      try {
        json = JSON.parse(raw) as unknown;
      } catch {
        json = null;
      }
    }
    if (response.status < 200 || response.status >= 300) return { ok: false, json };
    if (json && typeof json === "object" && ("error" in json || "erro" in json)) {
      const row = json as { error?: unknown; erro?: unknown };
      if (row.error || row.erro) return { ok: false, json };
    }
    return { ok: true, json };
  } catch {
    return { ok: false, json: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function groupAdmins(groupId: string, creds: ZapiCreds, fetchImpl: typeof fetch, now: number): Promise<string[] | null> {
  const cached = adminCache.get(groupId);
  if (cached && now - cached.at < ADMIN_CACHE_MS) return cached.admins;
  const loaded = await zapiCall({
    creds,
    method: "GET",
    suffix: `/group-metadata/${encodeURIComponent(groupId)}`,
    fetchImpl,
  });
  const admins = groupAdminPhones(loaded.json);
  if (!loaded.ok || !admins) return null;
  adminCache.set(groupId, { at: now, admins });
  return admins;
}

export async function handleGroupModeration(body: unknown, deps: GroupModerationDeps = {}): Promise<GroupModerationResult> {
  const inbound = readGroupModerationInbound(body);
  if (!inbound) return skip("not_group");
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const explicitOff = (value: string | undefined) => {
    const envValue = String(value ?? "").trim().toLowerCase();
    return envValue === "0" || envValue === "false" || envValue === "no";
  };
  const settings = explicitOff(env.WHATSAPP_GROUP_MODERATION_ENABLED) && explicitOff(env.WHATSAPP_GROUP_MODERATION_DRY_RUN)
    ? {}
    : await loadSettings(deps);
  const mode = moderationMode({
    enabledEnv: env.WHATSAPP_GROUP_MODERATION_ENABLED,
    enabledSetting: settings[GROUP_MODERATION_ENABLED_SETTING],
    dryEnv: env.WHATSAPP_GROUP_MODERATION_DRY_RUN,
    drySetting: settings[GROUP_MODERATION_DRY_RUN_SETTING],
  });
  if (mode === "off") return skip("disabled", inbound.groupId);
  if (!inbound.messageId) return skip("missing_message", inbound.groupId);
  if (inbound.fromMe) return skip("from_me", inbound.groupId);

  const groupIds = listedIds(configuredText(env.WHATSAPP_GROUP_MODERATION_GROUP_IDS, settings[GROUP_MODERATION_GROUP_IDS_SETTING]));
  if (groupIds.length === 0) return skip("no_groups", inbound.groupId);
  if (!groupIsListed(inbound.groupId, groupIds)) return skip("out_of_scope", inbound.groupId);
  if (!phoneDigits(inbound.participantPhone) || inbound.participantPhone.includes("@")) {
    return skip("no_phone", inbound.groupId);
  }

  const allowPhones = listedPhones(configuredText(env.WHATSAPP_GROUP_MODERATION_ALLOW_PHONES, settings[GROUP_MODERATION_ALLOW_PHONES_SETTING]));
  const storePhone = storePhoneFrom(env.WHATSAPP_GROUP_MODERATION_STORE_PHONE, settings[GROUP_MODERATION_STORE_PHONE_SETTING]);
  const earlyShield = groupShield({
    participantPhone: inbound.participantPhone,
    storePhone,
    connectedPhone: inbound.connectedPhone,
    allowPhones,
    adminPhones: [],
  });
  if (earlyShield) return skip(earlyShield, inbound.groupId);
  if (!detectGroupInvite(inbound.text)) return skip("clean", inbound.groupId);

  const creds = mainCreds(env);
  if (!creds) return skip("not_configured", inbound.groupId);
  const admins = await groupAdmins(inbound.groupId, creds, fetchImpl, now);
  if (!admins) return skip("admins_unknown", inbound.groupId);
  if (groupShield({
    participantPhone: inbound.participantPhone,
    storePhone,
    connectedPhone: inbound.connectedPhone,
    allowPhones,
    adminPhones: admins,
  }) === "admin") {
    return skip("admin", inbound.groupId);
  }

  const row: GroupModerationLogRow = {
    messageId: inbound.messageId.slice(0, 160),
    groupId: inbound.groupId.slice(0, 64),
    participantTail: participantTail(inbound.participantPhone),
    reason: "invite",
    action: mode === "dry_run" ? "dry_run" : "pending",
  };
  const claim = await (deps.claimLog ?? claimLogDefault)(row);
  if (claim === "duplicate") return skip("duplicate", inbound.groupId);
  if (mode === "dry_run") {
    return { ok: true, skipped: true, reason: "invite", action: "dry_run", groupTail: inbound.groupId.slice(-6) };
  }

  const deleted = await zapiCall({
    creds,
    method: "DELETE",
    suffix: `/messages?messageId=${encodeURIComponent(inbound.messageId)}&phone=${encodeURIComponent(inbound.groupId)}&owner=false`,
    fetchImpl,
  });
  const removed = await zapiCall({
    creds,
    method: "POST",
    suffix: "/remove-participant",
    body: { groupId: inbound.groupId, phones: [phoneDigits(inbound.participantPhone)] },
    fetchImpl,
  });
  const action = moderationActionLabel(deleted.ok, removed.ok);
  await (deps.finishLog ?? finishLogDefault)(inbound.messageId, action);
  return {
    ok: action !== "failed",
    skipped: action === "failed",
    reason: "invite",
    action,
    groupTail: inbound.groupId.slice(-6),
  };
}
