import assert from "node:assert/strict";
import test from "node:test";

import { lossRegionLabel, lossScopeFromRegionKey } from "./carrier-loss";
import {
  buildLossSnapshotEnvelope,
  parsePeerLossSnapshot,
  reconcilePeerLossList,
  toPublishedLossIncident,
} from "./loss-peer";
import {
  lossSyncAuthStatus,
  readLossSyncCredential,
  yuryLossPullBlockReason,
} from "./loss-sync-config";

test("rótulo e escopo publicados seguem a mesma chave da Yury", () => {
  assert.equal(lossRegionLabel("sp-centro", "São Paulo"), "Centro");
  assert.equal(lossRegionLabel("sp-extremo-leste", "São Paulo"), "Extremo leste");
  assert.equal(lossRegionLabel("rj-cep-200", "Rio de Janeiro"), "CEP 200");
  assert.equal(lossRegionLabel("sp-cep-060", "São Paulo"), "CEP 060");
  assert.equal(lossRegionLabel("city", "Campinas"), "Campinas");
  assert.equal(lossScopeFromRegionKey("sp-centro"), "region");
  assert.equal(lossScopeFromRegionKey("city"), "city");
});

test("snapshot da Yury vira incidente sem pedido, CEP ou rastreio", () => {
  const parsed = parsePeerLossSnapshot({
    syncedAt: "2026-10-15T22:00:00.000Z",
    source: "yury-imports",
    windowDays: 180,
    truncated: false,
    incidents: [
      {
        id: "uuid-do-caso",
        carrierKey: "Jadlog envioEcom",
        carrierLabel: "Jadlog envioEcom",
        cityKey: "São Paulo",
        cityLabel: "São Paulo",
        state: "sp",
        neighborhoodKey: "República",
        neighborhoodLabel: "República",
        regionKey: "sp-centro",
        regionLabel: "Centro",
        scope: "region",
        kind: "extravio",
        occurredAt: "2026-09-01T12:00:00.000Z",
        removedAt: null,
        cep: "01310100",
        orderNumber: 1841,
        trackingCode: "AA123456789BR",
      },
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.incidents.length, 1);
  const incident = parsed.incidents[0];
  assert.equal(incident.carrierKey, "jadlog");
  assert.equal(incident.carrierLabel, "Jadlog");
  assert.equal(incident.cityKey, "sao paulo");
  assert.equal(incident.neighborhoodKey, "republica");
  assert.equal(incident.regionKey, "sp-centro");
  assert.equal(incident.state, "SP");
  assert.equal(incident.removedAt, null);
  assert.equal("cep" in incident, false);
  assert.equal("orderNumber" in incident, false);
  assert.equal("trackingCode" in incident, false);
});

test("removedAt preenchido fica no espelho e chave inválida sai fora", () => {
  const parsed = parsePeerLossSnapshot({
    incidents: [
      {
        id: "saiu",
        carrierKey: "jadlog",
        carrierLabel: "Jadlog",
        cityKey: "sao paulo",
        cityLabel: "São Paulo",
        state: "SP",
        regionKey: "sp-norte",
        regionLabel: "Norte",
        scope: "region",
        kind: "roubo",
        occurredAt: "2026-09-01T12:00:00.000Z",
        removedAt: "2026-10-01T12:00:00.000Z",
      },
      {
        id: "ruim",
        carrierKey: "jadlog",
        carrierLabel: "Jadlog",
        cityKey: "sao paulo",
        cityLabel: "São Paulo",
        state: "SP",
        regionKey: "zona-inventada",
        regionLabel: "Zona",
        scope: "region",
        kind: "extravio",
        occurredAt: "2026-09-01T12:00:00.000Z",
      },
    ],
  });
  assert.equal(parsed?.incidents.length, 1);
  assert.ok(parsed?.incidents[0].removedAt instanceof Date);
});

test("quem sumiu do snapshot sai; snapshot truncado não apaga o resto", () => {
  const incoming = parsePeerLossSnapshot({
    truncated: false,
    incidents: [
      {
        id: "fica",
        carrierKey: "jadlog",
        carrierLabel: "Jadlog",
        cityKey: "sao paulo",
        cityLabel: "São Paulo",
        state: "SP",
        regionKey: "city",
        regionLabel: "Campinas",
        scope: "city",
        kind: "manual",
        occurredAt: "2026-09-01T12:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(
    reconcilePeerLossList(["fica", "sumiu"], incoming?.incidents || [], false).removeIds,
    ["sumiu"],
  );
  assert.deepEqual(
    reconcilePeerLossList(["fica", "sumiu"], incoming?.incidents || [], true).removeIds,
    [],
  );
});

test("lista vazia é snapshot válido", () => {
  const parsed = parsePeerLossSnapshot({ incidents: [] });
  assert.deepEqual(parsed?.incidents, []);
  assert.equal(parsePeerLossSnapshot({ ok: true }), null);
});

test("snapshot publicado leva só o caso nosso e omite dados do pedido", () => {
  const published = toPublishedLossIncident({
    id: "loss-1",
    carrierKey: "jadlog",
    carrierName: "Jadlog envioEcom",
    cityKey: "sao paulo",
    cityName: "São Paulo",
    state: "SP",
    neighborhoodKey: "republica",
    neighborhoodName: "República",
    regionKey: "sp-centro",
    incidentType: "extravio",
    occurredAt: new Date("2026-09-01T12:00:00.000Z"),
  });
  assert.ok(published);
  assert.equal(published.carrierKey, "jadlog");
  assert.equal(published.carrierLabel, "Jadlog");
  assert.equal(published.regionKey, "sp-centro");
  assert.equal(published.regionLabel, "Centro");
  assert.equal(published.scope, "region");
  assert.equal(published.neighborhoodKey, "republica");
  const envelope = buildLossSnapshotEnvelope([published], false, new Date("2026-10-15T22:00:00.000Z"));
  assert.equal(envelope.source, "ka-imports");
  assert.equal(envelope.windowDays, 180);
  assert.equal(envelope.truncated, false);
  const keys = Object.keys(envelope.incidents[0]);
  for (const forbidden of ["orderNumber", "cep", "phone", "trackingCode", "clientName", "removedAt"]) {
    assert.equal(keys.includes(forbidden), false);
  }
  assert.equal(toPublishedLossIncident({
    ...{
      id: "loss-2",
      carrierKey: "jadlog",
      carrierName: "Jadlog",
      cityKey: "sao paulo",
      cityName: "São Paulo",
      state: "SP",
      neighborhoodKey: "",
      neighborhoodName: null,
      regionKey: "zona-inventada",
      incidentType: "extravio",
      occurredAt: new Date("2026-09-01T12:00:00.000Z"),
    },
  }), null);
});

test("Bearer e X-Api-Key usam o LOSS_SYNC_TOKEN, nunca o token da Yury", () => {
  const previousOwn = process.env.LOSS_SYNC_TOKEN;
  const previousPeer = process.env.YURY_LOSS_SYNC_TOKEN;
  process.env.LOSS_SYNC_TOKEN = "senha-nossa";
  process.env.YURY_LOSS_SYNC_TOKEN = "senha-da-yury";
  try {
    assert.equal(readLossSyncCredential("Bearer senha-nossa", ""), "senha-nossa");
    assert.equal(readLossSyncCredential(undefined, "senha-nossa"), "senha-nossa");
    assert.equal(lossSyncAuthStatus("senha-nossa", "senha-nossa"), 200);
    assert.equal(lossSyncAuthStatus("senha-da-yury", "senha-nossa"), 401);
    assert.equal(lossSyncAuthStatus("", ""), 503);
    assert.equal(yuryLossPullBlockReason(), null);
    process.env.LOSS_SYNC_TOKEN = "senha-da-yury";
    assert.equal(yuryLossPullBlockReason(), "YURY_LOSS_SYNC_TOKEN igual ao LOSS_SYNC_TOKEN");
    process.env.YURY_LOSS_SYNC_TOKEN = "";
    assert.equal(yuryLossPullBlockReason(), "YURY_LOSS_SYNC_TOKEN ausente");
  } finally {
    if (previousOwn == null) delete process.env.LOSS_SYNC_TOKEN;
    else process.env.LOSS_SYNC_TOKEN = previousOwn;
    if (previousPeer == null) delete process.env.YURY_LOSS_SYNC_TOKEN;
    else process.env.YURY_LOSS_SYNC_TOKEN = previousPeer;
  }
});
