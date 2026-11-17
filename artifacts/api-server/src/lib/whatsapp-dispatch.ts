import { db, siteSettingsTable, tenantSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { postN8nJson } from "./whatsapp-n8n-http";
import { enqueueCustomerWhatsapp, type WhatsappOutboundDraft } from "./whatsapp-outbound-queue";
import {
  WHATSAPP_AUTOMATION_SENDER,
  WHATSAPP_CHANNEL_SETTING,
  parseWhatsappChannel,
  whatsappInstanceKey,
  type WhatsappChannel,
  type WhatsappInstanceKey,
  type WhatsappNoticeOrigin,
  type WhatsappOutboundKind,
} from "./whatsapp-outbound-policy";
import { isHttpsWebhookUrl, toWhatsappText } from "./whatsapp-notices";
import { zapiInstanceReady } from "./zapi-send";
import { DEFAULT_TENANT_ID } from "./tenant-context";

export type CustomerWhatsappInput = {
  origin: WhatsappNoticeOrigin;
  tenantId?: string | null;
  phone: string;
  message?: string;
  caption?: string;
  image?: string;
  optionList?: unknown;
  instance?: WhatsappInstanceKey;
  n8nUrl?: string;
  n8nBody?: Record<string, unknown>;
  deliverN8n?: () => Promise<{ ok: boolean; error?: string }>;
  preferImmediate?: boolean;
};

export type CustomerWhatsappResult = {
  ok: boolean;
  queued?: boolean;
  error?: string;
};

type DispatchDeps = {
  readSetting: (tenantId: string, key: string) => Promise<string>;
  accept: (draft: WhatsappOutboundDraft) => Promise<{ ok: boolean; queued?: boolean; error?: string }>;
  postN8n: (url: string, body: Record<string, unknown>) => Promise<boolean>;
  zapiReady: (instance: WhatsappInstanceKey) => boolean;
};

function httpsImage(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function filmagemImageUrl(env: NodeJS.ProcessEnv = process.env): string {
  return httpsImage(env.ZAPI_FILMAGEM_IMAGE_URL);
}

export function buildOutboundDraft(input: CustomerWhatsappInput): WhatsappOutboundDraft | { error: string } {
  const phone = String(input.phone || "").trim();
  if (!phone) return { error: "missing_phone" };
  const message = input.message == null ? null : toWhatsappText(input.message);
  const caption = input.caption == null ? null : toWhatsappText(input.caption);
  const image = httpsImage(input.image);
  let optionList: string | null = null;
  if (input.optionList != null) {
    try {
      optionList = JSON.stringify(input.optionList).slice(0, 20000);
    } catch {
      optionList = null;
    }
  }
  let kind: WhatsappOutboundKind = "text";
  if (optionList) kind = "option_list";
  else if (image) kind = "image";
  if (kind === "text" && !String(message || caption || "").trim()) return { error: "missing_message" };
  if (kind === "option_list" && !optionList) return { error: "missing_options" };
  return {
    instanceKey: whatsappInstanceKey(input.instance),
    tenantId: String(input.tenantId || "").trim() || DEFAULT_TENANT_ID,
    phone: phone.slice(0, 32),
    origin: input.origin,
    kind,
    message,
    caption: caption || (kind === "image" ? message : null),
    image: image || null,
    optionList,
    immediate: input.preferImmediate === true,
  };
}

async function readTenantSetting(tenantId: string, key: string): Promise<string> {
  const tenantRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);
  if (tenantRows[0]?.value != null) return String(tenantRows[0].value || "").trim();
  if (tenantId !== DEFAULT_TENANT_ID) return "";
  const legacyRows = await db.select({ value: siteSettingsTable.value }).from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  return String(legacyRows[0]?.value || "").trim();
}

function productionDeps(): DispatchDeps {
  return {
    readSetting: readTenantSetting,
    accept: enqueueCustomerWhatsapp,
    postN8n: (url, body) => postN8nJson(url, body),
    zapiReady: (instance) => zapiInstanceReady(instance),
  };
}

export async function readWhatsappChannel(
  origin: WhatsappNoticeOrigin,
  tenantId: string,
  readSetting: DispatchDeps["readSetting"] = readTenantSetting,
): Promise<WhatsappChannel> {
  const raw = await readSetting(tenantId || DEFAULT_TENANT_ID, WHATSAPP_CHANNEL_SETTING[origin]);
  return parseWhatsappChannel(origin, raw);
}

export async function customerWhatsappReady(input: {
  origin: WhatsappNoticeOrigin;
  tenantId: string;
  n8nUrl?: string;
}, deps?: Partial<DispatchDeps>): Promise<boolean> {
  const resolved = { ...productionDeps(), ...deps };
  const tenantId = input.tenantId || DEFAULT_TENANT_ID;
  const channel = await readWhatsappChannel(input.origin, tenantId, resolved.readSetting);
  if (channel === "n8n") return isHttpsWebhookUrl(String(input.n8nUrl || "").trim());
  return resolved.zapiReady("main");
}

function n8nBody(input: CustomerWhatsappInput): Record<string, unknown> {
  if (input.n8nBody) return input.n8nBody;
  const body: Record<string, unknown> = {
    phone: input.phone,
    sender: WHATSAPP_AUTOMATION_SENDER,
  };
  if (input.message != null) body.message = toWhatsappText(input.message);
  if (input.caption != null) body.caption = toWhatsappText(input.caption);
  if (input.optionList != null) body.optionList = input.optionList;
  return body;
}

export async function sendCustomerWhatsapp(input: CustomerWhatsappInput, deps?: Partial<DispatchDeps>): Promise<CustomerWhatsappResult> {
  const resolved = { ...productionDeps(), ...deps };
  const tenantId = String(input.tenantId || "").trim() || DEFAULT_TENANT_ID;
  const channel = await readWhatsappChannel(input.origin, tenantId, resolved.readSetting);
  if (channel === "n8n") {
    if (input.deliverN8n) return input.deliverN8n();
    const url = String(input.n8nUrl || "").trim();
    if (!url) return { ok: false, error: "not_configured" };
    const ok = await resolved.postN8n(url, n8nBody(input));
    return ok ? { ok: true } : { ok: false, error: "n8n_recusou" };
  }
  const draft = buildOutboundDraft({ ...input, tenantId });
  if ("error" in draft) return { ok: false, error: draft.error };
  if (!resolved.zapiReady(draft.instanceKey)) return { ok: false, error: "zapi_not_configured" };
  const accepted = await resolved.accept(draft);
  if (!accepted.ok) return { ok: false, error: accepted.error || "fila_indisponivel" };
  return { ok: true, queued: accepted.queued !== false };
}
