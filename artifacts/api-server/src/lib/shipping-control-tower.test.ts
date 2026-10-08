import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlTower,
  classifyTowerOccurrence,
  pickCurrentHistoryEvent,
  resolveTowerPeriod,
  towerCarrierKey,
  type TowerCandidate,
} from "./shipping-control-tower";

const NOW = new Date("2026-10-08T12:35:00.000Z");

function row(partial: TowerCandidate): TowerCandidate {
  return {
    orderId: "order-1",
    orderNumber: 1573,
    clientName: "Ana",
    clientPhone: "11999999999",
    barcode: "EC1",
    shipmentId: 10,
    carrierRaw: "Jadlog envioEcom",
    statusUpdatedAt: "2026-10-01T12:00:00.000Z",
    ...partial,
  };
}

test("periodo vazio ou desconhecido vira open, em dias de 24 horas", () => {
  const open = resolveTowerPeriod("", NOW);
  assert.equal(open.period, "open");
  assert.equal(open.since.toISOString(), "2026-07-10T12:35:00.000Z");
  assert.equal(resolveTowerPeriod("ontem", NOW).period, "open");
  assert.equal(resolveTowerPeriod("7", NOW).since.toISOString(), new Date(NOW.getTime() - 7 * 86400000).toISOString());
  assert.equal(resolveTowerPeriod("30", NOW).since.toISOString(), new Date(NOW.getTime() - 30 * 86400000).toISOString());
  assert.equal(resolveTowerPeriod("60", NOW).since.toISOString(), new Date(NOW.getTime() - 60 * 86400000).toISOString());
});

test("hoje e meia-noite em America/Sao_Paulo", () => {
  const today = resolveTowerPeriod("today", new Date("2026-10-08T15:00:00.000Z"));
  assert.equal(today.period, "today");
  assert.equal(today.since.toISOString(), "2026-10-08T03:00:00.000Z");
});

test("Jadlog envioEcom e Jadlog sao a mesma transportadora", () => {
  assert.equal(towerCarrierKey("Jadlog envioEcom"), "jadlog");
  assert.equal(towerCarrierKey("Jadlog"), "jadlog");
  assert.equal(towerCarrierKey("Jádlog"), "jadlog");
  assert.equal(towerCarrierKey(""), "sem transportadora");
  assert.equal(towerCarrierKey("   "), "sem transportadora");
});

test("Devolvido por extravio fica extravio, e roubo furto sinistro tambem", () => {
  assert.equal(classifyTowerOccurrence("Devolvido por extravio", [])?.kind, "extravio");
  assert.equal(classifyTowerOccurrence("Roubo", [])?.action, "Acionar a transportadora para indenização");
  assert.equal(classifyTowerOccurrence("Furto", [])?.kind, "extravio");
  assert.equal(classifyTowerOccurrence("Sinistro", [])?.kind, "extravio");
  assert.equal(classifyTowerOccurrence("Avaria na caixa", [])?.kind, "avaria");
  assert.equal(classifyTowerOccurrence("Volume danificado", [])?.kind, "avaria");
});

test("retencao cobre apreensao, apreendido, receita e retido fora de nao retido", () => {
  assert.equal(classifyTowerOccurrence("Apreensão fiscal", [])?.kind, "retencao");
  assert.equal(classifyTowerOccurrence("Apreendido", [])?.kind, "retencao");
  assert.equal(classifyTowerOccurrence("Retenção", [])?.kind, "retencao");
  assert.equal(classifyTowerOccurrence("Receita Federal", [])?.kind, "retencao");
  assert.equal(classifyTowerOccurrence("Objeto retido", [])?.kind, "retencao");
  assert.equal(classifyTowerOccurrence("Não retido", []), null);
});

test("endereco sozinho nao conta; as frases de problema contam", () => {
  assert.equal(classifyTowerOccurrence("Endereço", []), null);
  assert.equal(classifyTowerOccurrence("Endereço insuficiente", [])?.kind, "endereco");
  assert.equal(classifyTowerOccurrence("Endereço incorreto", [])?.kind, "endereco");
  assert.equal(classifyTowerOccurrence("Problema de endereço", [])?.kind, "endereco");
  assert.equal(classifyTowerOccurrence("Número inexistente", [])?.kind, "endereco");
  assert.equal(classifyTowerOccurrence("Mudou-se", [])?.kind, "endereco");
  assert.equal(classifyTowerOccurrence("Mudou se", [])?.kind, "endereco");
  assert.equal(classifyTowerOccurrence("Destinatário desconhecido", [])?.kind, "endereco");
});

