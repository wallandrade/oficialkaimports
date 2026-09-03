import assert from "node:assert/strict";
import test from "node:test";

import { actionFromStatusChange, buildOrderEditPayload, mapOrderEventRow } from "./order-events-core";

test("status paid vira marked_paid só na transição", () => {
  assert.equal(actionFromStatusChange("pending", "paid"), "marked_paid");
  assert.equal(actionFromStatusChange("awaiting_payment", "completed"), "marked_paid");
  assert.equal(actionFromStatusChange("paid", "completed"), "status_changed");
  assert.equal(actionFromStatusChange("paid", "cancelled"), "cancelled");
  assert.equal(actionFromStatusChange("pending", "awaiting_payment"), "status_changed");
});

test("edit payload lista só o que mudou", () => {
  const payload = buildOrderEditPayload(
    {
      clientName: "Ana",
      clientPhone: "11999999999",
      clientEmail: "a@x.com",
      clientDocument: "123",
      addressCity: "SP",
      products: [{ id: "p1", name: "Whey", quantity: 1, price: 100 }],
      discountAmount: 0,
      total: 120,
      status: "paid",
    },
    {
      clientName: "Ana Silva",
      clientPhone: "11999999999",
      clientEmail: "a@x.com",
      clientDocument: "123",
      addressCity: "Campinas",
      products: [{ id: "p1", name: "Whey", quantity: 2, price: 100 }],
      discountAmount: 10,
      total: 210,
      status: "awaiting_payment",
    },
  );
  assert.deepEqual(payload.fields, ["nome", "endereço", "itens", "desconto", "total", "status"]);
  assert.match(String(payload.summary), /nome/);
  assert.match(String(payload.summary), /De paid para awaiting_payment/);
});

test("mapOrderEventRow normaliza ator e data", () => {
  const mapped = mapOrderEventRow({
    id: "oev_1",
    orderId: "abc",
    action: "marked_paid",
    actorType: "ADMIN",
    actorUsername: "  joao  ",
    payload: { fromStatus: "pending", toStatus: "paid" },
    createdAt: new Date("2026-09-03T19:58:00.000Z"),
  });
  assert.equal(mapped.actorType, "admin");
  assert.equal(mapped.actorUsername, "joao");
  assert.equal(mapped.createdAt, "2026-09-03T19:58:00.000Z");
  assert.equal(mapped.payload?.fromStatus, "pending");
});
