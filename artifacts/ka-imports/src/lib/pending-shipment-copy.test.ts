import assert from "node:assert/strict";
import test from "node:test";
import {
  getPendingShipmentCopy,
  hasEnvioEcomLabelReady,
  pendingShipmentResumoHeading,
} from "./pending-shipment-copy";

const order2124 = {
  products: [
    { id: "retagen", name: "OXYGEN RETAGEN 120MG – 01 VIAL DILUIDA", quantity: 1 },
    { id: "semax", name: "OXYGEN SEMAX 18MG NASAL", quantity: 1 },
    { id: "selank", name: "OXYGEN SELANK 18MG NASAL", quantity: 1 },
    { id: "ghk", name: "OXYGEN GHK-CU 100MG 02ML – 01 VIAL diluido", quantity: 1 },
  ],
  packages: [
    {
      inventoryPool: "minas",
      envioecomStatus: "DC-e emitida",
      envioecomLabelUrl: "https://cdn.example/minas.pdf",
      items: [
        { productId: "retagen", productName: "OXYGEN RETAGEN 120MG – 01 VIAL DILUIDA", quantity: 1 },
        { productId: "selank", productName: "OXYGEN SELANK 18MG NASAL", quantity: 1 },
        { productId: "ghk", productName: "OXYGEN GHK-CU 100MG 02ML – 01 VIAL diluido", quantity: 1 },
      ],
    },
    {
      inventoryPool: "loja",
      envioecomStatus: null,
      envioecomLabelUrl: null,
      items: [
        { productId: "semax", productName: "OXYGEN SEMAX 18MG NASAL", quantity: 1 },
      ],
    },
  ],
};

test("split com uma etiqueta pronta nao tira o pedido da fila 48h", () => {
  assert.equal(hasEnvioEcomLabelReady(order2124), false);
});

test("copia 48h do split so lista o pacote que ainda falta etiqueta", () => {
  const copy = getPendingShipmentCopy(order2124);
  assert.equal(copy.isPartialSplit, true);
  assert.deepEqual(copy.remainingPools, ["Fóz Guaçu"]);
  assert.deepEqual(copy.items.map((item) => item.name), ["OXYGEN SEMAX 18MG NASAL"]);
  assert.equal(pendingShipmentResumoHeading(copy), "Resumo pedido (falta etiqueta — Fóz Guaçu)");
});

test("pedido sem split continua com todos os itens", () => {
  const copy = getPendingShipmentCopy({
    products: order2124.products,
    packages: [],
  });
  assert.equal(copy.isPartialSplit, false);
  assert.equal(copy.items.length, 4);
  assert.equal(pendingShipmentResumoHeading(copy), "Resumo pedido");
});

test("split sem nenhuma etiqueta ainda lista o pedido inteiro pelos pacotes", () => {
  const copy = getPendingShipmentCopy({
    products: order2124.products,
    packages: order2124.packages.map((pkg) => ({
      ...pkg,
      envioecomStatus: null,
      envioecomLabelUrl: null,
    })),
  });
  assert.equal(copy.isPartialSplit, false);
  assert.equal(copy.items.length, 4);
  assert.equal(pendingShipmentResumoHeading(copy), "Resumo pedido");
});
