import assert from "node:assert/strict";
import test from "node:test";

import { pharmaCatalogHref, readPharmaFilters } from "./pharma-catalog-query";
import {
  buildPharmaShowcases,
  canonicalPharmaCategory,
  comparePharmaCategory,
  comparePharmaLaunches,
  isPharmaShowcaseHome,
  pharmaCategoryMatches,
  pharmaCategorySelected,
  pharmaMenuCategories,
  productMatchesPharmaCategory,
  type PharmaShowcaseProduct,
} from "./pharma-home-showcases";

const base = {
  isSoldOut: false,
  isLaunch: false,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  soldQty: 0,
  brand: "",
};

function item(partial: Partial<PharmaShowcaseProduct> & Pick<PharmaShowcaseProduct, "id" | "name">): PharmaShowcaseProduct {
  return { ...base, category: "Outra", ...partial };
}

const cleanFilters = { q: "", categoria: "", marca: "", promo: false, ordem: "relevancia" as const, vitrine: "" as const };

test("tirzepatida e peptideo ignoram acento; retatrutida aceita as duas grafias", () => {
  assert.equal(pharmaCategoryMatches("Tirzepatída", "Tirzepatida"), true);
  assert.equal(pharmaCategoryMatches("Peptideo", "Peptídeo"), true);
  assert.equal(pharmaCategoryMatches("Retatrutide", "Retatrutida"), true);
  assert.equal(pharmaCategoryMatches("Retatrutida", "Retatrutide"), true);
  assert.equal(pharmaCategoryMatches("Agua", "Água"), false);
  assert.equal(pharmaCategoryMatches("Água", "Água"), true);
  assert.equal(pharmaCategoryMatches("Retatrutida Extra", "Retatrutida"), false);
});

test("ordem da categoria: manual, depois venda; esgotado no fim", () => {
  const products = [
    item({ id: "zero-top", name: "Zero top", category: "Tirzepatida", sortOrder: 0, soldQty: 50 }),
    item({ id: "manual-2", name: "Manual 2", category: "Tirzepatida", sortOrder: 2, soldQty: 1 }),
    item({ id: "manual-1", name: "Manual 1", category: "Tirzepatida", sortOrder: 1, soldQty: 1 }),
    item({ id: "out", name: "Esgotado", category: "Tirzepatida", sortOrder: 1, soldQty: 99, isSoldOut: true }),
  ];
  const sorted = [...products].sort((a, b) => comparePharmaCategory(a, b, false));
  assert.deepEqual(sorted.map((product) => product.id), ["manual-1", "manual-2", "zero-top", "out"]);
});

test("peptideo: marca vem depois da ordem manual", () => {
  const products = [
    item({ id: "manual-alpha", name: "Manual", category: "Peptídeo", brand: "Zeta", sortOrder: 1, soldQty: 1 }),
    item({ id: "bio", name: "Bio", category: "Peptideo", brand: "BIOGENESIS", sortOrder: 0, soldQty: 1 }),
    item({ id: "zeta", name: "Zeta", category: "Peptídeo", brand: "Zeta", sortOrder: 0, soldQty: 40 }),
    item({ id: "alpha", name: "Alpha", category: "Peptídeo", brand: "Alpha", sortOrder: 0, soldQty: 80 }),
    item({ id: "none", name: "Sem marca", category: "Peptídeo", brand: "", sortOrder: 0, soldQty: 100 }),
  ];
  const sorted = [...products].sort((a, b) => comparePharmaCategory(a, b, true));
  assert.deepEqual(sorted.map((product) => product.id), ["manual-alpha", "bio", "alpha", "zeta", "none"]);
});

test("lancamento mais novo primeiro e esgotado no fim", () => {
  const products = [
    item({ id: "old", name: "Antigo", isLaunch: true, createdAt: "2026-01-01T00:00:00.000Z" }),
    item({ id: "new-out", name: "Novo esgotado", isLaunch: true, isSoldOut: true, createdAt: "2026-08-01T00:00:00.000Z" }),
    item({ id: "new", name: "Novo", isLaunch: true, createdAt: "2026-06-01T00:00:00.000Z" }),
  ];
  const sorted = [...products].sort(comparePharmaLaunches);
  assert.deepEqual(sorted.map((product) => product.id), ["new", "old", "new-out"]);
});

