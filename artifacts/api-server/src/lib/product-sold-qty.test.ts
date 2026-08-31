import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateSoldQtyFromOrders,
  isReshipmentChildOrder,
  soldQtyForCatalogProduct,
} from "./product-sold-qty";

test("ignora pedido filho de reenvio", () => {
  assert.equal(isReshipmentChildOrder("REENVIO DO PEDIDO abc · TICKET 1"), true);
  assert.equal(isReshipmentChildOrder("Pedido normal"), false);
});

test("soldQty usa max de id e nome e nao soma os dois mapas", () => {
  const agg = aggregateSoldQtyFromOrders([
    {
      observation: null,
      products: [
        { id: "p1", name: "Tirzec 15mg", quantity: 2 },
        { name: "Tirzec 15mg", quantity: 3 },
      ],
    },
    {
      observation: "REENVIO DO PEDIDO xyz",
      products: [{ id: "p1", name: "Tirzec 15mg", quantity: 99 }],
    },
  ]);

  assert.equal(agg.byId.get("p1"), 2);
  assert.equal(agg.byName.get("tirzec 15mg"), 5);
  assert.equal(soldQtyForCatalogProduct({ id: "p1", name: "Tirzec 15mg" }, agg), 5);
});

test("nome normalizado ignora acento e caixa", () => {
  const agg = aggregateSoldQtyFromOrders([
    { products: [{ name: "Peptídeo BIO", quantity: 1 }] },
  ]);
  assert.equal(soldQtyForCatalogProduct({ id: "x", name: "Peptideo BIO" }, agg), 1);
});
