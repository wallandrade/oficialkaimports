import assert from "node:assert/strict";
import test from "node:test";

import { buildHomeHero, homeHeroCategoryHref, homeHeroSalePrice, shouldShowHomeHero, type HomeHeroProduct } from "./home-hero";

const photo = "https://cdn.example/produto.jpg";

function product(partial: Partial<HomeHeroProduct> & Pick<HomeHeroProduct, "id" | "name" | "category">): HomeHeroProduct {
  return {
    price: 100,
    image: photo,
    isSoldOut: false,
    isLaunch: false,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    soldQty: 0,
    ...partial,
  };
}

test("destaque é o produto à venda com maior soldQty e a foto é a dele", () => {
  const model = buildHomeHero([
    product({ id: "agua", name: "Água 3ml", category: "Água", soldQty: 40, price: 30 }),
    product({ id: "tg", name: "TG Tirzepatida 15mg", category: "Tirzepatida", soldQty: 90, price: 1150 }),
    product({ id: "barato", name: "Tirzedral", category: "Tirzepatida", soldQty: 3, price: 300 }),
    product({ id: "esgotado", name: "Antigo", category: "Tirzepatida", soldQty: 500, price: 10, isSoldOut: true, image: "https://cdn.example/out.jpg" }),
  ], ["Tirzepatida", "Água"]);

  assert.equal(model?.hero.productId, "tg");
  assert.equal(model?.hero.category, "Tirzepatida");
  assert.equal(model?.hero.imageAlt, "TG Tirzepatida 15mg");
  assert.equal(model?.hero.subtitle, "mais vendido");
  assert.equal(model?.hero.fromPrice, 300);
  assert.equal(model?.wide?.category, "Água");
  assert.equal(model?.wide?.fromPrice, 30);
});

test("destaque prefere Tirzepatida ou Retatrutida mesmo se outra categoria vendeu mais", () => {
  const model = buildHomeHero([
    product({ id: "agua", name: "Água 3ml", category: "Água", soldQty: 400, price: 35 }),
    product({ id: "pep", name: "Kit peptídeo", category: "Peptideo", soldQty: 200, price: 320 }),
    product({ id: "reta", name: "Reta 10", category: "Retatrutide", soldQty: 12, price: 390 }),
    product({ id: "tirz", name: "TG Tirzepatida", category: "Tirzepatida", soldQty: 40, price: 220 }),
  ], ["Água", "Tirzepatida", "Retatrutide", "Peptideo"]);

  assert.equal(model?.hero.productId, "tirz");
  assert.equal(model?.hero.category, "Tirzepatida");
  assert.equal(model?.hero.subtitle, "mais vendido");
  assert.equal(model?.hero.fromPrice, 220);
  assert.equal(model?.wide?.category, "Água");
  assert.deepEqual(model?.small.map((card) => card.category), ["Retatrutide", "Peptideo"]);
});

test("grafia sem acento, maiúsculas e Tirzepatide/Retatrutide entram na mesma escolha", () => {
  const model = buildHomeHero([
    product({ id: "agua", name: "Água", category: "Água", soldQty: 99, price: 35 }),
    product({ id: "t", name: "T inglês", category: "  TIRZEPATÍDE  ", soldQty: 2, price: 500 }),
    product({ id: "r", name: "Reta", category: "Retatrutída", soldQty: 8, price: 390 }),
  ], ["Água", "Retatrutída", "  TIRZEPATÍDE  "]);

  assert.equal(model?.hero.productId, "r");
  assert.equal(model?.hero.category, "Retatrutída");
  assert.equal(model?.wide?.category, "Água");
  assert.deepEqual(model?.small.map((card) => card.category), ["TIRZEPATÍDE"]);
});

test("sem uma das duas à venda, o destaque usa a outra", () => {
  const model = buildHomeHero([
    product({ id: "agua", name: "Água", category: "Água", soldQty: 99, price: 35 }),
    product({ id: "t-out", name: "T esgotada", category: "Tirzepatida", soldQty: 500, isSoldOut: true }),
    product({ id: "t-off", name: "T inativa", category: "Tirzepatide", soldQty: 400, isActive: false }),
    product({ id: "t-nofoto", name: "T sem foto", category: "Tirzepatida", soldQty: 300, image: "" }),
    product({ id: "r", name: "Reta", category: "retatrutide", soldQty: 1, price: 410 }),
  ], ["Água", "Tirzepatida", "Tirzepatide", "retatrutide"]);

  assert.equal(model?.hero.productId, "r");
  assert.equal(model?.hero.category, "retatrutide");
  assert.equal(model?.hero.fromPrice, 410);
  assert.equal(model?.wide?.category, "Água");
});

