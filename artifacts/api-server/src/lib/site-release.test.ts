import assert from "node:assert/strict";
import test from "node:test";
import {
  decideSiteProtection,
  normalizeSiteReleaseAt,
  normalizeSiteReleaseMessage,
  parseSaoPauloDateTime,
} from "./site-release";

const FUTURE = "2026-11-20T21:00";
const PAST = "2026-11-13T09:00";
const BEFORE = new Date("2026-11-20T23:00:00.000Z");
const AFTER = new Date("2026-11-21T00:00:00.000Z");

test("interprets the release clock as America/Sao_Paulo", () => {
  assert.equal(parseSaoPauloDateTime(FUTURE)?.toISOString(), "2026-11-21T00:00:00.000Z");
  assert.equal(parseSaoPauloDateTime("2026-11-13T00:00")?.toISOString(), "2026-11-13T03:00:00.000Z");
  assert.equal(parseSaoPauloDateTime("2026-02-31T10:00"), null);
  const normalized = normalizeSiteReleaseAt("2026-11-20T21:00:45");
  assert.equal(normalized.ok, true);
  if (normalized.ok) assert.equal(normalized.value, "2026-11-20T21:00");
  assert.equal(normalizeSiteReleaseAt("amanha").ok, false);
});

test("before the release instant the site stays locked and returns the countdown", () => {
  const decision = decideSiteProtection({
    site_password: "segredo",
    payment_password: "pagar",
    site_release_enabled: "1",
    site_release_at: FUTURE,
    site_release_message: "  Promoção começa em  ",
  }, BEFORE);

  assert.equal(decision.site, true);
  assert.equal(decision.payment, true);
  assert.equal(decision.release?.message, "Promoção começa em");
  assert.equal(decision.release?.releaseAt, "2026-11-21T00:00:00.000Z");
  assert.equal(decision.release?.serverNow, BEFORE.toISOString());
  const left = Date.parse(decision.release!.releaseAt) - Date.parse(decision.release!.serverNow);
  assert.equal(left, 60 * 60 * 1000);
});

test("uses the default message when the stored text is empty", () => {
  const decision = decideSiteProtection({
    site_password: "segredo",
    site_release_enabled: "1",
    site_release_at: FUTURE,
    site_release_message: "   ",
  }, BEFORE);
  assert.equal(decision.site, true);
  assert.equal(decision.release?.message, "Promoção começa em");
});

test("after the release instant the site opens and the payment password stays", () => {
  const decision = decideSiteProtection({
    site_password: "segredo",
    payment_password: "pagar",
    site_release_enabled: "1",
    site_release_at: FUTURE,
  }, AFTER);

  assert.equal(decision.site, false);
  assert.equal(decision.payment, true);
  assert.equal(decision.release, null);
});

test("opens at the exact release instant", () => {
  const decision = decideSiteProtection({
    site_password: "segredo",
    site_release_enabled: "1",
    site_release_at: FUTURE,
  }, new Date("2026-11-21T00:00:00.000Z"));
  assert.equal(decision.site, false);
  assert.equal(decision.release, null);
});

test("a disabled switch keeps today's password behavior and hides the countdown", () => {
  const future = decideSiteProtection({
    site_password: "segredo",
    payment_password: "pagar",
    site_release_enabled: "0",
    site_release_at: FUTURE,
    site_release_message: "Não mostrar",
  }, BEFORE);
  assert.equal(future.site, true);
  assert.equal(future.payment, true);
  assert.equal(future.release, null);

  const past = decideSiteProtection({
    site_password: "segredo",
    site_release_enabled: "false",
    site_release_at: PAST,
  }, AFTER);
  assert.equal(past.site, true);
  assert.equal(past.release, null);

  const missing = decideSiteProtection({ site_password: "segredo" }, AFTER);
  assert.equal(missing.site, true);
  assert.equal(missing.release, null);

  const open = decideSiteProtection({ site_release_enabled: "1", site_release_at: FUTURE }, BEFORE);
  assert.equal(open.site, false);
  assert.equal(open.release, null);
});

test("an enabled switch with a broken date keeps the password and skips the countdown", () => {
  const decision = decideSiteProtection({
    site_password: "segredo",
    site_release_enabled: "1",
    site_release_at: "ontem",
  }, AFTER);
  assert.equal(decision.site, true);
  assert.equal(decision.release, null);
});

test("each store uses only its own settings", () => {
  const now = new Date("2026-11-21T12:00:00.000Z");
  const mainStore = decideSiteProtection({
    site_password: "loja-1",
    site_release_enabled: "1",
    site_release_at: PAST,
    site_release_message: "Só a principal",
  }, now);
  const branchStillLocked = decideSiteProtection({
    site_password: "filial",
  }, now);
  const branchScheduled = decideSiteProtection({
    site_password: "filial",
    site_release_enabled: "1",
    site_release_at: "2026-11-22T10:00",
    site_release_message: "Só a filial",
  }, now);

  assert.equal(mainStore.site, false);
  assert.equal(mainStore.release, null);
  assert.equal(branchStillLocked.site, true);
  assert.equal(branchStillLocked.release, null);
  assert.equal(branchScheduled.site, true);
  assert.ok(branchScheduled.release);
  assert.equal(branchScheduled.release.message, "Só a filial");
  assert.equal(branchScheduled.release.releaseAt, "2026-11-22T13:00:00.000Z");
});

test("rejects a message longer than 80 characters", () => {
  assert.equal(normalizeSiteReleaseMessage("a".repeat(80)).ok, true);
  assert.equal(normalizeSiteReleaseMessage("a".repeat(81)).ok, false);
});
