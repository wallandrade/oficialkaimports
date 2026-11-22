import assert from "node:assert/strict";
import test from "node:test";

import {
  cartAddedNoticeDismissMs,
  cartAddedNoticeTopPx,
  shouldShowCartAddedNotice,
} from "./pharma-added-notice";

test("aviso de adicionado não aparece com o drawer aberto", () => {
  assert.equal(shouldShowCartAddedNotice(true, true), false);
  assert.equal(shouldShowCartAddedNotice(false, true), false);
  assert.equal(shouldShowCartAddedNotice(false, false), false);
  assert.equal(shouldShowCartAddedNotice(true, false), true);
});

test("no celular o aviso some mais rápido", () => {
  assert.equal(cartAddedNoticeDismissMs(390), 2800);
  assert.equal(cartAddedNoticeDismissMs(767), 2800);
  assert.equal(cartAddedNoticeDismissMs(768), 4000);
  assert.equal(cartAddedNoticeDismissMs(1440), 4000);
});

test("o aviso fica abaixo do header e da safe-area", () => {
  assert.equal(cartAddedNoticeTopPx(100, 0), 108);
  assert.equal(cartAddedNoticeTopPx(40, 59), 71);
  assert.equal(cartAddedNoticeTopPx(0, 0), 12);
});
