import assert from "node:assert/strict";
import test from "node:test";

import {
  applyYuryInventoryWebhookBalances,
  buildYuryInventoryExitBody,
  interpretYuryInventoryExitResponse,
  mapKaItemsToYuryExitItems,
  mergeYuryInventorySnapshot,
  parseYuryInventoryChangedEvent,
  parseYuryInventorySnapshot,
  resolveYuryInventoryExitPool,
} from "./yury-inventory";
import { getYuryInventorySyncToken } from "./motoboy-yury-config";

test("parse snapshot exige motoboy e minas e ignora item sem productId", () => {
  const payload = parseYuryInventorySnapshot({
    syncedAt: "2026-08-30T19:00:00.000Z",
    source: "yury-imports",
    motoboy: [
      { productId: "abc", productName: "Produto X", quantity: 12 },
      { productName: "sem id", quantity: 3 },
    ],
    minas: [
      { productId: "abc", productName: "Produto X", quantity: 4 },
      { productId: "xyz", productName: "Só Minas", quantity: 0 },
    ],
  });
  assert.ok(payload);
  assert.equal(payload.motoboy.length, 1);
  assert.equal(payload.minas.length, 2);
  assert.equal(payload.minas.find((item) => item.productId === "xyz")?.quantity, 0);
  assert.equal(parseYuryInventorySnapshot({ motoboy: [] }), null);
});

test("merge: só em motoboy zera Minas e não zera Motoboy; sumir dos dois zera os dois", () => {
  const merged = mergeYuryInventorySnapshot(
    [
      { productId: "abc", productName: "Produto X", qtyMotoboy: 9, qtyMinas: 9 },
      { productId: "gone", productName: "Sumiu", qtyMotoboy: 5, qtyMinas: 2 },
    ],
    {
      motoboy: [{ productId: "abc", productName: "Produto X", quantity: 12 }],
      minas: [{ productId: "novo", productName: "Novo Minas", quantity: 3 }],
    },
  );
  const abc = merged.find((row) => row.productId === "abc");
  const novo = merged.find((row) => row.productId === "novo");
  const gone = merged.find((row) => row.productId === "gone");
  assert.deepEqual(abc, { productId: "abc", productName: "Produto X", qtyMotoboy: 12, qtyMinas: 0 });
  assert.deepEqual(novo, { productId: "novo", productName: "Novo Minas", qtyMotoboy: 0, qtyMinas: 3 });
  assert.deepEqual(gone, { productId: "gone", productName: "Sumiu", qtyMotoboy: 0, qtyMinas: 0 });
});

test("merge: quantity 0 no snapshot permanece 0 e não apaga a linha", () => {
  const merged = mergeYuryInventorySnapshot(
    [{ productId: "abc", productName: "Produto X", qtyMotoboy: 12, qtyMinas: 4 }],
    {
      motoboy: [{ productId: "abc", productName: "Produto X", quantity: 0 }],
      minas: [{ productId: "abc", productName: "Produto X", quantity: 0 }],
    },
  );
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], { productId: "abc", productName: "Produto X", qtyMotoboy: 0, qtyMinas: 0 });
});

test("webhook grava balances e ignora delta", () => {
  const event = parseYuryInventoryChangedEvent({
    eventId: "evt_1",
    eventType: "inventory.changed",
    data: {
      pool: "minas",
      productId: "abc",
      productName: "Produto X",
      quantityDelta: -1,
      balances: { motoboy: 12, minas: 3 },
    },
  });
  assert.ok(event);
  assert.equal(event.data.balances.motoboy, 12);
  assert.equal(event.data.balances.minas, 3);
  const next = applyYuryInventoryWebhookBalances(
    { productId: "abc", productName: "Produto X", qtyMotoboy: 13, qtyMinas: 4 },
    event.data,
  );
  assert.deepEqual(next, { productId: "abc", productName: "Produto X", qtyMotoboy: 12, qtyMinas: 3 });
  assert.equal(parseYuryInventoryChangedEvent({ eventId: "x", eventType: "motoboy.neighborhood.upserted" }), null);
});

