import assert from "node:assert/strict";
import test from "node:test";

import { reshipmentDashboardAmount } from "./reshipment-sale-amount";

test("pedido normal entra com o total", () => {
  assert.equal(reshipmentDashboardAmount({ total: "835.00", observation: null }), 835);
});

test("filho de reenvio sem acréscimo não entra no Total Pago", () => {
  assert.equal(reshipmentDashboardAmount({
    observation: "REENVIO DO PEDIDO abc · TICKET 1",
    parentOrderId: "abc",
    total: "1110.00",
    reshipmentCoveredAmount: "1110.00",
  }), 0);
});

test("filho antigo sem teto gravado também não puxa o valor original", () => {
  assert.equal(reshipmentDashboardAmount({
    observation: "REENVIO DO PEDIDO abc",
    total: "1110.00",
    reshipmentCoveredAmount: null,
  }), 0);
});

test("filho marcado pago só soma o acréscimo de hoje", () => {
  assert.equal(reshipmentDashboardAmount({
    parentOrderId: "abc",
    total: "1310.00",
    reshipmentCoveredAmount: "1110.00",
  }), 200);
});
