import assert from "node:assert/strict";
import test from "node:test";
import { fallbackSiteName, isKaImportsStoreHost, isMainStoreHostname, isStoreNotConfiguredPayload } from "./store-host.ts";

test("hostname da loja principal usa KA Imports; o resto usa Loja", () => {
  assert.equal(isMainStoreHostname("ka-imports.com"), true);
  assert.equal(isMainStoreHostname("www.ka-imports.com"), true);
  assert.equal(isMainStoreHostname("localhost"), true);
  assert.equal(isMainStoreHostname("127.0.0.1"), true);
  assert.equal(isMainStoreHostname("preview.vercel.app"), true);
  assert.equal(isMainStoreHostname("lobster-app.ondigitalocean.app"), true);
  assert.equal(isMainStoreHostname("www.fh-imports.site"), false);
  assert.equal(fallbackSiteName("ka-imports.com"), "KA Imports");
  assert.equal(fallbackSiteName("ka-imports.com", "upper"), "KA IMPORTS");
  assert.equal(fallbackSiteName("www.fh-imports.site"), "Loja");
  assert.equal(isKaImportsStoreHost("ka-imports.com"), true);
  assert.equal(isKaImportsStoreHost("www.ka-imports.com"), true);
  assert.equal(isKaImportsStoreHost("www.fh-imports.site"), false);
  assert.equal(isKaImportsStoreHost("localhost"), false);
});

test("resposta da API marca loja não configurada", () => {
  assert.equal(isStoreNotConfiguredPayload({ store_not_configured: true }), true);
  assert.equal(isStoreNotConfiguredPayload({ error: "store_not_configured" }), true);
  assert.equal(isStoreNotConfiguredPayload({ site_name: "Filial" }), false);
  assert.equal(isStoreNotConfiguredPayload(null), false);
});
