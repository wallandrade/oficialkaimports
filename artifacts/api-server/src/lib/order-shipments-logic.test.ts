import assert from "node:assert/strict";
import test from "node:test";

import {
  allPackagesDelivered,
  allPackagesEnviado,
  allPackagesLabelReady,
  bindEnvioEcomFieldsToPackage,
  buildPackageExternalOrderNumber,
  isSplitShipments,
  labeledPoolsMissingFromAllocation,
  leastAdvancedShipmentStatus,
  packageHasOwnEnvioEcomRef,
  packageInventoryReferenceId,
  shipmentRefBelongsToOtherPackage,
  pickInheritPackageIndex,
  pickUnboundPackageId,
  rollupParentLabelUrl,
  splitUndoBlock,
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

test("orderId do pacote usa pool e gira sufixo depois de desvincular", () => {
  const order = { id: "abcdefghij1234", orderNumber: 2031 };
  assert.equal(buildPackageExternalOrderNumber(order, "minas"), "2031-abcdefgh-minas");
  assert.equal(buildPackageExternalOrderNumber(order, "motoboy"), "2031-abcdefgh-motoboy");
  assert.equal(buildPackageExternalOrderNumber(order, "minas", {
    envioecomShipmentId: 99,
    envioecomBarcode: "888030900000001",
    envioecomExternalOrderNumber: "2031-abcdefgh-minas",
  }), "2031-abcdefgh-minas");
  const retry = buildPackageExternalOrderNumber(order, "minas", {
    envioecomShipmentId: null,
    envioecomBarcode: null,
    envioecomExternalOrderNumber: "2031-abcdefgh-minas",
  }, "lxyz");
  assert.equal(retry, "2031-abcdefgh-minas-lxyz");
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

  const expedidoSplit = [
    { envioecomLabelUrl: null, envioecomStatus: "Expedido - POO -MG", enviado: true },
    { envioecomLabelUrl: "https://moto.pdf", envioecomStatus: "Pronto para envio", enviado: false },
  ];
  assert.equal(allPackagesLabelReady(expedidoSplit), true);
  assert.equal(allPackagesEnviado(expedidoSplit), false);
  assert.equal(leastAdvancedShipmentStatus(expedidoSplit), "Pronto para envio");
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

test("bind do pacote nao herda rastreio/etiqueta do pedido irmao", () => {
  const order = {
    envioecomShipmentId: 99,
    envioecomBarcode: "888030937018141",
    envioecomStatus: "DC-e emitida",
    envioecomLabelUrl: "https://minas.pdf",
    trackingCode: "888030937018141",
    trackingLabelUrl: "https://minas.pdf",
    envioecomAccountId: "minas",
  };
  const unbound = bindEnvioEcomFieldsToPackage(order, {
    envioecomShipmentId: null,
    envioecomBarcode: null,
    envioecomStatus: null,
    envioecomLabelUrl: null,
    envioecomAccountId: null,
  });
  assert.equal(unbound.envioecomShipmentId, null);
  assert.equal(unbound.envioecomBarcode, null);
  assert.equal(unbound.trackingCode, null);
  assert.equal(unbound.trackingLabelUrl, null);
  assert.equal(unbound.envioecomStatus, null);
  assert.equal(packageHasOwnEnvioEcomRef(unbound), false);

  const own = bindEnvioEcomFieldsToPackage(order, {
    envioecomShipmentId: 71,
    envioecomBarcode: "888030900000001",
    envioecomStatus: "Envio criado",
    envioecomLabelUrl: "https://foz.pdf",
  });
  assert.equal(own.envioecomShipmentId, 71);
  assert.equal(own.trackingCode, "888030900000001");
  assert.equal(own.trackingLabelUrl, "https://foz.pdf");
  assert.equal(packageHasOwnEnvioEcomRef(own), true);
});

test("codigo de outro pacote do mesmo pedido nao vale para a linha clicada", () => {
  const packages = [
    { id: "foz", envioecomShipmentId: 11, envioecomBarcode: "888030999646160" },
    { id: "minas", envioecomShipmentId: 22, envioecomBarcode: "888031000015326" },
  ];
  assert.equal(shipmentRefBelongsToOtherPackage(packages, "minas", { shipmentId: 11 }), true);
  assert.equal(shipmentRefBelongsToOtherPackage(packages, "minas", { barcode: "888030999646160" }), true);
  assert.equal(shipmentRefBelongsToOtherPackage(packages, "minas", { shipmentId: 22, barcode: "888031000015326" }), false);
  assert.equal(shipmentRefBelongsToOtherPackage(packages, "minas", { barcode: "888039999999999" }), false);
  assert.equal(shipmentRefBelongsToOtherPackage(packages, "minas", {}), false);
});

test("pickUnboundPackageId escolhe o pacote sem envio proprio", () => {
  assert.equal(pickUnboundPackageId([
    { id: "minas", envioecomShipmentId: 71, envioecomBarcode: "888030936387775" },
    { id: "motoboy", envioecomShipmentId: null, envioecomBarcode: null },
  ]), "motoboy");
  assert.equal(pickUnboundPackageId([
    { id: "minas", envioecomBarcode: "8880" },
    { id: "motoboy", envioecomBarcode: "8881" },
  ]), null);
});

test("desfazer divisao bloqueia etiqueta, postagem e baixa", () => {
  const open = [
    { inventoryPool: "loja", enviado: false, inventoryReserved: false },
    { inventoryPool: "motoboy", enviado: false, inventoryReserved: false },
  ];
  assert.equal(splitUndoBlock(open).ok, true);
  const labeled = splitUndoBlock([
    { inventoryPool: "loja" },
    { inventoryPool: "motoboy", envioecomShipmentId: 22, envioecomBarcode: "888031000015326" },
  ]);
  assert.equal(labeled.ok, false);
  if (!labeled.ok) assert.equal(labeled.error.code, "SPLIT_HAS_LABEL");
  const posted = splitUndoBlock([
    { inventoryPool: "loja", enviado: true },
    { inventoryPool: "minas" },
  ]);
  assert.equal(posted.ok, false);
  if (!posted.ok) assert.equal(posted.error.code, "SPLIT_LOCKED");
  assert.equal(splitUndoBlock([{ inventoryPool: "loja" }]).ok, false);
});

test("realocar split nao deixa remover origem com etiqueta EE", () => {
  const existing = [
    { inventoryPool: "motoboy", envioecomShipmentId: 88, envioecomBarcode: "888030944221801" },
    { inventoryPool: "minas", envioecomShipmentId: null, envioecomBarcode: null },
  ];
  assert.deepEqual(
    labeledPoolsMissingFromAllocation(existing, [{ pool: "minas" }, { pool: "loja" }]),
    ["motoboy"],
  );
  assert.deepEqual(
    labeledPoolsMissingFromAllocation(existing, [{ pool: "motoboy" }, { pool: "minas" }]),
    [],
  );
});
