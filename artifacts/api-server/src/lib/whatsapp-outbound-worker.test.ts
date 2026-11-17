import assert from "node:assert/strict";
import test from "node:test";
import { WHATSAPP_MAX_ATTEMPTS, WHATSAPP_SEND_GAP_MS, WHATSAPP_STALE_SENDING_MS } from "./whatsapp-outbound-policy";
import {
  acceptWhatsappOutbound,
  deliverNextWhatsapp,
  type WhatsappOutboundDraft,
  type WhatsappQueueRow,
  type WhatsappQueueStore,
  type WhatsappSendOutcome,
} from "./whatsapp-outbound-worker";

const PHONE = "5500000000000";

class MemoryQueue implements WhatsappQueueStore {
  rows: WhatsappQueueRow[] = [];
  private locks = new Set<string>();

  async lock(instanceKey: string): Promise<boolean> {
    if (this.locks.has(instanceKey)) return false;
    this.locks.add(instanceKey);
    return true;
  }

  async unlock(instanceKey: string): Promise<void> {
    this.locks.delete(instanceKey);
  }

  async countSentSince(instanceKey: string, sinceMs: number): Promise<number> {
    return this.rows.filter((row) => row.instanceKey === instanceKey && row.status === "sent" && (row.sentAt || 0) >= sinceMs).length;
  }

  async claimNext(instanceKey: string, now: number): Promise<WhatsappQueueRow | null> {
    const staleBefore = now - WHATSAPP_STALE_SENDING_MS;
    const row = this.rows
      .filter((item) => item.instanceKey === instanceKey)
      .filter((item) => (
        (item.status === "pending" && (item.nextAttemptAt == null || item.nextAttemptAt <= now))
        || (item.status === "sending" && item.updatedAt <= staleBefore)
      ))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!row) return null;
    row.status = "sending";
    row.updatedAt = now;
    return { ...row };
  }

  async markSent(id: string, attempts: number, now: number): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    if (!row) return;
    row.status = "sent";
    row.attempts = attempts;
    row.sentAt = now;
    row.nextAttemptAt = null;
    row.lastError = null;
    row.updatedAt = now;
  }

  async markRetry(id: string, attempts: number, error: string, nextAttemptAt: number | null, failed: boolean, now: number): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    if (!row) return;
    row.status = failed ? "failed" : "pending";
    row.attempts = attempts;
    row.lastError = error;
    row.nextAttemptAt = nextAttemptAt;
    row.updatedAt = now;
  }

  async insert(row: WhatsappQueueRow): Promise<void> {
    this.rows.push({ ...row });
  }

  async listReadyInstances(): Promise<string[]> {
    return [...new Set(this.rows.filter((row) => row.status === "pending" || row.status === "sending").map((row) => row.instanceKey))];
  }
}

function draft(immediate = false): WhatsappOutboundDraft {
  return {
    instanceKey: "main",
    tenantId: "tenant_loja1",
    phone: PHONE,
    origin: "paid",
    kind: "text",
    message: "pago",
    caption: null,
    image: null,
    optionList: null,
    immediate,
  };
}

test("dois workers não enviam a mesma mensagem", async () => {
  const store = new MemoryQueue();
  const now = Date.parse("2026-11-17T12:00:00Z");
  await acceptWhatsappOutbound(draft(), store, async () => ({ ok: true }), now);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const send = async (): Promise<WhatsappSendOutcome> => {
    calls += 1;
    await gate;
    return { ok: true };
  };
  const first = deliverNextWhatsapp("main", store, send, now);
  const second = deliverNextWhatsapp("main", store, send, now);
  await Promise.resolve();
  release();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(results.sort(), ["locked", "sent"]);
  assert.equal(store.rows.filter((row) => row.status === "sent").length, 1);
});

test("o intervalo de 10 minutos e o teto de 10 por hora seguram o próximo", async () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const recent = new MemoryQueue();
  await recent.insert({ ...draft(), id: "sent-recent", status: "sent", attempts: 1, lastError: null, nextAttemptAt: null, sentAt: now - 5 * 60 * 1000, createdAt: now, updatedAt: now });
  await acceptWhatsappOutbound(draft(), recent, async () => ({ ok: true }), now);
  let calls = 0;
  const paced = await deliverNextWhatsapp("main", recent, async () => {
    calls += 1;
    return { ok: true };
  }, now);
  assert.equal(paced, "paced");
  assert.equal(calls, 0);

  const hourly = new MemoryQueue();
  for (let index = 0; index < 10; index += 1) {
    await hourly.insert({
      ...draft(),
      id: `hour-${index}`,
      status: "sent",
      attempts: 1,
      lastError: null,
      nextAttemptAt: null,
      sentAt: now - 11 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
    });
  }
  await acceptWhatsappOutbound(draft(), hourly, async () => ({ ok: true }), now);
  const blocked = await deliverNextWhatsapp("main", hourly, async () => ({ ok: true }), now);
  assert.equal(blocked, "paced");
});

test("falha espera e na oitava fica como erro", async () => {
  const store = new MemoryQueue();
  let now = Date.parse("2026-11-17T12:00:00Z");
  await acceptWhatsappOutbound(draft(), store, async () => ({ ok: true }), now);
  const send = async (): Promise<WhatsappSendOutcome> => ({ ok: false, error: "http_500" });
  for (let attempt = 1; attempt < WHATSAPP_MAX_ATTEMPTS; attempt += 1) {
    const result = await deliverNextWhatsapp("main", store, send, now);
    assert.equal(result, "retry");
    const row = store.rows[0];
    assert.equal(row?.status, "pending");
    assert.equal(row?.attempts, attempt);
    const tooSoon = await deliverNextWhatsapp("main", store, send, now);
    assert.equal(tooSoon, "empty");
    now = row?.nextAttemptAt || now + WHATSAPP_SEND_GAP_MS;
  }
  const last = await deliverNextWhatsapp("main", store, send, now);
  assert.equal(last, "failed");
  assert.equal(store.rows[0]?.status, "failed");
  assert.equal(store.rows[0]?.attempts, WHATSAPP_MAX_ATTEMPTS);
});

test("envio imediato respeita o intervalo e não chama a rede quando a fila segura", async () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const open = new MemoryQueue();
  let calls = 0;
  const sent = await acceptWhatsappOutbound(draft(true), open, async () => {
    calls += 1;
    return { ok: true };
  }, now);
  assert.equal(sent.ok && sent.queued, false);
  assert.equal(calls, 1);

  const busy = new MemoryQueue();
  await busy.insert({ ...draft(), id: "busy", status: "sent", attempts: 1, lastError: null, nextAttemptAt: null, sentAt: now - 60_000, createdAt: now, updatedAt: now });
  calls = 0;
  const queued = await acceptWhatsappOutbound(draft(true), busy, async () => {
    calls += 1;
    return { ok: true };
  }, now);
  assert.equal(queued.ok && queued.queued, true);
  assert.equal(calls, 0);
  assert.equal(busy.rows.some((row) => row.status === "pending"), true);
});