test("token de inventario usa INVENTORY se existir, senao o da cobertura Motoboy", () => {
  const prevInventory = process.env.YURY_INVENTORY_SYNC_TOKEN;
  const prevMotoboy = process.env.YURY_MOTOBOY_SYNC_TOKEN;
  try {
    process.env.YURY_INVENTORY_SYNC_TOKEN = "";
    process.env.YURY_MOTOBOY_SYNC_TOKEN = "moto-token";
    assert.equal(getYuryInventorySyncToken(), "moto-token");
    process.env.YURY_INVENTORY_SYNC_TOKEN = "inv-token";
    assert.equal(getYuryInventorySyncToken(), "inv-token");
  } finally {
    if (prevInventory == null) delete process.env.YURY_INVENTORY_SYNC_TOKEN;
    else process.env.YURY_INVENTORY_SYNC_TOKEN = prevInventory;
    if (prevMotoboy == null) delete process.env.YURY_MOTOBOY_SYNC_TOKEN;
    else process.env.YURY_MOTOBOY_SYNC_TOKEN = prevMotoboy;
  }
});

test("pool de baixa: motoboy/minas pelo shippingType; retirada não vai para Yury", () => {
  assert.equal(resolveYuryInventoryExitPool({ shippingType: "Motoboy SP" }), "motoboy");
  assert.equal(resolveYuryInventoryExitPool({ shippingType: "Minas" }), "minas");
  assert.equal(resolveYuryInventoryExitPool({ shippingType: "Frete Normal" }), null);
  assert.equal(resolveYuryInventoryExitPool({
    shippingType: "Retirada",
    motoboyDeliveryDate: "2026-09-02",
    motoboyDeliveryTime: "14:00",
  }), null);
  assert.equal(resolveYuryInventoryExitPool({
    shippingType: "",
    motoboyDeliveryDate: "2026-09-02",
    motoboyDeliveryTime: "14:00",
  }), "motoboy");
});

test("body de exit usa items[] + referenceId e nunca manda orderId", () => {
  const body = buildYuryInventoryExitBody({
    pool: "motoboy",
    items: [{ productId: "abc", quantity: 2 }],
    referenceId: "ka-uuid-1",
    reason: "baixa pelo KA",
  });
  assert.deepEqual(body, {
    pool: "motoboy",
    items: [{ productId: "abc", quantity: 2 }],
    referenceId: "ka-uuid-1",
    reason: "baixa pelo KA",
  });
  assert.equal("orderId" in body, false);
});

test("mapeia productId Yury por id igual ou nome; agrupa quantidade", () => {
  const mapped = mapKaItemsToYuryExitItems(
    [
      { productId: "abc", productName: "Produto X", quantity: 1 },
      { productId: null, productName: "Produto X", quantity: 2 },
      { productId: "local-id", productName: "Só Minas", quantity: 1 },
    ],
    [
      { productId: "abc", productName: "Produto X" },
      { productId: "xyz", productName: "Só Minas" },
    ],
  );
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.deepEqual(mapped.items, [
    { productId: "abc", quantity: 3 },
    { productId: "xyz", quantity: 1 },
  ]);
  const missing = mapKaItemsToYuryExitItems(
    [{ productId: "nope", productName: "Desconhecido", quantity: 1 }],
    [{ productId: "abc", productName: "Produto X" }],
  );
  assert.equal(missing.ok, false);
});

test("HTTP exit: 201 nova baixa, 200 retry por pool, 400 sem saldo, 404 rota fora do ar", () => {
  assert.deepEqual(interpretYuryInventoryExitResponse(201, {}), { ok: true, alreadyDebited: false });
  assert.deepEqual(interpretYuryInventoryExitResponse(200, { alreadyDebited: true }), { ok: true, alreadyDebited: true });
  const insufficient = interpretYuryInventoryExitResponse(400, { error: "INSUFFICIENT_STOCK", message: "sem saldo" });
  assert.equal(insufficient.ok, false);
  if (insufficient.ok) return;
  assert.equal(insufficient.code, "INSUFFICIENT_STOCK");
  const missingRoute = interpretYuryInventoryExitResponse(404, null);
  assert.equal(missingRoute.ok, false);
  if (missingRoute.ok) return;
  assert.equal(missingRoute.code, "YURY_EXIT_UNAVAILABLE");
});