test("sem Tirzepatida nem Retatrutida à venda, o destaque volta ao mais vendido da loja", () => {
  const model = buildHomeHero([
    product({ id: "agua", name: "Água", category: "Água", soldQty: 4, price: 35 }),
    product({ id: "pep", name: "Pep", category: "Peptideo", soldQty: 9, price: 320 }),
    product({ id: "t", name: "T", category: "Tirzepatida", soldQty: 100, isSoldOut: true }),
    product({ id: "r", name: "R", category: "Retatrutide", soldQty: 80, image: "ftp://sem-foto" }),
  ], ["Água", "Peptideo", "Tirzepatida", "Retatrutide"]);

  assert.equal(model?.hero.productId, "pep");
  assert.equal(model?.hero.category, "Peptideo");
  assert.equal(model?.wide?.category, "Água");
});

test("empate entre Tirzepatida e Retatrutida usa a ordem do catálogo, não a de outra linha", () => {
  const model = buildHomeHero([
    product({ id: "agua", name: "Água", category: "Água", soldQty: 0, sortOrder: 1, price: 35 }),
    product({ id: "r", name: "Reta", category: "Retatrutide", soldQty: 0, sortOrder: 5, price: 390 }),
    product({ id: "t", name: "Tirz", category: "Tirzepatida", soldQty: 0, sortOrder: 2, price: 220 }),
  ], ["Água", "Retatrutide", "Tirzepatida"]);

  assert.equal(model?.hero.productId, "t");
  assert.equal(model?.hero.category, "Tirzepatida");
  assert.equal(model?.hero.subtitle, "em destaque");
  assert.equal(model?.wide?.category, "Água");
});

test("cada lista fica na própria loja", () => {
  const loja1 = buildHomeHero([
    product({ id: "a", name: "Produto A", category: "Linha A", price: 12, soldQty: 4 }),
  ], ["Linha A"]);
  const filial = buildHomeHero([
    product({ id: "b", name: "Produto B", category: "Linha B", price: 80, soldQty: 9 }),
  ], ["Linha B"]);

  assert.equal(loja1?.hero.category, "Linha A");
  assert.equal(loja1?.hero.fromPrice, 12);
  assert.equal(filial?.hero.category, "Linha B");
  assert.equal(filial?.hero.fromPrice, 80);
});

test("preço some sem valor positivo e ignora esgotado, promo vencida já nula e faixa que não cobre 1 unidade", () => {
  assert.equal(homeHeroSalePrice(product({ id: "z", name: "Z", category: "C", price: 0 })), null);
  assert.equal(homeHeroSalePrice(product({ id: "p", name: "P", category: "C", price: 100, promoPrice: 80 })), 80);
  assert.equal(
    homeHeroSalePrice(product({
      id: "f",
      name: "F",
      category: "C",
      price: 100,
      promoPrice: 80,
      bulkDiscountEnabled: true,
      bulkDiscountTiers: [{ minQty: 2, maxQty: null, unitPrice: 10 }],
    })),
    80,
  );
  assert.equal(
    homeHeroSalePrice(product({
      id: "u",
      name: "U",
      category: "C",
      price: 100,
      bulkDiscountEnabled: true,
      bulkDiscountTiers: [{ minQty: 1, maxQty: 4, unitPrice: 70 }],
    })),
    70,
  );

  const model = buildHomeHero([
    product({ id: "sem", name: "Sem preço", category: "Vazia", price: 0, soldQty: 2 }),
    product({ id: "out", name: "Outro", category: "Outra", price: 15, soldQty: 1 }),
  ], ["Vazia", "Outra"]);
  assert.equal(model?.hero.fromPrice, null);
  assert.equal(model?.wide?.category, "Outra");
});

test("sem produto à venda com foto a seção não monta", () => {
  assert.equal(buildHomeHero([], []), null);
  assert.equal(buildHomeHero([
    product({ id: "x", name: "X", category: "Cat", isSoldOut: true, soldQty: 9 }),
    product({ id: "y", name: "Y", category: "Cat", image: "", soldQty: 8 }),
    product({ id: "z", name: "Z", category: "Cat", image: "/relativo.jpg", soldQty: 7 }),
  ]), null);
});

test("aceita foto https e data uri legado", () => {
  const model = buildHomeHero([
    product({ id: "d", name: "Data", category: "Peptídeo", image: "data:image/jpeg;base64,AAAA", soldQty: 2, price: 40 }),
  ]);
  assert.equal(model?.hero.image.startsWith("data:image/"), true);
  assert.equal(model?.hero.fromPrice, 40);
});

