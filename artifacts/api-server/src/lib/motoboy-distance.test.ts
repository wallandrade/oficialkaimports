import assert from "node:assert/strict";
import test from "node:test";

import {
  billedKmFromDistance,
  haversineKm,
  isCentroSe,
  isMotoboyDistanceSlotId,
  parseMotoboyDistanceConfig,
  parseMotoboyDistanceEnabled,
  priceForBilledKm,
  quoteMotoboyDistance,
  shouldLookupMotoboyNeighborhoods,
} from "./motoboy-distance";

test("haversine mesmo ponto = 0", () => {
  assert.equal(haversineKm(-23.55, -46.63, -23.55, -46.63), 0);
});

test("haversine 1 grau no equador ~111 km", () => {
  const km = haversineKm(0, 0, 0, 1);
  assert.ok(km > 110 && km < 112);
});

test("isCentroSe CEP 010xxxxx", () => {
  assert.equal(isCentroSe({ cep: "01001-000", bairro: "Qualquer", cidade: "Osasco" }), true);
  assert.equal(isCentroSe({ cep: "01310-100" }), false);
});

test("isCentroSe bairro sé/centro/república em São Paulo", () => {
  assert.equal(isCentroSe({ bairro: "Sé", cidade: "São Paulo" }), true);
  assert.equal(isCentroSe({ bairro: "Centro", cidade: "São Paulo" }), true);
  assert.equal(isCentroSe({ bairro: "República", cidade: "São Paulo" }), true);
  assert.equal(isCentroSe({ bairro: "Centro Histórico", cidade: "São Paulo" }), true);
  assert.equal(isCentroSe({ bairro: "Centro (Sé)", cidade: "São Paulo" }), true);
});

test("isCentroSe não vale fora de SP", () => {
  assert.equal(isCentroSe({ bairro: "Centro", cidade: "Campinas" }), false);
  assert.equal(isCentroSe({ bairro: "Centro", cidade: "Rio de Janeiro" }), false);
});

test("billedKm arredonda para cima", () => {
  assert.equal(billedKmFromDistance(10), 10);
  assert.equal(billedKmFromDistance(10.01), 11);
  assert.equal(billedKmFromDistance(0.4), 1);
});

test("faixas de preço padrão", () => {
  assert.deepEqual(priceForBilledKm(10), { outcome: "priced", price: 70, label: "Até 10 km" });
  assert.deepEqual(priceForBilledKm(11), { outcome: "priced", price: 80, label: "11–15 km" });
  assert.deepEqual(priceForBilledKm(15), { outcome: "priced", price: 80, label: "11–15 km" });
  assert.deepEqual(priceForBilledKm(16), { outcome: "priced", price: 100, label: "16–30 km" });
  assert.deepEqual(priceForBilledKm(30), { outcome: "priced", price: 100, label: "16–30 km" });
  assert.deepEqual(priceForBilledKm(31), { outcome: "priced", price: 120, label: "31–50 km" });
  assert.deepEqual(priceForBilledKm(50), { outcome: "priced", price: 120, label: "31–50 km" });
  assert.deepEqual(priceForBilledKm(51), { outcome: "priced", price: 150, label: "51–80 km" });
  assert.deepEqual(priceForBilledKm(80), { outcome: "priced", price: 150, label: "51–80 km" });
  assert.deepEqual(priceForBilledKm(81), { outcome: "priced", price: 200, label: "81–120 km" });
  assert.deepEqual(priceForBilledKm(120), { outcome: "priced", price: 200, label: "81–120 km" });
  assert.deepEqual(priceForBilledKm(121), { outcome: "priced", price: 300, label: "121–200 km" });
  assert.deepEqual(priceForBilledKm(200), { outcome: "priced", price: 300, label: "121–200 km" });
  assert.deepEqual(priceForBilledKm(201), { outcome: "consult" });
});

test("centro é R$ 50 mesmo com km baixo", () => {
  const q = quoteMotoboyDistance({ cep: "01001000", bairro: "Sé", cidade: "São Paulo", km: 2 });
  assert.equal(q.outcome, "centro");
  if (q.outcome === "centro") assert.equal(q.price, 50);
});

test("até 10 km fora do centro = 70, não 50", () => {
  const q = quoteMotoboyDistance({ cep: "04038001", bairro: "Vila Mariana", cidade: "São Paulo", km: 6.2 });
  assert.equal(q.outcome, "priced");
  if (q.outcome === "priced") {
    assert.equal(q.price, 70);
    assert.equal(q.billedKm, 7);
  }
});

test("Campinas ~90 km não é centro e cai na faixa 81–120", () => {
  const q = quoteMotoboyDistance({ cep: "13010000", bairro: "Centro", cidade: "Campinas", km: 90 });
  assert.equal(q.outcome, "priced");
  if (q.outcome === "priced") assert.equal(q.price, 200);
});

test("acima de 200 km = consultar", () => {
  const q = quoteMotoboyDistance({ cep: "13010000", bairro: "Centro", cidade: "Campinas", km: 250 });
  assert.equal(q.outcome, "consult");
});

test("sem km e sem centro = unavailable", () => {
  const q = quoteMotoboyDistance({ cep: "04038001", bairro: "Vila Mariana", cidade: "São Paulo" });
  assert.equal(q.outcome, "unavailable");
});

test("parse config preenche defaults", () => {
  const cfg = parseMotoboyDistanceConfig('{"centroPrice":55,"bands":[{"maxKm":10,"price":90}]}');
  assert.equal(cfg.centroPrice, 55);
  assert.equal(cfg.consultAfterKm, 200);
  assert.equal(cfg.bands.length, 1);
  assert.equal(cfg.bands[0].price, 90);
});

test("slot id dist", () => {
  assert.equal(isMotoboyDistanceSlotId("dist"), true);
  assert.equal(isMotoboyDistanceSlotId("dist_abc"), true);
  assert.equal(isMotoboyDistanceSlotId("range_1"), false);
});

test("km ligado ignora bairros; km desligado usa bairros", () => {
  assert.equal(shouldLookupMotoboyNeighborhoods(true), false);
  assert.equal(shouldLookupMotoboyNeighborhoods(false), true);
});

test("setting vazio liga km; só valores explícitos desligam", () => {
  assert.equal(parseMotoboyDistanceEnabled(null), true);
  assert.equal(parseMotoboyDistanceEnabled(""), true);
  assert.equal(parseMotoboyDistanceEnabled("0"), false);
  assert.equal(parseMotoboyDistanceEnabled("false"), false);
  assert.equal(parseMotoboyDistanceEnabled("1"), true);
});
