import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPersistedOrderItemCost,
  isWithinCostOverwriteWindow,
  parseOrderProductItems,
  patchOrderItemsWithProductCost,
} from "./order-item-cost";

test("custo 0 ou ausente nao conta como snapshot", () => {
  assert.equal(hasPersistedOrderItemCost({ costPrice: 0 }), false);
  assert.equal(hasPersistedOrderItemCost({ costPrice: "0.00" }), false);
  assert.equal(hasPersistedOrderItemCost({}), false);
  assert.equal(hasPersistedOrderItemCost({ costPrice: 560 }), true);
});

test("pedido antigo com custo 0 recebe o custo novo", () => {
  const { items, changed } = patchOrderItemsWithProductCost(
    [{ id: "p1", name: "Retatrutida", quantity: 1, price: 978, costPrice: 0 }],
    "p1",
    560,
    { overwriteExisting: false },
  );
  assert.equal(changed, true);
  assert.equal(items[0]?.costPrice, 560);
});

test("pedido antigo com custo ja gravado permanece", () => {
  const { items, changed } = patchOrderItemsWithProductCost(
    [{ id: "p1", costPrice: 120 }],
    "p1",
    560,
    { overwriteExisting: false },
  );
  assert.equal(changed, false);
  assert.equal(items[0]?.costPrice, 120);
});

test("pedido recente sobrescreve mesmo com custo gravado", () => {
  const { items, changed } = patchOrderItemsWithProductCost(
    [{ id: "p1", costPrice: 120 }, { id: "p2", costPrice: 10 }],
    "p1",
    560,
    { overwriteExisting: true },
  );
  assert.equal(changed, true);
  assert.equal(items[0]?.costPrice, 560);
  assert.equal(items[1]?.costPrice, 10);
});

test("janela de 24h cobre pedido recente e ignora o antigo", () => {
  const now = new Date("2026-08-17T23:00:00.000Z");
  assert.equal(isWithinCostOverwriteWindow(new Date("2026-08-17T10:00:00.000Z"), now), true);
  assert.equal(isWithinCostOverwriteWindow(new Date("2026-08-10T10:00:00.000Z"), now), false);
});

test("parse aceita array e json string", () => {
  assert.deepEqual(parseOrderProductItems([{ id: "a" }]), [{ id: "a" }]);
  assert.deepEqual(parseOrderProductItems('[{"id":"a"}]'), [{ id: "a" }]);
  assert.equal(parseOrderProductItems("nope"), null);
});
