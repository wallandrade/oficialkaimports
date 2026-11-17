import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SHOPEE_ROUTE_MESSAGE,
  decideShopeeInbound,
  extractShopeeOrderId,
  formatBrl,
  normalizeShopeeOrderId,
  normalizeShopeeProductUrl,
  parseShopeeRouteMessage,
  phoneMatchKeys,
  phonesMatch,
  renderShopeeRouteMessage,
  sharedSecretMatches,
  shopeeCreditAmount,
  shopeeRouteCustomerReply,
  selectShopeeRouteProducts,
  summarizeOrderProducts,
} from "./shopee-route-core";

test("texto padrão da Rota Shopee traz o link e o resumo", () => {
  assert.match(DEFAULT_SHOPEE_ROUTE_MESSAGE, /rota de envio com menos risco/);
  assert.match(DEFAULT_SHOPEE_ROUTE_MESSAGE, /\{link_shopee\}/);
  assert.match(DEFAULT_SHOPEE_ROUTE_MESSAGE, /\{resumo_pedido\}/);
  assert.match(DEFAULT_SHOPEE_ROUTE_MESSAGE, /carteira do nosso site/);
});

test("mensagem troca os placeholders e deixa o resto", () => {
  const text = renderShopeeRouteMessage(
    "Olá {nome}, pedido {pedido}. {resumo_pedido}. Link {link_shopee}. Valor {valor}. {outro}",
    {
      nome: "Ana",
      pedido: "2790",
      resumoPedido: "2x Tirzepatida",
      linkShopee: "https://shopee.com.br/produto",
      valor: "R$ 10,00",
    },
  );
  assert.equal(text, "Olá Ana, pedido 2790. 2x Tirzepatida. Link https://shopee.com.br/produto. Valor R$ 10,00. {outro}");
});

test("link da Shopee só entra em https, sem usuário na URL", () => {
  assert.equal(normalizeShopeeProductUrl("https://shopee.com.br/p/1"), "https://shopee.com.br/p/1");
  assert.equal(normalizeShopeeProductUrl("http://shopee.com.br/p/1"), null);
  assert.equal(normalizeShopeeProductUrl("https://user:senha@shopee.com.br/p"), null);
  assert.equal(normalizeShopeeProductUrl("javascript:alert(1)"), null);
  assert.equal(normalizeShopeeProductUrl(""), null);
});

test("mensagem vazia volta ao padrão e texto longo é recusado", () => {
  assert.deepEqual(parseShopeeRouteMessage("  "), { ok: true, value: null });
  assert.deepEqual(parseShopeeRouteMessage("Oi {link_shopee}"), { ok: true, value: "Oi {link_shopee}" });
  const tooLong = parseShopeeRouteMessage("a".repeat(2001));
  assert.equal(tooLong.ok, false);
});

test("ID da Shopee aceita o código da compra e recusa telefone ou frase", () => {
  assert.equal(normalizeShopeeOrderId("241116ABCDEFGH"), "241116ABCDEFGH");
  assert.equal(normalizeShopeeOrderId("241116-abcdef12"), "241116ABCDEF12");
  assert.equal(normalizeShopeeOrderId("2411161234567890"), "2411161234567890");
  assert.equal(normalizeShopeeOrderId("5511999998888"), null);
  assert.equal(normalizeShopeeOrderId("2790"), null);
  assert.equal(normalizeShopeeOrderId("AA123456789BR"), null);

  assert.deepEqual(extractShopeeOrderId("241116ABCDEFGH"), { id: "241116ABCDEFGH", motivo: null });
  assert.deepEqual(extractShopeeOrderId("241116-ABCDEFGH"), { id: "241116ABCDEFGH", motivo: null });
  assert.deepEqual(extractShopeeOrderId("241116ABCDEFGH ok"), { id: "241116ABCDEFGH", motivo: null });
  assert.deepEqual(extractShopeeOrderId("sim 241116ABCDEFGH"), { id: "241116ABCDEFGH", motivo: null });
  assert.deepEqual(extractShopeeOrderId("segue o id 241116ABCDEFGH obrigado"), { id: "241116ABCDEFGH", motivo: null });
  assert.deepEqual(extractShopeeOrderId("meu zap 5511999998888"), { id: null, motivo: "id_invalido" });
  assert.equal(extractShopeeOrderId("241116ABCDEFGH e 241117ZYXWVU12").motivo, "id_ambiguo");
  assert.equal(extractShopeeOrderId("").motivo, "id_invalido");
});

test("telefone da loja casa com e sem 55 e com o nono dígito", () => {
  assert.equal(phonesMatch("11999998888", "5511999998888"), true);
  assert.equal(phonesMatch("(11) 99999-8888", "11999998888"), true);
  assert.equal(phonesMatch("11999998888", "551199998888"), true);
  assert.equal(phonesMatch("11999998888", "21999998888"), false);
  assert.deepEqual(phoneMatchKeys(""), []);
});

