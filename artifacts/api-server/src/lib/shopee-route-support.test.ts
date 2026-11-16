import assert from "node:assert/strict";
import test from "node:test";

import { phonesMatch, shopeeRouteCustomerReply } from "./shopee-route-core";
import {
  executeShopeeRouteInbound,
  handleShopeeOnSupportMessage,
  type ShopeeRouteInboundOrder,
  type ShopeeRouteInboundStore,
} from "./shopee-route-support";

const SHOPEE_ID = "241116ABCDEFGH";

function order(patch: Partial<ShopeeRouteInboundOrder> & Pick<ShopeeRouteInboundOrder, "id">): ShopeeRouteInboundOrder {
  return {
    tenantId: "tenant_loja1",
    orderNumber: 2790,
    clientPhone: "11999998888",
    shopeeRouteRequestedAt: new Date("2026-11-16T12:00:00.000Z"),
    shopeeOrderId: null,
    shopeeRouteReviewReason: null,
    shopeeWalletCreditedAt: null,
    enviado: false,
    ...patch,
  };
}

function memoryStore(seed: ShopeeRouteInboundOrder[]) {
  const orders = seed.map((row) => ({ ...row }));
  const events: Array<{ orderId: string; action: string }> = [];
  const store: ShopeeRouteInboundStore = {
    async listAwaiting() {
      return orders.filter((row) => row.shopeeRouteRequestedAt && !String(row.shopeeOrderId || "").trim());
    },
    async listByShopeeOrderId(id) {
      return orders.filter((row) => row.shopeeOrderId === id);
    },
    async reload(id) {
      return orders.find((row) => row.id === id) || null;
    },
    async assignShopeeOrderId(id, shopeeOrderId) {
      const row = orders.find((item) => item.id === id);
      if (!row) return;
      row.shopeeOrderId = shopeeOrderId;
      row.shopeeRouteReviewReason = null;
    },
    async markReview(id, motivo) {
      const row = orders.find((item) => item.id === id);
      if (!row || row.shopeeRouteReviewReason === motivo) {
        return { changed: false, tenantId: row?.tenantId ?? null };
      }
      row.shopeeRouteReviewReason = motivo;
      return { changed: true, tenantId: row.tenantId };
    },
    async markEnviado(id) {
      const row = orders.find((item) => item.id === id);
      if (!row) throw new Error("NOT_FOUND");
      if (row.enviado) return { already: true };
      row.enviado = true;
      return { already: false };
    },
    async addEvent(event) {
      events.push({ orderId: event.orderId, action: event.action });
    },
  };
  return { orders, events, store };
}

function textBody(phone: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    type: "ReceivedCallback",
    fromMe: false,
    isGroup: false,
    phone,
    text: { message },
    ...extra,
  };
}

function supportDeps(store: ShopeeRouteInboundStore, sent: string[]) {
  let lookups = 0;
  let receives = 0;
  return {
    lookups: () => lookups,
    receives: () => receives,
    deps: {
      hasAwaiting: async (phone: string) => {
        lookups += 1;
        const rows = await store.listAwaiting();
        return rows.some((row) => phonesMatch(row.clientPhone, phone));
      },
      receive: async (input: { telefone: string; texto: string }) => {
        receives += 1;
        const result = await executeShopeeRouteInbound(input, store);
        if (!result.ok) return result;
        return {
          ok: true as const,
          ja_processado: result.ja_processado,
          mensagem_para_cliente: result.mensagem_para_cliente,
        };
      },
      send: async (message: string) => {
        sent.push(message);
      },
    },
  };
}

test("mensagem de texto grava o ID, marca enviado e responde uma vez", async () => {
  const state = memoryStore([order({ id: "ord-wait" })]);
  const sent: string[] = [];
  const wired = supportDeps(state.store, sent);
  const outcome = await handleShopeeOnSupportMessage(
    textBody("551199998888", SHOPEE_ID),
    wired.deps,
  );
  const saved = state.orders[0];
  assert.equal(outcome, "stop");
  assert.equal(saved?.shopeeOrderId, SHOPEE_ID);
  assert.equal(saved?.enviado, true);
  assert.equal(saved?.shopeeRouteReviewReason, null);
  assert.deepEqual(sent, [shopeeRouteCustomerReply({ pedido: "2790", shopeeOrderId: SHOPEE_ID })]);
  assert.deepEqual(state.events.map((event) => event.action), ["shopee_route_id", "enviado"]);

  const again = await executeShopeeRouteInbound(
    { telefone: "5511999998888", texto: SHOPEE_ID },
    state.store,
  );
  assert.equal(again.ok, true);
  assert.equal(again.ok && again.ja_processado, true);
  assert.equal(saved?.shopeeOrderId, SHOPEE_ID);
  assert.deepEqual(state.events.map((event) => event.action), ["shopee_route_id", "enviado"]);

  const secondMessage = await handleShopeeOnSupportMessage(
    textBody("(11) 99999-8888", SHOPEE_ID),
    wired.deps,
  );
  assert.equal(secondMessage, "continue");
  assert.equal(sent.length, 1);
});

