import type { PoolConnection } from "mysql2/promise";
import { pool } from "@workspace/db";
import { sendZapiMessage, zapiInstanceReady } from "./zapi-send";
import { maskWhatsappPhone, whatsappInstanceKey, type WhatsappInstanceKey } from "./whatsapp-outbound-policy";
import {
  acceptWhatsappOutbound,
  deliverNextWhatsapp,
  type WhatsappOutboundDraft,
  type WhatsappQueueRow,
  type WhatsappQueueStatus,
  type WhatsappQueueStore,
  type WhatsappSendOutcome,
} from "./whatsapp-outbound-worker";

export type { WhatsappOutboundDraft, WhatsappQueueRow, WhatsappQueueStore, WhatsappSendOutcome };


export type WhatsappQueueView = {
  counts: { pending: number; sending: number; sent: number; failed: number };
  rows: Array<{
    id: string;
    instance: string;
    origin: string;
    kind: string;
    status: string;
    attempts: number;
    phoneMask: string;
    lastError: string;
    createdAt: string | null;
    sentAt: string | null;
    nextAttemptAt: string | null;
  }>;
};

function clip(value: string | null | undefined, max: number): string | null {
  const text = String(value || "");
  if (!text) return null;
  return text.slice(0, max);
}

function lockName(instanceKey: string): string {
  return `ka_wa_${instanceKey}`.slice(0, 64);
}

function missingTable(err: unknown): boolean {
  return String((err as { code?: string } | null)?.code || "") === "ER_NO_SUCH_TABLE";
}

function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  if (!header || typeof header !== "object") return 0;
  return Number((header as { affectedRows?: unknown }).affectedRows || 0);
}

const heldLocks = new Map<string, PoolConnection>();

