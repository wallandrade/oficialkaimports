import assert from "node:assert/strict";
import test from "node:test";

import { lossBlacklistRowView } from "./loss-blacklist-row.ts";

test("a lista não abre pedido quando o caso antigo não tem order_id", () => {
  assert.deepEqual(lossBlacklistRowView({
    origin: "store",
    orderId: null,
    orderNumber: 1761,
    orderLabel: "1761",
    legacy: true,
  }), {
    label: "1761",
    opensOrder: false,
    legacy: true,
  });
  assert.deepEqual(lossBlacklistRowView({
    origin: "store",
    orderId: null,
    orderNumber: null,
  }), {
    label: "Sem pedido",
    opensOrder: false,
    legacy: true,
  });
  assert.deepEqual(lossBlacklistRowView({
    origin: "store",
    orderId: "order-1",
    orderNumber: 2041,
    orderLabel: "2041",
    legacy: false,
  }), {
    label: "2041",
    opensOrder: true,
    legacy: false,
  });
  assert.deepEqual(lossBlacklistRowView({
    origin: "peer",
    orderId: null,
    orderNumber: 999,
    legacy: true,
  }), {
    label: "Outra loja",
    opensOrder: false,
    legacy: false,
  });
});