test("ausente e palavra; retirada exige aguardando, disponivel ou agencia", () => {
  assert.equal(classifyTowerOccurrence("Destinatário ausente", [])?.kind, "destinatario_ausente");
  assert.equal(classifyTowerOccurrence("Destinatário ausente", [])?.action, "Entrar em contato com o cliente");
  assert.equal(classifyTowerOccurrence("Aguardando coleta", []), null);
  assert.equal(classifyTowerOccurrence("Aguardando ser coletado", []), null);
  assert.equal(classifyTowerOccurrence("NAO ENTROU NA UNIDADE", []), null);
  assert.equal(classifyTowerOccurrence("Em trânsito", []), null);
  assert.equal(classifyTowerOccurrence("Saiu para entrega", []), null);
  assert.equal(classifyTowerOccurrence("Postado", []), null);
  assert.equal(classifyTowerOccurrence("Aguardando retirada", [])?.kind, "aguardando_retirada");
  assert.equal(classifyTowerOccurrence("Disponível para retirar", [])?.kind, "aguardando_retirada");
  assert.equal(classifyTowerOccurrence("Objeto na agência para retirada", [])?.kind, "aguardando_retirada");
  assert.equal(classifyTowerOccurrence("Devolução ao remetente", [])?.kind, "devolucao");
});

test("entrega e cancelamento fecham; saiu para entrega nao", () => {
  assert.equal(classifyTowerOccurrence("Objeto entregue", [{ status: "Destinatário ausente", description: "Destinatário ausente" }]), null);
  assert.equal(classifyTowerOccurrence("Destinatário ausente", [{ status: "Entregue", at: "2026-10-02T00:00:00.000Z" }]), null);
  assert.equal(classifyTowerOccurrence("Aguardando cancelamento", []), null);
  assert.equal(classifyTowerOccurrence("Cancelado", []), null);
  assert.equal(classifyTowerOccurrence("Saiu para entrega", []), null);
});

test("evento antigo nao reabre; a descricao do ultimo evento reabre", () => {
  const ignored = classifyTowerOccurrence("Em trânsito", [
    { status: "Destinatário ausente", description: "Destinatário ausente", at: "2026-10-01T00:00:00.000Z" },
    { status: "Saiu para entrega", description: "Saiu para entrega", at: "2026-10-02T00:00:00.000Z" },
  ]);
  assert.equal(ignored, null);
  const open = classifyTowerOccurrence("Em trânsito", [
    { status: "Saiu para entrega", description: "Destinatário ausente", at: "2026-10-02T00:00:00.000Z" },
  ]);
  assert.equal(open?.kind, "destinatario_ausente");
});

test("historico em string e data anterior mais nova troca o ultimo item", () => {
  const raw = JSON.stringify([
    { status: "Destinatário ausente", at: 1_800_000_000_000 },
    { status: "Postado", at: 1_700_000_000 },
  ]);
  const current = pickCurrentHistoryEvent(raw);
  assert.equal(current?.status, "Destinatário ausente");
  assert.equal(classifyTowerOccurrence("Em trânsito", raw)?.kind, "destinatario_ausente");
  const noDateOnLast = pickCurrentHistoryEvent([
    { status: "Destinatário ausente", at: "2026-10-03T00:00:00.000Z" },
    { status: "Postado" },
  ]);
  assert.equal(noDateOnLast?.status, "Postado");
});

test("pedido dividido classifica so o pacote; sem divisao so a linha do pedido", () => {
  const parent = row({
    orderId: "split",
    status: "Destinatário ausente",
    trackingCode: "TRACK-PAI",
    barcode: "PAI",
  });
  const first = row({
    orderId: "split",
    packageId: "pkg-1",
    status: "Avaria",
    barcode: "PKG1",
    trackingCode: "NAO-USAR",
    shipmentId: 21,
  });
  const second = row({
    orderId: "split",
    packageId: "pkg-2",
    status: "Em trânsito",
    barcode: "PKG2",
  });
  const split = buildControlTower({
    now: NOW,
    orders: [parent],
    packages: [first, second],
    packageCounts: new Map([["split", 2]]),
  });
  assert.equal(split.occurrences, 1);
  assert.equal(split.items[0]?.packageId, "pkg-1");
  assert.equal(split.items[0]?.trackingCode, "PKG1");
  assert.equal(split.items[0]?.kind, "avaria");

  const loose = buildControlTower({
    now: NOW,
    orders: [],
    packages: [row({ orderId: "solo", packageId: "pkg-x", status: "Avaria" })],
    packageCounts: new Map([["solo", 1]]),
  });
  assert.equal(loose.occurrences, 0);

  const single = buildControlTower({
    now: NOW,
    orders: [row({ orderId: "one", status: "Destinatário ausente", trackingCode: "ABC", barcode: "BAR" })],
    packages: [row({ orderId: "one", packageId: "pkg-only", status: "Avaria", barcode: "SO" })],
    packageCounts: new Map([["one", 1]]),
  });
  assert.equal(single.occurrences, 1);
  assert.equal(single.items[0]?.packageId, null);
  assert.equal(single.items[0]?.trackingCode, "ABC");
  assert.equal(single.items[0]?.kind, "destinatario_ausente");
});