test("home limpa corta cinco blocos e esgota some da vitrine", () => {
  const products: PharmaShowcaseProduct[] = [
    ...Array.from({ length: 13 }, (_, index) => item({
      id: `tirze-${index}`,
      name: `Tirze ${index}`,
      category: index === 0 ? "Tirzepatída" : "Tirzepatida",
      soldQty: 13 - index,
    })),
    item({ id: "tirze-out", name: "Tirze out", category: "Tirzepatida", soldQty: 100, isSoldOut: true }),
    item({ id: "reta-a", name: "Reta A", category: "Retatrutide", soldQty: 2 }),
    item({ id: "reta-b", name: "Reta B", category: "Retatrutide", soldQty: 9 }),
    item({ id: "reta-c", name: "Reta C", category: "Retatrutida", soldQty: 3 }),
    item({ id: "agua", name: "Agua", category: "Água", soldQty: 40 }),
    item({ id: "launch-new", name: "Launch novo", category: "Água", isLaunch: true, createdAt: "2026-07-01T00:00:00.000Z", soldQty: 1 }),
    item({ id: "launch-old", name: "Launch antigo", category: "Peptídeo", isLaunch: true, createdAt: "2026-02-01T00:00:00.000Z", soldQty: 4 }),
    item({ id: "launch-out", name: "Launch out", category: "Água", isLaunch: true, isSoldOut: true, createdAt: "2026-09-01T00:00:00.000Z" }),
    item({ id: "pep", name: "Pep", category: "Peptideo", brand: "BIOGENESIS", soldQty: 2 }),
  ];

  const sections = buildPharmaShowcases(products);
  assert.deepEqual(sections.map((section) => section.id), ["tirzepatida", "retatrutida", "vendidos", "lancamentos", "peptideo"]);
  assert.equal(sections[0]?.title, "Tirzepatida");
  assert.equal(sections[0]?.products.length, 12);
  assert.equal(sections[0]?.products.some((product) => product.id === "tirze-out"), false);
  assert.equal(sections[1]?.title, "Retatrutide");
  assert.deepEqual(sections[1]?.products.map((product) => product.id), ["reta-b", "reta-c", "reta-a"]);
  assert.equal(sections[2]?.products[0]?.id, "agua");
  assert.equal(sections[2]?.products.some((product) => product.id === "tirze-0"), true);
  assert.deepEqual(sections[3]?.products.map((product) => product.id), ["launch-new", "launch-old"]);
  assert.equal(sections[4]?.products.some((product) => product.id === "launch-old"), true);
  assert.equal(sections[4]?.products.some((product) => product.id === "pep"), true);
});

