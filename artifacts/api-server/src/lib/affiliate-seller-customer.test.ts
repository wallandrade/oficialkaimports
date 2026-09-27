import assert from "node:assert/strict";
import test from "node:test";

import {
  isSellerLinkOrder,
  priorSellerLinkCode,
  type SellerLinkOrder,
} from "./affiliate-seller-customer";

const current: SellerLinkOrder = {
  id: "affiliate-order",
  createdAt: "2026-09-20T12:00:00.000Z",
  tenantId: "tenant_loja1",
  userId: "user-1",
  clientEmail: "ana@loja.com",
  clientDocument: "123.456.789-09",
};

test("pedido com vendedor conta, com ou sem origem", () => {
  assert.equal(isSellerLinkOrder("", null), false);
  assert.equal(isSellerLinkOrder("carla", "organic"), true);
  assert.equal(isSellerLinkOrder("carla", "link"), true);
  assert.equal(isSellerLinkOrder("carla", null), true);
});

test("compra anterior pelo link do vendedor bloqueia a comissão", () => {
  const candidates: SellerLinkOrder[] = [
    {
      id: "seller-order",
      createdAt: "2026-08-01T12:00:00.000Z",
      tenantId: "tenant_loja1",
      clientEmail: "ANA@loja.com",
      sellerCode: "carla",
      sellerSource: null,
    },
  ];
  assert.equal(priorSellerLinkCode(current, candidates), "carla");
});

test("rodízio anterior também bloqueia", () => {
  const candidates: SellerLinkOrder[] = [
    {
      id: "organic-order",
      createdAt: "2026-08-01T12:00:00.000Z",
      tenantId: "tenant_loja1",
      clientEmail: "ana@loja.com",
      sellerCode: "carla",
      sellerSource: "organic",
    },
  ];
  assert.equal(priorSellerLinkCode(current, candidates), "carla");
});

test("compra do vendedor depois do pedido do afiliado não bloqueia", () => {
  const candidates: SellerLinkOrder[] = [
    {
      id: "later-seller",
      createdAt: "2026-09-21T12:00:00.000Z",
      tenantId: "tenant_loja1",
      clientDocument: "12345678909",
      sellerCode: "bia",
      sellerSource: "link",
    },
  ];
  assert.equal(priorSellerLinkCode(current, candidates), null);
});

test("vários vendedores: usa o link mais recente anterior", () => {
  const candidates: SellerLinkOrder[] = [
    {
      id: "old",
      createdAt: "2026-01-01T12:00:00.000Z",
      tenantId: null,
      userId: "user-1",
      sellerCode: "ana",
      sellerSource: "link",
    },
    {
      id: "recent",
      createdAt: "2026-07-01T12:00:00.000Z",
      tenantId: "tenant_loja1",
      userId: "user-1",
      sellerCode: "bia",
      sellerSource: "link",
    },
  ];
  assert.equal(priorSellerLinkCode(current, candidates), "bia");
});
