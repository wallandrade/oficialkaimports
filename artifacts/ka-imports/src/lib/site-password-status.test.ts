import assert from "node:assert/strict";
import test from "node:test";
import {
  SITE_PASSWORD_ACTIVE_LABEL,
  SITE_PASSWORD_RELEASED_LABEL,
  SITE_RELEASE_SCHEDULED_LABEL,
  sitePasswordCardStatus,
  siteReleaseSaveSteps,
  siteReleaseScheduleActive,
} from "./site-password-status.ts";

test("proteção ativa só quando a API diz que o site está fechado", () => {
  assert.equal(sitePasswordCardStatus(true, { site: true, release: { message: "Promoção começa em" } }), "active");
  assert.equal(sitePasswordCardStatus(true, { site: true, release: null }), "active");
  assert.equal(SITE_PASSWORD_ACTIVE_LABEL, "Proteção ativa");
});

test("senha salva com site aberto mostra a liberação, não a proteção", () => {
  assert.equal(sitePasswordCardStatus(true, { site: false, release: null }), "released");
  assert.equal(
    SITE_PASSWORD_RELEASED_LABEL,
    "Senha salva, mas a loja está liberada (liberação automática na data marcada)",
  );
});

test("sem resposta da API o card não afirma proteção nem liberação", () => {
  assert.equal(sitePasswordCardStatus(true, null), null);
  assert.equal(sitePasswordCardStatus(false, { site: false, release: null }), null);
  assert.equal(sitePasswordCardStatus(false, null), null);
});

test("ligar grava a data antes do interruptor e desligar faz o contrário", () => {
  assert.deepEqual(siteReleaseSaveSteps(true), ["at", "message", "enabled"]);
  assert.deepEqual(siteReleaseSaveSteps(false), ["enabled", "at", "message"]);
});

test("liberação automática ligada segue o release da API", () => {
  assert.equal(siteReleaseScheduleActive({ site: true, release: { message: "Promoção começa em" } }), true);
  assert.equal(siteReleaseScheduleActive({ site: false, release: null }), false);
  assert.equal(siteReleaseScheduleActive(null), false);
  assert.equal(SITE_RELEASE_SCHEDULED_LABEL, "Liberação automática ligada");
});
