import assert from "node:assert/strict";
import test from "node:test";

import {
  allPackagesDelivered,
  allPackagesEnviado,
  allPackagesLabelReady,
  buildPackageExternalOrderNumber,
  isSplitShipments,
  leastAdvancedShipmentStatus,
  packageInventoryReferenceId,
  pickInheritPackageIndex,
  rollupParentLabelUrl,
  validateOrderShipmentAllocation,
} from "./order-shipments-logic";

test("split exige 2 origens e soma fecha o pedido", () => {
  const orderItems = [
    { id: "sku-a", name: "Produto A", quantity: 2 },
    { id: "sku-b", name: "Produto B", quantity: 1 },
  ];
  const ok = validateOrderShipmentAllocation(orderItems, [
    { pool: "loja", items: [{ id: "sku-a", quantity: 1 }, { id: "sku-b", quantity: 1 }] },
    { pool: "minas", items: [{ id: "sku-a", quantity: 1 }] },
  ]);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.packages.length, 2);

  const oneOrigin = validateOrderShipmentAllocation(orderItems, [
    { pool: "loja", items: orderItems },
  ]);
  assert.equal(oneOrigin.ok, false);
  if (!oneOrigin.ok) assert.equal(oneOrigin.error.code, "NEED_TWO_ORIGINS");

  const duplicate = validateOrderShipmentAllocation(orderItems, [
    { pool: "minas", items: [{ id: "sku-a", quantity: 1 }] },
    { pool: "minas", items: [{ id: "sku-a", quantity: 1 }, { id: "sku-b", quantity: 1 }] },
  ]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, "DUPLICATE_POOL");

  const leftover = validateOrderShipmentAllocation(orderItems, [
    { pool: "loja", items: [{ id: "sku-a", quantity: 1 }] },
    { pool: "motoboy", items: [{ id: "sku-b", quantity: 1 }] },
  ]);
  assert.equal(leftover.ok, false);
  if (!leftover.ok) assert.equal(leftover.error.code, "QTY_MISMATCH");
});

test("orderId do pacote usa pool e gira sufixo depois do historico", () => {
  const order = { id: "abcdefghij1234", orderNumber: 2031 };
  assert.equal(buildPackageExternalOrderNumber(order, "minas"), "2031-abcdefgh-minas");
  assert.equal(buildPackageExternalOrderNumber(order, "motoboy"), "2031-abcdefgh-motoboy");
  const retry = buildPackageExternalOrderNumber(order, "minas", {
    envioecomStatusHistory: [{ at: "2026-09-04T12:00:00.000Z", status: "Cancelado" }],
  }, "lxyz");
  assert.equal(retry, "2031-abcdefgh-minas-lxyz");
  assert.equal(buildPackageExternalOrderNumber(order, "minas", {
    envioecomShipmentId: 99,
    envioecomExternalOrderNumber: "2031-abcdefgh-minas",
  }), "2031-abcdefgh-minas");
});

test("rollup: PDF no pai so quando todos tem URL; enviado e 48h sao AND", () => {
  const packages = [
    { envioecomLabelUrl: "https://a.pdf", envioecomStatus: "Etiqueta gerada", enviado: false },
    { envioecomLabelUrl: null, envioecomStatus: "Envio criado", enviado: false },
  ];
  assert.equal(rollupParentLabelUrl(packages), null);
  assert.equal(allPackagesLabelReady(packages), false);
  assert.equal(leastAdvancedShipmentStatus(packages), "Envio criado");

  const ready = [
    { envioecomLabelUrl: "https://a.pdf", envioecomStatus: "Aguardando coleta", enviado: false },
    { envioecomLabelUrl: "https://b.pdf", envioecomStatus: "Etiqueta gerada", enviado: false },
  ];
  assert.equal(rollupParentLabelUrl(ready), "https://a.pdf");
  assert.equal(allPackagesLabelReady(ready), true);
  assert.equal(allPackagesEnviado(ready), false);

  const posted = [
    { envioecomStatus: "Postado", enviado: true },
    { envioecomStatus: "Coletado", enviado: true },
  ];
  assert.equal(allPackagesEnviado(posted), true);
  assert.equal(allPackagesDelivered(posted), false);
  assert.equal(allPackagesDelivered([
    { envioecomStatus: "Entregue" },
    { envioecomStatus: "Objeto entregue" },
  ]), true);
});

test("helpers de split e referenceId do pacote", () => {
  assert.equal(isSplitShipments([]), false);
  assert.equal(isSplitShipments([{ id: "a" }]), false);
  assert.equal(isSplitShipments([{ id: "a" }, { id: "b" }]), true);
  assert.equal(packageInventoryReferenceId("abc"), "pkg:abc");
  assert.equal(pickInheritPackageIndex([
    { pool: "loja", items: [] },
    { pool: "minas", items: [] },
  ], "minas"), 1);
});
