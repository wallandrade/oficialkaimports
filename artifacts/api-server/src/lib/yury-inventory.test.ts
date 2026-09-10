import assert from "node:assert/strict";
import test from "node:test";

import {
  applyYuryInventoryWebhookBalances,
  addKaInventoryExitedPool,
  buildYuryInventoryExitBody,
  defaultKaInventoryExitPool,
  interpretYuryInventoryExitResponse,
  interpretYuryInventoryUnlockResponse,
  mapKaItemsToYuryExitItems,
  mergeYuryInventorySnapshot,
  parseKaInventoryExitPool,
  parseKaInventoryExitedPools,
  parseYuryInventoryChangedEvent,
  parseYuryInventoryExitStatus,
  parseYuryInventorySnapshot,
  pickYuryInventoryPassword,
  resolveYuryInventoryExitPool,
  YURY_EXIT_PASSWORD_HINT,
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

test("pool KA no card: salva loja/motoboy/minas e default segue o frete", () => {
  assert.equal(parseKaInventoryExitPool("Foz Guaçu"), "loja");
  assert.equal(parseKaInventoryExitPool("motoboy"), "motoboy");
  assert.equal(defaultKaInventoryExitPool({ shippingType: "Frete 48h" }), "loja");
  assert.equal(defaultKaInventoryExitPool({ shippingType: "Motoboy" }), "motoboy");
  assert.equal(defaultKaInventoryExitPool({ shippingType: "48h", inventoryExitPool: "minas" }), "minas");
  assert.deepEqual(addKaInventoryExitedPool("loja", "motoboy"), ["loja", "motoboy"]);
  assert.deepEqual(parseKaInventoryExitedPools("loja,motoboy,loja"), ["loja", "motoboy"]);
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

test("HTTP exit 403: PASSWORD_REQUIRED abre campo; INVALID_PASSWORD pede de novo", () => {
  const required = interpretYuryInventoryExitResponse(403, {
    error: "PASSWORD_REQUIRED",
    passwordRequired: true,
    message: "Informe a senha para liberar a baixa. Depois fica 10 minutos e trava de novo.",
  });
  assert.equal(required.ok, false);
  if (required.ok) return;
  assert.equal(required.code, "PASSWORD_REQUIRED");
  assert.equal(required.passwordRequired, true);
  const invalid = interpretYuryInventoryExitResponse(403, { error: "INVALID_PASSWORD", message: "Senha inválida." });
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.code, "INVALID_PASSWORD");
  const bare = interpretYuryInventoryExitResponse(403, { message: YURY_EXIT_PASSWORD_HINT });
  assert.equal(bare.ok, false);
  if (bare.ok) return;
  assert.equal(bare.code, "PASSWORD_REQUIRED");
  assert.equal(bare.passwordRequired, true);
});

test("exit-status e senha no body: password/senha; unlock 10 min; sem orderId", () => {
  assert.deepEqual(parseYuryInventoryExitStatus({
    unlocked: false,
    remainingMs: 0,
    passwordRequired: true,
  }), { unlocked: false, remainingMs: 0, passwordRequired: true });
  assert.deepEqual(parseYuryInventoryExitStatus({
    unlocked: true,
    remainingMs: 600000,
    passwordRequired: false,
  }), { unlocked: true, remainingMs: 600000, passwordRequired: false });
  assert.equal(pickYuryInventoryPassword({ password: "  abc  " }), "abc");
  assert.equal(pickYuryInventoryPassword({ senha: "xyz" }), "xyz");
  assert.equal(pickYuryInventoryPassword({ pool: "motoboy" }), "");
  const withPassword = buildYuryInventoryExitBody({
    pool: "minas",
    items: [{ productId: "abc", quantity: 1 }],
    referenceId: "ka-1",
    password: "segredo",
  });
  assert.equal(withPassword.password, "segredo");
  assert.equal("orderId" in withPassword, false);
  const unlocked = interpretYuryInventoryUnlockResponse(200, { unlocked: true, remainingMs: 600000, passwordRequired: false });
  assert.equal(unlocked.ok, true);
  if (!unlocked.ok) return;
  assert.equal(unlocked.status.unlocked, true);
  assert.equal(unlocked.status.remainingMs, 600000);
  const badUnlock = interpretYuryInventoryUnlockResponse(403, { error: "INVALID_PASSWORD" });
  assert.equal(badUnlock.ok, false);
  if (badUnlock.ok) return;
  assert.equal(badUnlock.code, "INVALID_PASSWORD");
});