test("sem total no banco, a quantidade que apareceu na consulta decide a divisao", () => {
  const built = buildControlTower({
    now: NOW,
    orders: [row({ orderId: "miss", status: "Destinatário ausente" })],
    packages: [
      row({ orderId: "miss", packageId: "a", status: "Avaria", barcode: "A" }),
      row({ orderId: "miss", packageId: "b", status: "Extravio", barcode: "B" }),
    ],
    packageCounts: new Map(),
  });
  assert.equal(built.occurrences, 2);
  assert.deepEqual(built.items.map((item) => item.packageId).sort(), ["a", "b"]);
});

test("filtros cortam a lista e o ranking fica do periodo inteiro", () => {
  const orders = [
    row({ orderId: "a", status: "Destinatário ausente", carrierRaw: "Jadlog envioEcom", statusUpdatedAt: "2026-10-02T00:00:00.000Z" }),
    row({ orderId: "b", status: "Avaria", carrierRaw: "Jadlog", statusUpdatedAt: "2026-10-01T00:00:00.000Z" }),
    row({ orderId: "c", status: "Extravio", carrierRaw: "Loggi", statusUpdatedAt: "2026-10-03T00:00:00.000Z" }),
    row({ orderId: "d", status: "Postado", carrierRaw: "Loggi", statusUpdatedAt: "2026-10-03T00:00:00.000Z" }),
  ];
  const all = buildControlTower({ now: NOW, orders, packageCounts: new Map() });
  assert.equal(all.occurrences, 3);
  assert.equal(all.byCarrier[0]?.carrier, "Jadlog");
  assert.equal(all.byCarrier[0]?.count, 2);
  assert.equal(all.byCarrier[0]?.percent, 67);
  assert.equal(all.byCarrier[1]?.carrier, "Loggi");
  assert.equal(all.byCarrier[1]?.percent, 33);
  assert.deepEqual(all.items.map((item) => item.orderId), ["b", "a", "c"]);

  const filtered = buildControlTower({
    now: NOW,
    orders,
    packageCounts: new Map(),
    carrierRaw: "Jadlog envioEcom",
    kindRaw: "avaria",
  });
  assert.equal(filtered.occurrences, 3);
  assert.equal(filtered.byCarrier.length, 2);
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0]?.orderId, "b");

  const ignored = buildControlTower({
    now: NOW,
    orders,
    packageCounts: new Map(),
    kindRaw: "nao-existe",
  });
  assert.equal(ignored.items.length, 3);
});

test("lista corta em 200 e manda sem data para o fim", () => {
  const orders = Array.from({ length: 201 }, (_, index) => row({
    orderId: `id-${String(index).padStart(3, "0")}`,
    status: "Extravio",
    statusUpdatedAt: index === 200 ? null : new Date(Date.UTC(2026, 0, 1) + index * 3600000).toISOString(),
  }));
  orders.push(row({
    orderId: "sem-data",
    status: "Extravio",
    statusUpdatedAt: null,
  }));
  const built = buildControlTower({ now: NOW, orders, packageCounts: new Map() });
  assert.equal(built.occurrences, 202);
  assert.equal(built.listTruncated, true);
  assert.equal(built.items.length, 200);
  assert.equal(built.items[0]?.orderId, "id-000");
  assert.equal(built.items.some((item) => item.orderId === "sem-data"), false);
});

test("empate de ranking usa o nome em portugues", () => {
  const built = buildControlTower({
    now: NOW,
    orders: [
      row({ orderId: "1", status: "Extravio", carrierRaw: "Loggi" }),
      row({ orderId: "2", status: "Avaria", carrierRaw: "Azul" }),
    ],
    packageCounts: new Map(),
  });
  assert.deepEqual(built.byCarrier.map((item) => item.carrier), ["Azul", "Loggi"]);
  assert.deepEqual(built.byKind.map((item) => item.label), ["Avaria", "Extravio"]);
});
