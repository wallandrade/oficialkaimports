import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateCanReship,
  evaluateOpenInsuranceClaim,
  evaluateResolveInsuranceClaim,
} from "./insurance-claims-policy";

test("reduced cobre só extravio", () => {
  const open = evaluateOpenInsuranceClaim({
    plan: "reduced",
    problem: "extravio",
    claimStatus: "none",
    reshipCount: 0,
    isChildOrder: false,
  });
  assert.equal(open.ok, true);
  if (open.ok) assert.equal(open.nextStatus, "first_lost");

  const apreensao = evaluateOpenInsuranceClaim({
    plan: "reduced",
    problem: "apreensao",
    claimStatus: "none",
    reshipCount: 0,
    isChildOrder: false,
  });
  assert.equal(apreensao.ok, false);
  if (!apreensao.ok) assert.equal(apreensao.error, "NO_COVERAGE");
});

test("reduced não aceita estorno", () => {
  const result = evaluateResolveInsuranceClaim({
    plan: "reduced",
    problem: "extravio",
    choice: "choose_refund",
    claimStatus: "first_lost",
    reshipCount: 0,
    isChildOrder: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "REDUCED_NO_REFUND");
});

test("depois de 1 reenvio, RESHIP_DONE", () => {
  const result = evaluateResolveInsuranceClaim({
    plan: "full",
    problem: "extravio",
    choice: "choose_refund",
    claimStatus: "reship_sent",
    reshipCount: 1,
    isChildOrder: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "RESHIP_DONE");
});

test("none + extravio não reenvia", () => {
  const result = evaluateOpenInsuranceClaim({
    plan: "none",
    problem: "extravio",
    claimStatus: "none",
    reshipCount: 0,
    isChildOrder: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "NO_COVERAGE");
});

test("missing_items não usa política de seguro", () => {
  const open = evaluateOpenInsuranceClaim({
    plan: "none",
    problem: "missing_items",
    claimStatus: "none",
    reshipCount: 0,
    isChildOrder: false,
  });
  assert.equal(open.ok, true);
});

test("none nunca reenvia, mesmo faltou item", () => {
  const missing = evaluateCanReship("none", "missing_items");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error, "NO_INSURANCE");

  const lost = evaluateCanReship("none", "extravio");
  assert.equal(lost.ok, false);
  if (!lost.ok) assert.equal(lost.error, "NO_INSURANCE");
});

test("reduced cobre extravio e bloqueia apreensão", () => {
  const lost = evaluateCanReship("reduced", "extravio");
  assert.equal(lost.ok, true);

  const seized = evaluateCanReship("reduced", "apreensao");
  assert.equal(seized.ok, false);
  if (!seized.ok) assert.equal(seized.error, "NO_COVERAGE");
});

test("full + faltou item pode reenviar", () => {
  const result = evaluateCanReship("full", "missing_items");
  assert.equal(result.ok, true);
});
