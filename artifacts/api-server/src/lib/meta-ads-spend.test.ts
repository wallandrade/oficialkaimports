import assert from "node:assert/strict";
import test from "node:test";

import {
  metaAdsExpenseId,
  metaAdsHttpDisposition,
  planMetaAdsSpend,
  yuryMetaAdsSpendUrl,
} from "./meta-ads-spend";

const sample = {
  source: "yury-imports",
  accountIdMasked: "act_••••1234",
  currency: "BRL",
  since: "2026-10-26",
  until: "2026-11-01",
  days: [
    { date: "2026-10-26", amount: 0 },
    { date: "2026-10-27", amount: 0 },
    { date: "2026-10-28", amount: 0 },
    { date: "2026-10-29", amount: 0 },
    { date: "2026-10-30", amount: 0 },
    { date: "2026-10-31", amount: 0 },
    { date: "2026-11-01", amount: 8.5 },
  ],
  total: 8.5,
};

test("a URL usa o domínio sem /api e a rota começa em /api", () => {
  assert.equal(
    yuryMetaAdsSpendUrl("https://api.yury-imports.com"),
    "https://api.yury-imports.com/api/integrations/meta-ads/spend",
  );
  assert.equal(
    yuryMetaAdsSpendUrl("https://api.yury-imports.com/"),
    "https://api.yury-imports.com/api/integrations/meta-ads/spend",
  );
});

test("404 e 503 só geram log; 401 e 502 preservam o salvo", () => {
  assert.equal(metaAdsHttpDisposition(404), "log");
  assert.equal(metaAdsHttpDisposition(503), "log");
  assert.equal(metaAdsHttpDisposition(401), "keep");
  assert.equal(metaAdsHttpDisposition(502), "keep");
  assert.equal(metaAdsHttpDisposition(200), "parse");
});

test("zero apaga só a linha do dia e valor positivo substitui essa mesma linha", () => {
  const plan = planMetaAdsSpend(sample);
  assert.ok(plan);
  assert.equal(plan.actions.length, 7);
  const zeros = plan.actions.filter((action) => action.action === "delete");
  assert.equal(zeros.length, 6);
  assert.deepEqual(zeros.map((action) => action.id), [
    "yury-meta-ads:2026-10-26",
    "yury-meta-ads:2026-10-27",
    "yury-meta-ads:2026-10-28",
    "yury-meta-ads:2026-10-29",
    "yury-meta-ads:2026-10-30",
    "yury-meta-ads:2026-10-31",
  ]);
  const spend = plan.actions.find((action) => action.action === "upsert");
  assert.ok(spend && spend.action === "upsert");
  assert.equal(spend.id, metaAdsExpenseId("2026-11-01"));
  assert.equal(spend.amount, "8.50");
  assert.equal(spend.start.toISOString(), "2026-11-01T03:00:00.000Z");
  assert.equal(spend.end.toISOString(), "2026-11-02T02:59:59.000Z");
});

test("dia fora de since/until não entra no plano, mesmo com amount 0", () => {
  const plan = planMetaAdsSpend({
    ...sample,
    days: [
      ...sample.days,
      { date: "2026-10-25", amount: 0 },
    ],
  });
  assert.ok(plan);
  assert.equal(plan.actions.some((action) => action.date === "2026-10-25"), false);
  assert.equal(plan.actions.some((action) => action.id === "yury-meta-ads:2026-10-25"), false);
});

test("dia ausente dentro da janela, moeda errada ou JSON incompleto não geram plano", () => {
  const missing = {
    ...sample,
    days: sample.days.filter((day) => day.date !== "2026-10-31"),
  };
  assert.equal(planMetaAdsSpend(missing), null);
  assert.equal(planMetaAdsSpend({ ...sample, currency: "USD" }), null);
  assert.equal(planMetaAdsSpend({ ...sample, days: "não" }), null);
  assert.equal(planMetaAdsSpend(null), null);
});