test("ID já gravado em outro pedido do mesmo telefone encerra sem responder", async () => {
  const state = memoryStore([
    order({ id: "ord-wait", orderNumber: 2800, shopeeOrderId: null }),
    order({
      id: "ord-done",
      orderNumber: 2790,
      shopeeOrderId: SHOPEE_ID,
      enviado: true,
    }),
  ]);
  const sent: string[] = [];
  const wired = supportDeps(state.store, sent);
  const outcome = await handleShopeeOnSupportMessage(textBody("11999998888", SHOPEE_ID), wired.deps);
  assert.equal(outcome, "stop");
  assert.deepEqual(sent, []);
  assert.equal(state.orders.find((row) => row.id === "ord-wait")?.shopeeOrderId, null);
  assert.equal(state.orders.find((row) => row.id === "ord-done")?.shopeeOrderId, SHOPEE_ID);
  assert.equal(wired.receives(), 1);
});

test("sem pedido aguardando o atendimento segue e o ID não é gravado", async () => {
  const state = memoryStore([
    order({ id: "ord-paid", shopeeRouteRequestedAt: null, shopeeOrderId: null }),
  ]);
  const sent: string[] = [];
  const wired = supportDeps(state.store, sent);
  const outcome = await handleShopeeOnSupportMessage(textBody("5511999998888", SHOPEE_ID), wired.deps);
  assert.equal(outcome, "continue");
  assert.equal(wired.receives(), 0);
  assert.deepEqual(sent, []);
  assert.equal(state.orders[0]?.shopeeOrderId, null);
  assert.equal(state.orders[0]?.enviado, false);

  const waiting = memoryStore([order({ id: "ord-wait" })]);
  const invalid = await handleShopeeOnSupportMessage(
    textBody("5511999998888", "oi"),
    supportDeps(waiting.store, sent).deps,
  );
  assert.equal(invalid, "continue");
  assert.deepEqual(sent, []);
  assert.equal(waiting.orders[0]?.shopeeOrderId, null);
  assert.equal(waiting.orders[0]?.shopeeRouteReviewReason, "id_invalido");
});

test("exceção na Rota Shopee segue o atendimento e não loga telefone nem texto", async () => {
  const phone = "5511988877766";
  const secret = `texto-secreto-${SHOPEE_ID}`;
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const awaitingBoom = await handleShopeeOnSupportMessage(textBody(phone, secret), {
      hasAwaiting: async () => {
        throw new Error(secret + phone);
      },
      receive: async () => {
        throw new Error("nao-deveria");
      },
      send: async () => {
        throw new Error("nao-deveria");
      },
    });
    const receiveBoom = await handleShopeeOnSupportMessage(textBody(phone, secret), {
      hasAwaiting: async () => true,
      receive: async () => {
        throw new Error(secret + phone);
      },
      send: async () => {
        throw new Error("nao-deveria");
      },
    });
    const sent: string[] = [];
    const state = memoryStore([order({ id: "ord-wait", clientPhone: "11988877766" })]);
    const sendBoom = await handleShopeeOnSupportMessage(textBody(phone, SHOPEE_ID), {
      ...supportDeps(state.store, sent).deps,
      send: async () => {
        throw new Error(secret);
      },
    });
    assert.equal(awaitingBoom, "continue");
    assert.equal(receiveBoom, "continue");
    assert.equal(sendBoom, "continue");
    assert.equal(state.orders[0]?.shopeeOrderId, SHOPEE_ID);
    assert.deepEqual(sent, []);
    const logged = JSON.stringify(warnings);
    assert.equal(logged.includes(secret), false);
    assert.equal(logged.includes(phone), false);
    assert.equal(logged.includes(SHOPEE_ID), false);
  } finally {
    console.warn = original;
  }
});

test("fromMe, grupo e status não consultam pedido aguardando", async () => {
  const state = memoryStore([order({ id: "ord-wait" })]);
  const sent: string[] = [];
  const wired = supportDeps(state.store, sent);
  const ignored = [
    textBody("5511999998888", SHOPEE_ID, { fromMe: true }),
    textBody("5511999998888", SHOPEE_ID, { fromMe: "true" }),
    textBody("5511999998888", SHOPEE_ID, { isGroup: true }),
    textBody("5511999998888", SHOPEE_ID, { isGroup: 1 }),
    textBody("5511999998888", SHOPEE_ID, { isNewsletter: true }),
    textBody("5511999998888", SHOPEE_ID, { type: "MessageStatusCallback" }),
    textBody("5511999998888", SHOPEE_ID, { type: "DeliveryCallback" }),
    textBody("5511999998888", SHOPEE_ID, { isStatusReply: true }),
    {
      type: "ReceivedCallback",
      fromMe: false,
      isGroup: false,
      phone: "5511999998888",
      listResponseMessage: { selectedRowId: "meu-pedido" },
      text: { message: SHOPEE_ID },
    },
  ];
  for (const body of ignored) {
    const outcome = await handleShopeeOnSupportMessage(body, wired.deps);
    assert.equal(outcome, "continue");
  }
  assert.equal(wired.lookups(), 0);
  assert.equal(wired.receives(), 0);
  assert.deepEqual(sent, []);
  assert.equal(state.orders[0]?.shopeeOrderId, null);
});
