import assert from "node:assert/strict";
import test from "node:test";

import {
  SHIPMENT_ITEM_SETTING_KEYS,
  SUGGESTED_SHIPMENT_ITEM_NAMES,
  ShipmentItemConfigError,
  drawShipmentLabelItem,
  prepareShipmentItemSave,
  randomMoneyInclusive,
  readShipmentItemState,
  suggestedShipmentItemFixedValue,
} from "./envioecom-shipment-item";

const reserve = { reserveName: "Mercadoria", reserveUnitCost: 5 };

test("sugestoes sem faixa vao de 8,90 a 45,00", () => {
  assert.equal(SUGGESTED_SHIPMENT_ITEM_NAMES.length, 20);
  assert.equal(SUGGESTED_SHIPMENT_ITEM_NAMES[0], "Capa de celular");
  assert.equal(SUGGESTED_SHIPMENT_ITEM_NAMES[19], "Hub USB");
  assert.equal(suggestedShipmentItemFixedValue(0), 8.9);
  assert.equal(suggestedShipmentItemFixedValue(3), 14.6);
  assert.equal(suggestedShipmentItemFixedValue(19), 45);
});

test("faixa sorteia inclusive e nao troca o valor gravado da linha", () => {
  assert.equal(randomMoneyInclusive(100, 500, () => 0), 100);
  assert.equal(randomMoneyInclusive(100, 500, () => 0.9999999), 500);
  const drawn = drawShipmentLabelItem({
    pool: [{ name: "Capa de celular", declaredValue: 371.53 }],
    order: [0],
    cursor: 0,
    range: { min: 100, max: 500 },
    quantity: 1,
    ...reserve,
    random: () => 0,
  });
  assert.equal(drawn.name, "Capa de celular");
  assert.equal(drawn.unitCost, 100);
  assert.equal(drawn.consumed, true);
  assert.equal(drawn.cursor, 1);
});

test("sem faixa a etiqueta usa o valor da linha e percorre o baralho uma vez", () => {
  const pool = [
    { name: "Capa de celular", declaredValue: 371.53 },
    { name: "Película de vidro", declaredValue: 203.13 },
    { name: "Carregador USB", declaredValue: 8.9 },
  ];
  let order = [0, 1, 2];
  let cursor = 0;
  const seen: Array<{ name: string; unitCost: number }> = [];
  for (let step = 0; step < 3; step += 1) {
    const drawn = drawShipmentLabelItem({
      pool,
      order,
      cursor,
      range: null,
      quantity: 2,
      ...reserve,
      random: () => 0,
    });
    seen.push({ name: drawn.name, unitCost: drawn.unitCost });
    order = drawn.order;
    cursor = drawn.cursor;
  }
  assert.deepEqual(seen, [
    { name: "Capa de celular", unitCost: 371.53 },
    { name: "Película de vidro", unitCost: 203.13 },
    { name: "Carregador USB", unitCost: 8.9 },
  ]);
  assert.equal(cursor, 3);
  const next = drawShipmentLabelItem({
    pool,
    order,
    cursor,
    range: null,
    quantity: 2,
    ...reserve,
    random: () => 0,
  });
  assert.equal(next.name, "Película de vidro");
  assert.equal(next.cursor, 1);
  assert.equal(next.consumed, true);
});

test("ordem invalida ou cursor no fim embaralha e recomeça", () => {
  const pool = [
    { name: "A", declaredValue: 1 },
    { name: "B", declaredValue: 2 },
  ];
  const drawn = drawShipmentLabelItem({
    pool,
    order: [0, 0],
    cursor: 0,
    range: null,
    quantity: 1,
    ...reserve,
    random: () => 0,
  });
  assert.deepEqual(drawn.order, [1, 0]);
  assert.equal(drawn.name, "B");
  assert.equal(drawn.cursor, 1);
});

test("lista vazia usa a reserva e nao avanca o cursor", () => {
  const drawn = drawShipmentLabelItem({
    pool: [],
    order: [],
    cursor: 4,
    range: { min: 100, max: 500 },
    quantity: 3,
    reserveName: "Tela",
    reserveUnitCost: 89.9,
    random: () => 0,
  });
  assert.equal(drawn.consumed, false);
  assert.equal(drawn.cursor, 4);
  assert.equal(drawn.name, "Tela");
  assert.equal(drawn.unitCost, 89.9);
  assert.equal(drawn.quantity, 3);
});

