import assert from "node:assert/strict";
import test from "node:test";

import {
  BRANCH_FAVICON,
  MAIN_STORE_NOTIFICATION_ICON,
  MAIN_STORE_SHARE_IMAGE,
  MAIN_STORE_WORDMARK,
  MAIN_STORE_WORDMARK_ON_DARK,
  mainStoreShareImage,
  resolveStoreLogo,
  storeNotificationIcon,
} from "./store-logo.ts";

const main = { is_main_store: "1", tenant_id: "tenant_loja1" };
const branch = { is_main_store: "0", tenant_id: "tenant_fh-imports" };

test("loja principal sem logo usa o wordmark novo", () => {
  assert.deepEqual(resolveStoreLogo(main, { hostname: "www.ka-imports.com" }), {
    src: MAIN_STORE_WORDMARK,
    isDefault: true,
  });
  assert.equal(
    resolveStoreLogo(main, { hostname: "www.ka-imports.com", onDark: true }).src,
    MAIN_STORE_WORDMARK_ON_DARK,
  );
});

test("logo salvo no admin vence o padrão, na principal e na filial", () => {
  const saved = "https://cdn.example/logo.jpg";
  assert.deepEqual(resolveStoreLogo({ ...main, logo: saved }), {
    src: saved,
    isDefault: false,
  });
  assert.deepEqual(resolveStoreLogo({ ...branch, logo: `  ${saved}  ` }, { onDark: true }), {
    src: saved,
    isDefault: false,
  });
});

test("filial sem logo não recebe o wordmark da KA", () => {
  assert.deepEqual(resolveStoreLogo(branch, { hostname: "www.fh-imports.site" }), {
    src: null,
    isDefault: false,
  });
  assert.deepEqual(resolveStoreLogo({}, { hostname: "www.fh-imports.site" }), {
    src: null,
    isDefault: false,
  });
  assert.equal(
    resolveStoreLogo({ is_main_store: "0" }, { hostname: "www.ka-imports.com" }).src,
    null,
  );
});

test("sem settings, só o domínio público da loja principal cai no padrão", () => {
  assert.equal(resolveStoreLogo({}, { hostname: "ka-imports.com" }).isDefault, true);
  assert.equal(resolveStoreLogo({}, { hostname: "www.ka-imports.com" }).src, MAIN_STORE_WORDMARK);
  assert.equal(resolveStoreLogo({}, { hostname: "localhost" }).src, null);
  assert.equal(resolveStoreLogo({}, { hostname: "preview.vercel.app" }).src, null);
});

test("og e ícone de notificação seguem a mesma loja", () => {
  assert.equal(mainStoreShareImage(main, "www.ka-imports.com"), MAIN_STORE_SHARE_IMAGE);
  assert.equal(mainStoreShareImage({ ...main, logo: "https://cdn.example/a.png" }), null);
  assert.equal(mainStoreShareImage(branch, "www.fh-imports.site"), null);
  assert.equal(storeNotificationIcon(main), MAIN_STORE_NOTIFICATION_ICON);
  assert.equal(storeNotificationIcon(branch, "www.ka-imports.com"), BRANCH_FAVICON);
  assert.equal(storeNotificationIcon({}, "www.fh-imports.site"), BRANCH_FAVICON);
});
