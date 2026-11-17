import crypto from "node:crypto";
import {
  WHATSAPP_MAX_ATTEMPTS,
  WHATSAPP_SEND_GAP_MS,
  maskWhatsappPhone,
  whatsappBackoffMs,
  whatsappInstanceCanSend,
  whatsappInstanceKey,
  type WhatsappInstanceKey,
  type WhatsappOutboundKind,
} from "./whatsapp-outbound-policy";

export type WhatsappQueueStatus = "pending" | "sending" | "sent" | "failed";

export type WhatsappQueueRow = {
  id: string;
  instanceKey: WhatsappInstanceKey;
  tenantId: string;
  phone: string;
  origin: string;
  kind: WhatsappOutboundKind;
  message: string | null;
  caption: string | null;
  image: string | null;
  optionList: string | null;
  status: WhatsappQueueStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number | null;
  sentAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type WhatsappOutboundDraft = {
  instanceKey: WhatsappInstanceKey;
  tenantId: string;
  phone: string;
  origin: string;
  kind: WhatsappOutboundKind;
  message: string | null;
  caption: string | null;
  image: string | null;
  optionList: string | null;
  immediate?: boolean;
};

export type WhatsappSendOutcome = { ok: true } | { ok: false; error: string; terminal?: boolean };

export interface WhatsappQueueStore {
  lock(instanceKey: string): Promise<boolean>;
  unlock(instanceKey: string): Promise<void>;
  countSentSince(instanceKey: string, sinceMs: number): Promise<number>;
  claimNext(instanceKey: string, now: number): Promise<WhatsappQueueRow | null>;
  markSent(id: string, attempts: number, now: number): Promise<void>;
  markRetry(id: string, attempts: number, error: string, nextAttemptAt: number | null, failed: boolean, now: number): Promise<void>;
  insert(row: WhatsappQueueRow): Promise<void>;
  listReadyInstances(): Promise<string[]>;
}

function clip(value: string | null | undefined, max: number): string | null {
  const text = String(value || "");
  if (!text) return null;
  return text.slice(0, max);
}

function newId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function rowFromDraft(draft: WhatsappOutboundDraft, status: WhatsappQueueStatus, now: number): WhatsappQueueRow {
  return {
    id: newId(),
    instanceKey: whatsappInstanceKey(draft.instanceKey),
    tenantId: String(draft.tenantId || "").slice(0, 255),
    phone: String(draft.phone || "").slice(0, 32),
    origin: String(draft.origin || "aviso").slice(0, 40),
    kind: draft.kind,
    message: clip(draft.message, 20000),
    caption: clip(draft.caption, 20000),
    image: clip(draft.image, 1000),
    optionList: clip(draft.optionList, 20000),
    status,
    attempts: status === "pending" ? 0 : 1,
    lastError: null,
    nextAttemptAt: null,
    sentAt: status === "sent" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function deliverNextWhatsapp(
  instanceKey: string,
  store: WhatsappQueueStore,
  send: (row: WhatsappQueueRow) => Promise<WhatsappSendOutcome>,
  now: number,
): Promise<"locked" | "paced" | "empty" | "sent" | "retry" | "failed"> {
  const locked = await store.lock(instanceKey);
  if (!locked) return "locked";
  try {
    const [sentHour, sentGap] = await Promise.all([
      store.countSentSince(instanceKey, now - 60 * 60 * 1000),
      store.countSentSince(instanceKey, now - WHATSAPP_SEND_GAP_MS),
    ]);
    const gate = whatsappInstanceCanSend({
      sentInLastHour: sentHour,
      sentInLastGap: sentGap > 0,
    });
    if (!gate.ok) return "paced";
    const row = await store.claimNext(instanceKey, now);
    if (!row) return "empty";
    let outcome: WhatsappSendOutcome;
    try {
      outcome = await send(row);
    } catch {
      outcome = { ok: false, error: "request_failed" };
    }
    const attempts = Number(row.attempts || 0) + 1;
    if (outcome.ok) {
      await store.markSent(row.id, attempts, now);
      return "sent";
    }
    const failed = outcome.terminal === true || attempts >= WHATSAPP_MAX_ATTEMPTS;
    const nextAttemptAt = failed ? null : now + whatsappBackoffMs(attempts);
    await store.markRetry(row.id, attempts, outcome.error.slice(0, 120), nextAttemptAt, failed, now);
    console.warn("[WhatsApp fila] envio falhou", {
      instance: instanceKey,
      origin: row.origin,
      phoneMask: maskWhatsappPhone(row.phone),
      attempts,
      error: outcome.error.slice(0, 80),
    });
    return failed ? "failed" : "retry";
  } finally {
    await store.unlock(instanceKey);
  }
}

export async function acceptWhatsappOutbound(
  draft: WhatsappOutboundDraft,
  store: WhatsappQueueStore,
  send: (row: WhatsappQueueRow) => Promise<WhatsappSendOutcome>,
  now: number,
): Promise<{ ok: true; queued: boolean; id: string } | { ok: false; error: string }> {
  const phone = String(draft.phone || "").trim();
  if (!phone) return { ok: false, error: "missing_phone" };
  const instanceKey = whatsappInstanceKey(draft.instanceKey);
  if (!draft.immediate) {
    const row = rowFromDraft({ ...draft, phone, instanceKey }, "pending", now);
    await store.insert(row);
    return { ok: true, queued: true, id: row.id };
  }
  const locked = await store.lock(instanceKey);
  if (!locked) {
    const row = rowFromDraft({ ...draft, phone, instanceKey }, "pending", now);
    await store.insert(row);
    return { ok: true, queued: true, id: row.id };
  }
  try {
    const [sentHour, sentGap] = await Promise.all([
      store.countSentSince(instanceKey, now - 60 * 60 * 1000),
      store.countSentSince(instanceKey, now - WHATSAPP_SEND_GAP_MS),
    ]);
    const gate = whatsappInstanceCanSend({ sentInLastHour: sentHour, sentInLastGap: sentGap > 0 });
    if (!gate.ok) {
      const row = rowFromDraft({ ...draft, phone, instanceKey }, "pending", now);
      await store.insert(row);
      return { ok: true, queued: true, id: row.id };
    }
    const pending = rowFromDraft({ ...draft, phone, instanceKey }, "sending", now);
    let outcome: WhatsappSendOutcome;
    try {
      outcome = await send(pending);
    } catch {
      outcome = { ok: false, error: "request_failed" };
    }
    if (!outcome.ok) return { ok: false, error: outcome.error || "request_failed" };
    pending.status = "sent";
    pending.attempts = 1;
    pending.sentAt = now;
    try {
      await store.insert(pending);
    } catch {
      console.warn("[WhatsApp fila] envio saiu e a marca não gravou", { instance: instanceKey, origin: draft.origin });
    }
    return { ok: true, queued: false, id: pending.id };
  } finally {
    await store.unlock(instanceKey);
  }
}