test("abrir a configuracao so le quantidade antiga, lista e faixa", () => {
  const state = readShipmentItemState({
    [SHIPMENT_ITEM_SETTING_KEYS.legacyQuantity]: "3",
    [SHIPMENT_ITEM_SETTING_KEYS.reserveName]: "Tela",
    [SHIPMENT_ITEM_SETTING_KEYS.reserveValue]: "89,90",
    [SHIPMENT_ITEM_SETTING_KEYS.pool]: JSON.stringify([{ name: "Capa de celular", declaredValue: 371.53 }]),
    [SHIPMENT_ITEM_SETTING_KEYS.order]: "[0]",
    [SHIPMENT_ITEM_SETTING_KEYS.cursor]: "0",
  });
  assert.equal(state.quantity, 3);
  assert.equal(state.items[0].declaredValue, 371.53);
  assert.equal(state.cursor, 0);
  assert.equal(state.range, null);

  const withQty = readShipmentItemState({
    [SHIPMENT_ITEM_SETTING_KEYS.qty]: "4",
    [SHIPMENT_ITEM_SETTING_KEYS.legacyQuantity]: "3",
    [SHIPMENT_ITEM_SETTING_KEYS.valueMin]: "100",
    [SHIPMENT_ITEM_SETTING_KEYS.valueMax]: "500",
  });
  assert.equal(withQty.quantity, 4);
  assert.deepEqual(withQty.range, { min: 100, max: 500 });
  assert.equal(withQty.items.length, 0);
});

test("salvar embaralha os indices, zera o cursor e valida a faixa", () => {
  const prepared = prepareShipmentItemSave({
    quantity: "1",
    items: [
      { name: "Capa de celular", declaredValue: "371,53" },
      { name: "Película de vidro", declaredValue: "203.13" },
    ],
    valueMin: "100",
    valueMax: "500,00",
  }, () => 0);
  assert.equal(prepared.cursor, 0);
  assert.deepEqual(prepared.order, [1, 0]);
  assert.equal(prepared.items[0].name, "Capa de celular");
  assert.equal(prepared.items[0].declaredValue, 371.53);
  assert.equal(prepared.valueMin, "100.00");
  assert.equal(prepared.valueMax, "500.00");

  assert.throws(
    () => prepareShipmentItemSave({ quantity: 1, items: [], valueMin: "10", valueMax: "" }),
    (err: unknown) => err instanceof ShipmentItemConfigError && /juntos/.test(err.message),
  );
  assert.throws(
    () => prepareShipmentItemSave({ quantity: 1, items: [], valueMin: "500", valueMax: "100" }),
    (err: unknown) => err instanceof ShipmentItemConfigError && /mínimo não pode passar/i.test(err.message),
  );
  assert.throws(
    () => prepareShipmentItemSave({
      quantity: 10,
      items: [{ name: "Capa", declaredValue: 1 }],
      valueMin: 0,
      valueMax: 500,
    }),
    (err: unknown) => err instanceof ShipmentItemConfigError && /3000/.test(err.message),
  );
  assert.throws(
    () => prepareShipmentItemSave({
      quantity: 10,
      items: [{ name: "Capa", declaredValue: 500 }],
      valueMin: "",
      valueMax: "",
    }),
    (err: unknown) => err instanceof ShipmentItemConfigError && /valor da linha/.test(err.message),
  );
  assert.throws(
    () => prepareShipmentItemSave({ quantity: 0, items: [], valueMin: "", valueMax: "" }),
    (err: unknown) => err instanceof ShipmentItemConfigError,
  );
  assert.throws(
    () => prepareShipmentItemSave({ quantity: 1000, items: [], valueMin: "", valueMax: "" }),
    (err: unknown) => err instanceof ShipmentItemConfigError,
  );
  assert.throws(
    () => prepareShipmentItemSave({
      quantity: 1,
      items: Array.from({ length: 31 }, (_, index) => ({ name: `Item ${index}`, declaredValue: 1 })),
      valueMin: "",
      valueMax: "",
    }),
    (err: unknown) => err instanceof ShipmentItemConfigError && /30/.test(err.message),
  );
});