test("kit entra depois da retatrutida só com a categoria real", () => {
  const products: PharmaShowcaseProduct[] = [
    item({ id: "tirze", name: "Tirze pura", category: "Tirzepatida", soldQty: 4 }),
    item({ id: "name-only", name: "Kit Tirzepatida 30mg", category: "Tirzepatida", soldQty: 6 }),
    item({ id: "kit-tirze", name: "Combo Tirzepatida 30mg", category: "Kit", soldQty: 3, sortOrder: 1 }),
    item({ id: "reta", name: "Reta", category: "Retatrutide", soldQty: 2 }),
    item({ id: "kit-pep", name: "Combo peptídeo", category: "Kít", brand: "Zeta", soldQty: 8 }),
    item({ id: "kit-med", name: "Ampola combo", category: " kit ", soldQty: 1 }),
    item({ id: "kit-out", name: "Combo esgotado", category: "Kit", isSoldOut: true, soldQty: 99 }),
    item({ id: "kit-off", name: "Combo inativo", category: "Kit", isActive: false, soldQty: 50 }),
    item({ id: "plain", name: "Ampola", category: "Medicamento", soldQty: 7 }),
    item({ id: "agua", name: "Agua", category: "Água", soldQty: 40 }),
    item({ id: "pep", name: "Pep", category: "Peptídeo", brand: "Zeta", soldQty: 2 }),
  ];

  const sections = buildPharmaShowcases(products);
  assert.deepEqual(sections.map((section) => section.id), ["tirzepatida", "retatrutida", "kit", "vendidos", "peptideo"]);
  const tirze = sections.find((section) => section.id === "tirzepatida");
  assert.equal(tirze?.products.some((product) => product.id === "kit-tirze"), false);
  assert.equal(tirze?.products.some((product) => product.id === "name-only"), true);
  assert.equal(tirze?.products.some((product) => product.id === "tirze"), true);
  const kit = sections.find((section) => section.id === "kit");
  assert.equal(kit?.title, "Kit");
  assert.equal(kit?.categoria, "kit");
  assert.equal(kit?.actionLabel, "Ver todos");
  assert.equal(kit?.ariaLabel, "Ver todos de Kit");
  assert.deepEqual(kit?.products.map((product) => product.id), ["kit-tirze", "kit-pep", "kit-med"]);
  assert.equal(sections.find((section) => section.id === "peptideo")?.products.some((product) => product.id === "kit-pep"), false);
  assert.equal(sections.find((section) => section.id === "peptideo")?.products.some((product) => product.id === "pep"), true);
  assert.equal(sections.find((section) => section.id === "vendidos")?.products.some((product) => product.id === "kit-out"), false);
  assert.equal(pharmaCatalogHref("/", { ...cleanFilters, categoria: kit?.categoria || "" }), "/?categoria=kit");
});

test("vitrine de kit corta em 12 e some sem produto à venda", () => {
  const kits = Array.from({ length: 13 }, (_, index) => item({
    id: `kit-${index}`,
    name: `Combo ${index}`,
    category: index % 2 === 0 ? "Kit" : "KÍT",
    soldQty: 13 - index,
  }));
  const sections = buildPharmaShowcases([
    ...kits,
    item({ id: "nome", name: "Kit no nome", category: "Medicamento", soldQty: 50 }),
    item({ id: "agua", name: "Agua", category: "Água", soldQty: 1 }),
  ]);
  const kit = sections.find((section) => section.id === "kit");
  assert.equal(kit?.products.length, 12);
  assert.equal(kit?.products[0]?.id, "kit-0");
  assert.equal(kit?.products.some((product) => product.id === "kit-12"), false);
  assert.equal(kit?.products.some((product) => product.id === "nome"), false);
  assert.deepEqual(sections.map((section) => section.id), ["kit", "vendidos"]);

  const hidden = buildPharmaShowcases([
    item({ id: "out", name: "Combo esgotado", category: "Kit", isSoldOut: true, soldQty: 4 }),
    item({ id: "off", name: "Combo inativo", category: "Kit", isActive: false, soldQty: 3 }),
    item({ id: "plain", name: "Kit Ampola", category: "Medicamento", soldQty: 2 }),
  ]);
  assert.equal(hidden.some((section) => section.id === "kit"), false);
});

