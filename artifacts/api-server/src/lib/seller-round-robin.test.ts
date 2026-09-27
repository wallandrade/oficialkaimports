import assert from "node:assert/strict";
import test from "node:test";

import { pickNextRoundRobinSeller, type SellerRoundRobinCandidate } from "./seller-round-robin-pick";

const sellers: SellerRoundRobinCandidate[] = [
  { slug: "carla", hasCommission: true, commissionRate: 5 },
  { slug: "ana", hasCommission: true, commissionRate: 8 },
  { slug: "bia", hasCommission: false, commissionRate: 10 },
];

test("sem vendedor na loja não atribui ninguém", () => {
  assert.equal(pickNextRoundRobinSeller([], null), null);
  assert.equal(pickNextRoundRobinSeller([{ slug: "  ", hasCommission: true, commissionRate: 5 }], ""), null);
});

test("primeira compra sem cursor vai para o primeiro slug", () => {
  const next = pickNextRoundRobinSeller(sellers, null);
  assert.equal(next?.slug, "ana");
  assert.equal(next?.commissionRate, 8);
});

test("a compra seguinte vai para o próximo e depois volta ao início", () => {
  assert.equal(pickNextRoundRobinSeller(sellers, "ana")?.slug, "bia");
  assert.equal(pickNextRoundRobinSeller(sellers, "bia")?.slug, "carla");
  assert.equal(pickNextRoundRobinSeller(sellers, "carla")?.slug, "ana");
});

test("vendedor sem comissão entra na fila com taxa 0", () => {
  const next = pickNextRoundRobinSeller(sellers, "ana");
  assert.equal(next?.slug, "bia");
  assert.equal(next?.hasCommission, false);
  assert.equal(next?.commissionRate, 0);
});

test("cursor de vendedor removido segue o próximo slug, sem repetir o anterior", () => {
  assert.equal(pickNextRoundRobinSeller(sellers, "amanda")?.slug, "ana");
  assert.equal(pickNextRoundRobinSeller(sellers, "bia-old")?.slug, "carla");
});

test("slug duplicado ou com maiúscula conta uma vez", () => {
  const next = pickNextRoundRobinSeller([
    { slug: " Ana ", hasCommission: true, commissionRate: 4 },
    { slug: "ana", hasCommission: true, commissionRate: 9 },
    { slug: "zoe", hasCommission: true, commissionRate: 3 },
  ], "ANA");
  assert.equal(next?.slug, "zoe");
  assert.equal(next?.commissionRate, 3);
});