test("cards seguem a ordem da loja, tiram a categoria do destaque e deixam os pequenos em número par", () => {
  const rows = ["Hero", "A", "B", "C", "D"].map((category, index) => product({
    id: category,
    name: category,
    category,
    soldQty: category === "Hero" ? 50 : 1,
    price: 10 + index,
  }));
  const model = buildHomeHero(rows, ["Hero", "A", "B", "C", "D"]);
  assert.equal(model?.wide?.category, "A");
  assert.deepEqual(model?.small.map((card) => card.category), ["B", "C"]);
});

test("sem venda o texto não chama de mais vendido e o empate usa a ordem do catálogo", () => {
  const model = buildHomeHero([
    product({ id: "b", name: "B", category: "Beta", soldQty: 0, sortOrder: 2, price: 20 }),
    product({ id: "a", name: "A", category: "Alfa", soldQty: 0, sortOrder: 1, price: 30 }),
  ], ["Beta", "Alfa"]);
  assert.equal(model?.hero.productId, "a");
  assert.equal(model?.hero.subtitle, "em destaque");
  assert.equal(model?.wide?.category, "Beta");
});

test("hero só na home limpa", () => {
  assert.equal(shouldShowHomeHero({ pharma: true, search: "" }), true);
  assert.equal(shouldShowHomeHero({ pharma: true, search: "?q=agua" }), false);
  assert.equal(shouldShowHomeHero({ pharma: true, search: "?categoria=Botox" }), false);
  assert.equal(shouldShowHomeHero({ pharma: true, search: "?categoria=kit" }), false);
  assert.equal(shouldShowHomeHero({ pharma: true, search: "?marca=Veltrane" }), false);
  assert.equal(shouldShowHomeHero({ pharma: true, search: "?promo=1" }), false);
  assert.equal(shouldShowHomeHero({ pharma: true, search: "?vitrine=vendidos" }), false);
  assert.equal(shouldShowHomeHero({ pharma: true, search: "?ordem=menor" }), false);
  assert.equal(shouldShowHomeHero({ pharma: false, query: "" }), false);
  assert.equal(shouldShowHomeHero({ pharma: false, query: "agua" }), false);
  assert.equal(shouldShowHomeHero({ pharma: false, categories: ["Botox"] }), false);
  assert.equal(shouldShowHomeHero({ pharma: false, name: "tirz" }), false);
  assert.equal(shouldShowHomeHero({ pharma: false, brand: "Veltrane" }), false);
});

test("card Kit ocupa uma das cinco vagas e o destaque continua na linha preferida", () => {
  const rows = ["Tirzepatida", "A", "B", "C", "D", "E"].map((category) => product({
    id: category,
    name: category === "Tirzepatida" ? "TG Tirzepatida" : category,
    category,
    soldQty: category === "Tirzepatida" ? 50 : 1,
    price: category === "Tirzepatida" ? 500 : 100,
  }));
  const model = buildHomeHero([
    ...rows,
    product({
      id: "kit-cover",
      name: "Combo lista",
      category: "Kit",
      soldQty: 8,
      price: 450,
      image: "https://cdn.example/kit-lista.jpg",
    }),
    product({
      id: "kit-promo",
      name: "Combo promo",
      category: " KIT ",
      soldQty: 2,
      price: 800,
      promoPrice: 420,
      image: "https://cdn.example/kit-promo.jpg",
    }),
    product({
      id: "kit-accent",
      name: "Combo acento",
      category: "Kít",
      soldQty: 1,
      price: 600,
      image: "https://cdn.example/kit-accent.jpg",
    }),
    product({
      id: "name-only",
      name: "Kit no nome",
      category: "Peptídeo",
      soldQty: 20,
      price: 50,
      image: "https://cdn.example/nome.jpg",
    }),
    product({
      id: "kit-out",
      name: "Combo esgotado",
      category: "Kit",
      soldQty: 99,
      price: 10,
      isSoldOut: true,
      image: "https://cdn.example/kit-out.jpg",
    }),
    product({
      id: "kit-off",
      name: "Combo inativo",
      category: "Kit",
      soldQty: 90,
      price: 5,
      isActive: false,
      image: "https://cdn.example/kit-off.jpg",
    }),
  ], ["Tirzepatida", "A", "B", "C", "D", "E", "Peptídeo", "Kit", "KIT", "Kít"]);

  assert.equal(model?.hero.productId, "Tirzepatida");
  assert.equal(model?.hero.category, "Tirzepatida");
  assert.equal(model?.hero.fromPrice, 500);
  assert.equal(model?.wide?.category, "A");
  assert.deepEqual(model?.small.map((card) => card.category), ["B", "C", "D", "Kit"]);
  assert.equal(model?.small.filter((card) => card.category === "Kit").length, 1);
  const kit = model?.small.find((card) => card.category === "Kit");
  assert.equal(kit?.image, "https://cdn.example/kit-lista.jpg");
  assert.equal(kit?.imageAlt, "Combo lista");
  assert.equal(kit?.fromPrice, 420);
});