test("entrada do n8n escolhe um pedido, repete o mesmo ID e manda revisão", () => {
  const awaiting = [{ id: "a", shopeeOrderId: null }];
  assert.deepEqual(decideShopeeInbound({
    motivoId: null,
    shopeeOrderId: "241116ABCDEFGH",
    awaiting,
    sameId: [],
  }), { ok: true, orderId: "a", shopeeOrderId: "241116ABCDEFGH", jaProcessado: false });

  assert.deepEqual(decideShopeeInbound({
    motivoId: null,
    shopeeOrderId: "241116ABCDEFGH",
    awaiting: [],
    sameId: [{ id: "a", shopeeOrderId: "241116ABCDEFGH" }],
  }).ok && decideShopeeInbound({
    motivoId: null,
    shopeeOrderId: "241116ABCDEFGH",
    awaiting: [],
    sameId: [{ id: "a", shopeeOrderId: "241116ABCDEFGH" }],
  }), { ok: true, orderId: "a", shopeeOrderId: "241116ABCDEFGH", jaProcessado: true });

  assert.deepEqual(decideShopeeInbound({
    motivoId: null,
    shopeeOrderId: "241116ABCDEFGH",
    awaiting: [{ id: "b", shopeeOrderId: null }],
    sameId: [{ id: "a", shopeeOrderId: "241116ABCDEFGH" }],
  }), { ok: true, orderId: "a", shopeeOrderId: "241116ABCDEFGH", jaProcessado: true });

  const invalid = decideShopeeInbound({
    motivoId: "id_invalido",
    shopeeOrderId: null,
    awaiting,
    sameId: [],
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.motivo, "id_invalido");
    assert.deepEqual(invalid.revisarIds, ["a"]);
  }

  const none = decideShopeeInbound({
    motivoId: "id_invalido",
    shopeeOrderId: null,
    awaiting: [],
    sameId: [],
  });
  assert.equal(none.ok, false);
  if (!none.ok) assert.deepEqual(none.revisarIds, []);

  const many = decideShopeeInbound({
    motivoId: null,
    shopeeOrderId: "241116ABCDEFGH",
    awaiting: [{ id: "a", shopeeOrderId: null }, { id: "b", shopeeOrderId: null }],
    sameId: [],
  });
  assert.equal(many.ok, false);
  if (!many.ok) {
    assert.equal(many.motivo, "varios_pedidos");
    assert.deepEqual(many.revisarIds, ["a", "b"]);
  }
});

test("segredo, valor e resposta ao cliente", () => {
  assert.equal(sharedSecretMatches("segredo", "segredo"), true);
  assert.equal(sharedSecretMatches("segredo", "outro"), false);
  assert.equal(sharedSecretMatches("", "segredo"), false);
  assert.equal(shopeeCreditAmount("10.50", "1"), 10.5);
  assert.equal(shopeeCreditAmount(0, "8.2"), 8.2);
  assert.equal(shopeeCreditAmount(0, 0), 0);
  assert.match(shopeeRouteCustomerReply({ pedido: "2790", shopeeOrderId: "241116ABCDEFGH" }), /241116ABCDEFGH/);
  assert.match(formatBrl(10), /10/);
  assert.deepEqual(summarizeOrderProducts([{ name: "Tirzepatida", quantity: 2 }, { name: "Brinde", quantity: 0 }]), {
    itens: [{ nome: "Tirzepatida", quantidade: 2 }],
    texto: "2x Tirzepatida",
  });
});

test("pacote da Rota Shopee lista só os itens daquele envio", () => {
  const orderProducts = [
    { name: "Tirzepatida", quantity: 1 },
    { name: "Retatrutide", quantity: 1 },
    { productName: "BIOGENISES GHK", quantity: 1 },
    { productName: "Lipoless", quantity: 1 },
  ];
  const packages = [
    { id: "sc", items: [{ productName: "Tirzepatida", quantity: 1 }, { productName: "Retatrutide", quantity: 1 }] },
    { id: "foz", items: [{ productName: "BIOGENISES GHK", quantity: 1 }] },
    { id: "minas", items: [{ productName: "Lipoless", quantity: 1 }] },
  ];
  const minas = selectShopeeRouteProducts({ split: true, packageId: "minas", orderProducts, packages });
  assert.equal(minas.ok, true);
  if (!minas.ok) return;
  assert.equal(minas.packageId, "minas");
  const summary = summarizeOrderProducts(minas.products);
  assert.equal(summary.texto, "1x Lipoless");
  const message = renderShopeeRouteMessage(DEFAULT_SHOPEE_ROUTE_MESSAGE, {
    nome: "Ana",
    pedido: "2839",
    resumoPedido: summary.texto,
    linkShopee: "https://shopee.example/produto",
    valor: "R$ 10,00",
  });
  assert.match(message, /1x Lipoless/);
  assert.equal(/Tirzepatida|Retatrutide|GHK/.test(message), false);
  const missing = selectShopeeRouteProducts({ split: true, orderProducts, packages });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error, "NEED_PACKAGE_ID");
  const notSplit = selectShopeeRouteProducts({ split: false, packageId: "minas", orderProducts, packages });
  assert.equal(notSplit.ok, false);
  if (!notSplit.ok) assert.equal(notSplit.error, "NOT_SPLIT");
  const whole = selectShopeeRouteProducts({ split: false, orderProducts, packages });
  assert.equal(whole.ok, true);
  if (whole.ok) assert.equal(summarizeOrderProducts(whole.products).texto, "1x Tirzepatida, 1x Retatrutide, 1x BIOGENISES GHK, 1x Lipoless");
});
