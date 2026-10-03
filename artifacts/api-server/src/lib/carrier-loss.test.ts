import assert from "node:assert/strict";
import test from "node:test";

import {
  carrierDisplayName,
  carrierKey,
  classifyCarrierLoss,
  foldPlace,
  lossAlertForCarrier,
  lossRegionKey,
  nextOccurredAt,
  type CarrierLossAlertIncident,
} from "./carrier-loss";

test("transportadora, cidade e bairro perdem acento, caixa e o sufixo envioEcom", () => {
  assert.equal(carrierKey("Jadlog envioEcom"), "jadlog");
  assert.equal(carrierKey("Jadlog"), "jadlog");
  assert.equal(carrierDisplayName("Jadlog envioEcom"), "Jadlog");
  assert.notEqual(carrierKey("Correios Pac"), carrierKey("Correios Sedex"));
  assert.equal(foldPlace("São Paulo"), "sao paulo");
  assert.equal(foldPlace("Sao Paulo"), "sao paulo");
  assert.equal(foldPlace("República"), "republica");
  assert.equal(foldPlace("Republica"), "republica");
});

test("a primeira frase com extravio, roubo, furto ou sinistro classifica", () => {
  assert.equal(classifyCarrierLoss({ status: "Devolvido por extravio" })?.type, "extravio");
  assert.equal(classifyCarrierLoss({ status: "Apreensão fiscal" }), null);
  assert.equal(classifyCarrierLoss({ status: "Endereço insuficiente" }), null);
  assert.equal(classifyCarrierLoss({ status: "Destinatário ausente" }), null);
  assert.equal(classifyCarrierLoss({ status: "Devolvido ao remetente" }), null);
  assert.equal(
    classifyCarrierLoss({
      status: "Em trânsito",
      description: "Objeto com extravio",
    })?.type,
    "extravio",
  );
  assert.deepEqual(
    classifyCarrierLoss({
      status: "Em trânsito",
      history: [
        { at: "2026-08-02T12:00:00.000Z", status: "Roubo" },
        { at: "2026-08-01T12:00:00.000Z", status: "Furto a transportadora" },
      ],
    }),
    { type: "furto", raw: "Furto a transportadora" },
  );
});

test("região de São Paulo, capital e demais cidades", () => {
  assert.equal(lossRegionKey("São Paulo", "SP", "01001000"), "sp-centro");
  assert.equal(lossRegionKey("Sao Paulo", "SP", "01500000"), "sp-centro");
  assert.equal(lossRegionKey("São Paulo", "SP", "03200000"), "sp-leste");
  assert.equal(lossRegionKey("São Paulo", "SP", "05800000"), "sp-oeste");
  assert.equal(lossRegionKey("São Paulo", "SP", "08400000"), "sp-extremo-leste");
  assert.equal(lossRegionKey("São Paulo", "SP", "06000000"), "sp-cep-060");
  assert.equal(lossRegionKey("Rio de Janeiro", "RJ", "20040020"), "rj-cep-200");
  assert.equal(lossRegionKey("Campinas", "SP", "13010000"), "city");
  assert.notEqual(
    lossRegionKey("São Paulo", "SP", "01310000"),
    lossRegionKey("São Paulo", "SP", "03010000"),
  );
});

test("occurred_at só muda quando a linha nasce ou volta da lista", () => {
  const original = new Date("2026-01-01T12:00:00.000Z");
  const now = new Date("2026-08-01T12:00:00.000Z");
  assert.equal(nextOccurredAt(null, now), now);
  assert.equal(nextOccurredAt({ removedAt: new Date("2026-02-01T00:00:00.000Z"), occurredAt: original }, now), now);
  assert.equal(nextOccurredAt({ removedAt: null, occurredAt: original }, now), original);
});

function incident(partial: Partial<CarrierLossAlertIncident> & Pick<CarrierLossAlertIncident, "neighborhoodKey" | "occurredAt">): CarrierLossAlertIncident {
  return {
    carrierKey: "jadlog",
    carrierName: "Jadlog",
    neighborhoodName: "República",
    regionKey: "sp-centro",
    incidentType: "extravio",
    orderNumber: 1234,
    cityName: "São Paulo",
    state: "SP",
    ...partial,
  };
}

test("âmbar com um caso em outro bairro e vermelho no mesmo bairro ou em dois casos", () => {
  const older = incident({
    neighborhoodKey: "republica",
    neighborhoodName: "República",
    occurredAt: new Date("2026-08-12T15:00:00.000Z"),
  });
  const other = incident({
    neighborhoodKey: "se",
    neighborhoodName: "Sé",
    orderNumber: 99,
    occurredAt: new Date("2026-08-01T15:00:00.000Z"),
  });
  assert.equal(lossAlertForCarrier("Jadlog envioEcom", "Bela Vista", [other])?.level, "warn");
  assert.equal(lossAlertForCarrier("Jadlog", "Republica", [older])?.level, "danger");
  assert.equal(lossAlertForCarrier("Jadlog", "Bela Vista", [older, other])?.level, "danger");
  assert.equal(lossAlertForCarrier("Correios Pac", "República", [older]), null);
  assert.equal(
    lossAlertForCarrier("Jadlog", "Republica", [older])?.message,
    "Região Centro de São Paulo teve extravio na Jadlog (bairro República, 12/08, pedido #1234). Cuidado.",
  );
});

test("frase de capital, cidade menor e caso manual", () => {
  const rio = incident({
    regionKey: "rj-cep-200",
    cityName: "Rio de Janeiro",
    state: "RJ",
    neighborhoodKey: "copacabana",
    neighborhoodName: "Copacabana",
    occurredAt: new Date("2026-08-12T15:00:00.000Z"),
  });
  const campinas = incident({
    regionKey: "city",
    cityName: "Campinas",
    state: "SP",
    neighborhoodKey: "centro",
    neighborhoodName: "Centro",
    occurredAt: new Date("2026-08-12T15:00:00.000Z"),
  });
  const manual = incident({
    incidentType: "manual",
    neighborhoodKey: "republica",
    occurredAt: new Date("2026-08-12T15:00:00.000Z"),
  });
  assert.equal(
    lossAlertForCarrier("Jadlog", "Copacabana", [rio])?.message,
    "Região do CEP 200 de Rio de Janeiro teve extravio na Jadlog (bairro Copacabana, 12/08, pedido #1234). Cuidado.",
  );
  assert.equal(
    lossAlertForCarrier("Jadlog", "Centro", [campinas])?.message,
    "Campinas/SP teve extravio na Jadlog (bairro Centro, 12/08, pedido #1234). Cuidado.",
  );
  assert.match(lossAlertForCarrier("Jadlog", "República", [manual])?.message || "", /teve um caso na Jadlog/);
});