test("categoria Kit ignora acento, espaço e maiúsculas; nome com kit fica na categoria real", () => {
  const model = buildHomeHero([
    product({ id: "t", name: "TG", category: "Tirzepatida", soldQty: 3, price: 500 }),
    product({ id: "k", name: "Alpha", category: "  Kít  ", soldQty: 1, price: 510, promoPrice: 420 }),
    product({ id: "nome", name: "Kit medicamento", category: "Medicamento", soldQty: 4, price: 40 }),
  ], ["Tirzepatida", "Medicamento", "Kít"]);

  assert.equal(model?.hero.category, "Tirzepatida");
  assert.equal(model?.hero.fromPrice, 500);
  assert.equal(model?.wide?.category, "Medicamento");
  assert.equal(model?.wide?.fromPrice, 40);
  assert.equal(model?.small.length, 1);
  assert.equal(model?.small[0]?.category, "Kit");
  assert.equal(model?.small[0]?.fromPrice, 420);
  assert.equal(model?.small[0]?.imageAlt, "Alpha");
});

test("quando o destaque já é Kit, a fileira não ganha outro card Kit", () => {
  const model = buildHomeHero([
    product({ id: "k1", name: "Combo A", category: "KIT", soldQty: 20, price: 300, image: "https://cdn.example/a.jpg" }),
    product({ id: "k2", name: "Combo B", category: " kít ", soldQty: 4, price: 800, promoPrice: 90, image: "https://cdn.example/b.jpg" }),
    product({ id: "agua", name: "Água", category: "Água", soldQty: 2, price: 30 }),
    product({ id: "nome", name: "Kit no nome", category: "Água", soldQty: 3, price: 15 }),
  ], ["KIT", "kít", "Água"]);

  assert.equal(model?.hero.productId, "k1");
  assert.equal(model?.hero.category, "Kit");
  assert.equal(model?.hero.imageAlt, "Combo A");
  assert.equal(model?.hero.fromPrice, 90);
  assert.equal(model?.wide?.category, "Água");
  assert.equal(model?.wide?.fromPrice, 15);
  assert.deepEqual(model?.small.map((card) => card.category), []);
  const labels = [model?.hero.category, model?.wide?.category, ...(model?.small.map((card) => card.category) ?? [])];
  assert.equal(labels.filter((category) => category === "Kit").length, 1);
});

test("sem produto da categoria Kit à venda com foto o card Kit não entra", () => {
  const model = buildHomeHero([
    product({ id: "t", name: "TG", category: "Tirzepatida", soldQty: 4, price: 200 }),
    product({ id: "a", name: "Água", category: "Água", soldQty: 1, price: 30 }),
    product({ id: "out", name: "Combo esgotado", category: "Kit", isSoldOut: true, price: 10, soldQty: 9 }),
    product({ id: "off", name: "Combo inativo", category: "Kit", isActive: false, price: 10 }),
    product({ id: "nofoto", name: "Combo sem foto", category: "Kit", image: "", price: 10 }),
    product({ id: "plain", name: "Kit Ampola", category: "Medicamento", price: 40, soldQty: 2 }),
  ], ["Tirzepatida", "Água", "Medicamento", "Kit"]);

  assert.equal(model?.hero.category, "Tirzepatida");
  assert.equal(model?.wide?.category, "Água");
  assert.deepEqual(model?.small.map((card) => card.category), ["Medicamento"]);
});

test("link da categoria fica na home da loja", () => {
  assert.equal(
    homeHeroCategoryHref({ category: "Tirzepatida", homeHref: "/kaique", mode: "pharma" }),
    "/kaique?categoria=Tirzepatida",
  );
  assert.equal(
    homeHeroCategoryHref({ category: "Kit", homeHref: "/", mode: "pharma" }),
    "/?categoria=kit",
  );
  assert.equal(
    homeHeroCategoryHref({ category: " Kít ", homeHref: "/loja", mode: "pharma" }),
    "/loja?categoria=kit",
  );
  assert.equal(
    homeHeroCategoryHref({ category: "Água", homeHref: "/", mode: "path", sellerSlug: "loja", base: "" }),
    "/loja/categoria/%C3%81gua",
  );
  assert.equal(
    homeHeroCategoryHref({ category: "Botox", homeHref: "/", mode: "path" }),
    "/categoria/Botox",
  );
});