test("filtro kit usa a categoria real e o menu não duplica Kit", () => {
  assert.equal(productMatchesPharmaCategory({ name: "Ampola", category: "Kit" }, "kit"), true);
  assert.equal(productMatchesPharmaCategory({ name: "Kit Ampola", category: "Medicamento" }, "kit"), false);
  assert.equal(productMatchesPharmaCategory({ name: "Kit Ampola", category: "Medicamento" }, "Medicamento"), true);
  assert.equal(productMatchesPharmaCategory({ name: "Alpha", category: "  KÍT  " }, "KIT"), true);
  assert.equal(productMatchesPharmaCategory({ name: "Ampola", category: "Medicamento" }, "kit"), false);
  assert.equal(productMatchesPharmaCategory({ name: "Combo", category: "Kit", isActive: false }, "kit"), false);
  assert.equal(productMatchesPharmaCategory(item({ id: "sold", name: "Esgotado", category: "Kit", isSoldOut: true }), "kit"), true);
  assert.equal(productMatchesPharmaCategory({ name: "Tirze", category: "Tirzepatída" }, "Tirzepatida"), true);
  assert.equal(pharmaCategoryMatches("Kit", "kit"), true);
  assert.equal(pharmaCategoryMatches("Kít", "KIT"), true);
  assert.equal(pharmaCategoryMatches("Medicamento", "kit"), false);
  assert.equal(pharmaCategorySelected("Kit", "kit"), true);
  assert.equal(pharmaCategorySelected("KIT", "kit"), true);
  assert.equal(pharmaCategorySelected("Água", "kit"), false);
  assert.equal(pharmaCategorySelected("Água", "Água"), true);
  assert.equal(canonicalPharmaCategory(" Kit "), "kit");
  assert.equal(canonicalPharmaCategory(" Kít "), "kit");
  assert.equal(canonicalPharmaCategory(" Tirzepatida "), "Tirzepatida");

  const categories = ["Tirzepatida", "Peptídeo", "Medicamento"];
  assert.deepEqual(pharmaMenuCategories(categories, [item({ id: "a", name: "Ampola" })]), categories);
  assert.deepEqual(
    pharmaMenuCategories(categories, [item({ id: "k", name: "Kit promo", category: "Tirzepatida" })]),
    categories,
  );
  assert.deepEqual(
    pharmaMenuCategories(categories, [item({ id: "k", name: "Combo", category: "Kit" })]),
    ["Kit", ...categories],
  );
  assert.deepEqual(
    pharmaMenuCategories(categories, [item({ id: "out", name: "Combo esgotado", category: "Kit", isSoldOut: true })]),
    categories,
  );
  assert.deepEqual(
    pharmaMenuCategories(["Tirzepatida", "Kit", "KIT", "kít"], [item({ id: "k", name: "Combo", category: "KIT" })]),
    ["Tirzepatida", "Kit"],
  );
  assert.deepEqual(
    pharmaMenuCategories(["Tirzepatida", "Kit"], [item({ id: "out", name: "Esgotado", category: "Kit", isSoldOut: true })]),
    ["Tirzepatida", "Kit"],
  );
});

test("secao sem produto em estoque some", () => {
  const sections = buildPharmaShowcases([
    item({ id: "out", name: "Out", category: "Tirzepatida", isSoldOut: true, soldQty: 9 }),
    item({ id: "agua", name: "Agua", category: "Água", soldQty: 1 }),
  ]);
  assert.deepEqual(sections.map((section) => section.id), ["vendidos"]);
});

test("query da vitrine e home limpa", () => {
  assert.equal(pharmaCatalogHref("/", { ...cleanFilters, vitrine: "vendidos" }), "/?vitrine=vendidos");
  assert.equal(pharmaCatalogHref("/loja", { ...cleanFilters, vitrine: "lancamentos" }), "/loja?vitrine=lancamentos");
  assert.equal(pharmaCatalogHref("/", { ...cleanFilters, categoria: "Retatrutide" }), "/?categoria=Retatrutide");
  assert.equal(readPharmaFilters("?vitrine=vendidos").vitrine, "vendidos");
  assert.equal(readPharmaFilters("?vitrine=outra").vitrine, "");
  assert.equal(isPharmaShowcaseHome(cleanFilters, 1), true);
  assert.equal(isPharmaShowcaseHome(cleanFilters, 2), false);
  assert.equal(isPharmaShowcaseHome({ ...cleanFilters, q: "tirze" }, 1), false);
  assert.equal(isPharmaShowcaseHome({ ...cleanFilters, vitrine: "vendidos" }, 1), false);
  assert.equal(isPharmaShowcaseHome({ ...cleanFilters, ordem: "menor" }, 1), false);
});
