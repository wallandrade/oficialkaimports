import assert from "node:assert/strict";
import test from "node:test";

import { isSitePasswordExemptPath, shouldMountStorefrontWidgets } from "./site-widget-access";

test("rotas isentas continuam fora da senha do site", () => {
  for (const location of [
    "/admin",
    "/admin/login",
    "/kyc",
    "/kyc/pedido-1",
    "/checkout",
    "/checkout?cupom=1",
    "/pix",
    "/pix/abc",
    "/success",
    "/pagamento",
    "/payment-link",
    "/payment-link/xyz",
    "/corrigir-entrega",
    "/corrigir-entrega?token=abc",
  ]) {
    assert.equal(isSitePasswordExemptPath(location), true, location);
  }
});

test("vitrine e checkout de seller continuam atrás da senha do site", () => {
  for (const location of ["/", "/produto/1", "/loja/checkout", "/ofertas", "/login"]) {
    assert.equal(isSitePasswordExemptPath(location), false, location);
  }
});

test("widgets não montam na espera nem com o site bloqueado", () => {
  const blocked = { location: "/", sessionUnlocked: false, siteProtected: true as const };
  const loading = { location: "/", sessionUnlocked: false, siteProtected: null };
  assert.equal(shouldMountStorefrontWidgets(blocked), false);
  assert.equal(shouldMountStorefrontWidgets(loading), false);
  assert.equal(shouldMountStorefrontWidgets({ ...loading, location: "/produto/1" }), false);
  assert.equal(shouldMountStorefrontWidgets({ ...blocked, location: "/loja/checkout" }), false);
});

test("widgets montam com o site aberto, com a sessão ou numa rota isenta", () => {
  assert.equal(shouldMountStorefrontWidgets({
    location: "/",
    sessionUnlocked: false,
    siteProtected: false,
  }), true);
  assert.equal(shouldMountStorefrontWidgets({
    location: "/",
    sessionUnlocked: true,
    siteProtected: null,
  }), true);
  assert.equal(shouldMountStorefrontWidgets({
    location: "/checkout",
    sessionUnlocked: false,
    siteProtected: null,
  }), true);
  assert.equal(shouldMountStorefrontWidgets({
    location: "/pagamento",
    sessionUnlocked: false,
    siteProtected: true,
  }), true);
  assert.equal(shouldMountStorefrontWidgets({
    location: "/kyc/pedido-1",
    sessionUnlocked: false,
    siteProtected: true,
  }), true);
  assert.equal(shouldMountStorefrontWidgets({
    location: "/corrigir-entrega",
    sessionUnlocked: false,
    siteProtected: true,
  }), true);
  assert.equal(shouldMountStorefrontWidgets({
    location: "/admin",
    sessionUnlocked: false,
    siteProtected: true,
  }), true);
});

test("o sorteio da oferta única não começa enquanto a senha bloqueia", () => {
  const spentIfMounted = (siteProtected: boolean | null) => shouldMountStorefrontWidgets({
    location: "/",
    sessionUnlocked: false,
    siteProtected,
  });
  assert.equal(spentIfMounted(null), false);
  assert.equal(spentIfMounted(true), false);
  assert.equal(spentIfMounted(false), true);
});
