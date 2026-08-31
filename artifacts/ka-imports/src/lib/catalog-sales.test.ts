import assert from "node:assert/strict";
import test from "node:test";

import { sortCatalogProducts, topSellerRanks } from "./catalog-sales";

const base = {
  isSoldOut: false,
  isLaunch: false,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("ordena por soldQty e esgotado por ultimo", () => {
  const sorted = sortCatalogProducts([
    { id: "c", name: "C", soldQty: 1, ...base },
    { id: "a", name: "A", soldQty: 9, ...base },
    { id: "out", name: "Out", soldQty: 50, isSoldOut: true, isLaunch: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", name: "B", soldQty: 9, isLaunch: true, isSoldOut: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" },
  ], "Tirzepatida");
  assert.deepEqual(sorted.map((item) => item.id), ["b", "a", "c", "out"]);
});

test("peptideo agrupa BIOGENESIS primeiro e TOP ignora a grade", () => {
  const products = [
    { id: "bio-low", name: "Bio baixo", brand: "BIOGENESIS", soldQty: 1, ...base },
    { id: "other-top", name: "Outro top", brand: "Alpha", soldQty: 20, ...base },
    { id: "none", name: "Sem marca", brand: "", soldQty: 8, ...base },
  ];
  const sorted = sortCatalogProducts(products, "Peptídeo");
  assert.deepEqual(sorted.map((item) => item.id), ["bio-low", "other-top", "none"]);
  const ranks = topSellerRanks(products);
  assert.equal(ranks.get("other-top"), 1);
  assert.equal(ranks.get("none"), 2);
  assert.equal(ranks.get("bio-low"), 3);
});