function sqlInstance(value: string): WhatsappInstanceKey {
  return whatsappInstanceKey(value);
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

export const mysqlWhatsappQueue: WhatsappQueueStore = {
  async lock(instanceKey) {
    const key = whatsappInstanceKey(instanceKey);
    if (heldLocks.has(key)) return false;
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query("SELECT GET_LOCK(?, 0) AS locked", [lockName(key)]);
      const got = asRows(rows)[0];
      if (Number(got?.locked) !== 1) {
        conn.release();
        return false;
      }
      heldLocks.set(key, conn);
      return true;
    } catch (err) {
      conn.release();
      if (missingTable(err)) return false;
      throw err;
    }
  },
  async unlock(instanceKey) {
    const key = whatsappInstanceKey(instanceKey);
    const conn = heldLocks.get(key);
    if (!conn) return;
    heldLocks.delete(key);
    try {
      await conn.query("SELECT RELEASE_LOCK(?)", [lockName(key)]);
    } catch {
      console.warn("[WhatsApp fila] não soltou a trava", { instance: key });
    } finally {
      conn.release();
    }
  },
  async countSentSince(instanceKey, sinceMs) {
    const seconds = Math.max(1, Math.round((Date.now() - sinceMs) / 1000));
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM whatsapp_outbound_queue
       WHERE instance_key = ? AND status = 'sent' AND sent_at >= CURRENT_TIMESTAMP - INTERVAL ? SECOND`,
      [whatsappInstanceKey(instanceKey), seconds],
    );
    return Number(asRows(rows)[0]?.total || 0);
  },
  async claimNext(instanceKey) {
    const key = whatsappInstanceKey(instanceKey);
    const [found] = await pool.query(
      `SELECT id FROM whatsapp_outbound_queue
       WHERE instance_key = ?
         AND (
           (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP))
           OR (status = 'sending' AND updated_at <= CURRENT_TIMESTAMP - INTERVAL 15 MINUTE)
         )
       ORDER BY created_at ASC
       LIMIT 1`,
      [key],
    );
    const id = String(asRows(found)[0]?.id || "");
    if (!id) return null;
    const [header] = await pool.query(
      `UPDATE whatsapp_outbound_queue
       SET status = 'sending', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND (
           status = 'pending'
           OR (status = 'sending' AND updated_at <= CURRENT_TIMESTAMP - INTERVAL 15 MINUTE)
         )`,
      [id],
    );
    if (affectedRows(header) !== 1) return null;
    const [rows] = await pool.query(
      `SELECT id, instance_key, tenant_id, phone, origin, kind, message, caption, image, option_list,
              status, attempts, last_error, next_attempt_at, sent_at, created_at, updated_at
       FROM whatsapp_outbound_queue WHERE id = ? LIMIT 1`,
      [id],
    );
    const row = asRows(rows)[0];
    if (!row) return null;
    return mapRow(row);
  },
  async markSent(id, attempts) {
    await pool.query(
      `UPDATE whatsapp_outbound_queue
       SET status = 'sent', attempts = ?, last_error = NULL, sent_at = CURRENT_TIMESTAMP,
           next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [attempts, id],
    );
  },
  async markRetry(id, attempts, error, nextAttemptAt, failed) {
    const waitSeconds = nextAttemptAt == null ? 0 : Math.max(1, Math.round((nextAttemptAt - Date.now()) / 1000));
    await pool.query(
      `UPDATE whatsapp_outbound_queue
       SET status = ?, attempts = ?, last_error = ?,
           next_attempt_at = ${failed ? "NULL" : "CURRENT_TIMESTAMP + INTERVAL ? SECOND"},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      failed
        ? ["failed", attempts, clip(error, 120), id]
        : ["pending", attempts, clip(error, 120), waitSeconds, id],
    );
  },
  async insert(row) {
    await pool.query(
      `INSERT INTO whatsapp_outbound_queue
        (id, instance_key, tenant_id, phone, origin, kind, message, caption, image, option_list,
         status, attempts, last_error, next_attempt_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ${row.nextAttemptAt == null ? "NULL" : "CURRENT_TIMESTAMP"},
         ${row.sentAt == null ? "NULL" : "CURRENT_TIMESTAMP"})`,
      [
        row.id,
        row.instanceKey,
        row.tenantId || null,
        row.phone,
        row.origin,
        row.kind,
        row.message,
        row.caption,
        row.image,
        row.optionList,
        row.status,
        row.attempts,
        row.lastError,
      ],
    );
  },
  async listReadyInstances() {
    const [rows] = await pool.query(
      `SELECT DISTINCT instance_key AS instanceKey
       FROM whatsapp_outbound_queue
       WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP))
          OR (status = 'sending' AND updated_at <= CURRENT_TIMESTAMP - INTERVAL 15 MINUTE)
       LIMIT 8`,
    );
    return asRows(rows).map((row) => String(row.instanceKey || "")).filter(Boolean);
  },
};

function stampMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

function mapRow(row: Record<string, unknown>): WhatsappQueueRow {
  const kind = String(row.kind || "text");
  return {
    id: String(row.id || ""),
    instanceKey: sqlInstance(String(row.instance_key || row.instanceKey || "main")),
    tenantId: String(row.tenant_id || row.tenantId || ""),
    phone: String(row.phone || ""),
    origin: String(row.origin || ""),
    kind: kind === "image" || kind === "option_list" ? kind : "text",
    message: row.message == null ? null : String(row.message),
    caption: row.caption == null ? null : String(row.caption),
    image: row.image == null ? null : String(row.image),
    optionList: row.option_list == null && row.optionList == null ? null : String(row.option_list ?? row.optionList),
    status: (["pending", "sending", "sent", "failed"].includes(String(row.status)) ? String(row.status) : "pending") as WhatsappQueueStatus,
    attempts: Number(row.attempts || 0),
    lastError: row.last_error == null && row.lastError == null ? null : String(row.last_error ?? row.lastError),
    nextAttemptAt: stampMs(row.next_attempt_at ?? row.nextAttemptAt),
    sentAt: stampMs(row.sent_at ?? row.sentAt),
    createdAt: stampMs(row.created_at ?? row.createdAt) || Date.now(),
    updatedAt: stampMs(row.updated_at ?? row.updatedAt) || Date.now(),
  };
}

async function sendRow(row: WhatsappQueueRow): Promise<WhatsappSendOutcome> {
  let optionList: unknown = row.optionList;
  if (typeof optionList === "string" && optionList.trim()) {
    try {
      optionList = JSON.parse(optionList) as unknown;
    } catch {
      optionList = row.optionList;
    }
  }
  const sent = await sendZapiMessage({
    instance: row.instanceKey,
    phone: row.phone,
    kind: row.kind,
    message: row.message,
    caption: row.caption,
    image: row.image,
    optionList,
    live: true,
  });
  if (sent.ok) return { ok: true };
  return { ok: false, error: sent.error || "request_failed", terminal: sent.terminal };
}

export async function enqueueCustomerWhatsapp(draft: WhatsappOutboundDraft): Promise<{ ok: true; queued: boolean; id: string } | { ok: false; error: string }> {
  const instanceKey = whatsappInstanceKey(draft.instanceKey);
  if (!zapiInstanceReady(instanceKey)) return { ok: false, error: "zapi_not_configured" };
  try {
    return await acceptWhatsappOutbound(draft, mysqlWhatsappQueue, sendRow, Date.now());
  } catch (err) {
    if (!missingTable(err)) console.warn("[WhatsApp fila] não entrou", { instance: instanceKey, origin: draft.origin });
    return { ok: false, error: "fila_indisponivel" };
  }
}

export async function runWhatsappOutboundTick(store: WhatsappQueueStore = mysqlWhatsappQueue, now = Date.now()): Promise<void> {
  let instances: string[] = [];
  try {
    instances = await store.listReadyInstances();
  } catch (err) {
    if (missingTable(err)) return;
    throw err;
  }
  await Promise.all(instances.map(async (instanceKey) => {
    try {
      await deliverNextWhatsapp(instanceKey, store, sendRow, now);
    } catch (err) {
      if (missingTable(err)) return;
      console.warn("[WhatsApp fila] ciclo falhou", { instance: whatsappInstanceKey(instanceKey) });
    }
  }));
}

function iso(value: unknown): string | null {
  const time = stampMs(value);
  return time == null ? null : new Date(time).toISOString();
}

export async function listWhatsappOutboundQueue(tenantId?: string | null): Promise<WhatsappQueueView> {
  const empty: WhatsappQueueView = {
    counts: { pending: 0, sending: 0, sent: 0, failed: 0 },
    rows: [],
  };
  const tenant = String(tenantId || "").trim();
  const filter = tenant ? "WHERE tenant_id = ?" : "";
  const params = tenant ? [tenant] : [];
  try {
    const [counts] = await pool.query(
      `SELECT status, COUNT(*) AS total FROM whatsapp_outbound_queue ${filter} GROUP BY status`,
      params,
    );
    const view: WhatsappQueueView = { counts: { ...empty.counts }, rows: [] };
    for (const row of asRows(counts)) {
      const status = String(row.status || "");
      if (status === "pending" || status === "sending" || status === "sent" || status === "failed") {
        view.counts[status] = Number(row.total || 0);
      }
    }
    const [openRows] = await pool.query(
      `SELECT id, instance_key, origin, kind, status, attempts, phone, last_error, created_at, sent_at, next_attempt_at
       FROM whatsapp_outbound_queue
       ${tenant ? "WHERE tenant_id = ? AND" : "WHERE"} status IN ('pending', 'sending', 'failed')
       ORDER BY created_at DESC
       LIMIT 60`,
      params,
    );
    const [sentRows] = await pool.query(
      `SELECT id, instance_key, origin, kind, status, attempts, phone, last_error, created_at, sent_at, next_attempt_at
       FROM whatsapp_outbound_queue
       ${tenant ? "WHERE tenant_id = ? AND" : "WHERE"} status = 'sent'
       ORDER BY created_at DESC
       LIMIT 20`,
      params,
    );
    view.rows = [...asRows(openRows), ...asRows(sentRows)].map((row) => ({
      id: String(row.id || ""),
      instance: String(row.instance_key || ""),
      origin: String(row.origin || ""),
      kind: String(row.kind || ""),
      status: String(row.status || ""),
      attempts: Number(row.attempts || 0),
      phoneMask: maskWhatsappPhone(String(row.phone || "")),
      lastError: String(row.last_error || "").slice(0, 120),
      createdAt: iso(row.created_at),
      sentAt: iso(row.sent_at),
      nextAttemptAt: iso(row.next_attempt_at),
    }));
    return view;
  } catch (err) {
    if (missingTable(err)) return empty;
    throw err;
  }
}
