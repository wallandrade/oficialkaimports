import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseCustomerPackagesForOrder,
  getCustomerPackageSituation,
  getCustomerPartialHint,
  getCustomerSplitBadgeStatus,
  getCustomerSplitSituation,
  isCustomerSplitOrder,
} from "./customer-split-shipping";

const packages = [
  { id: "a", enviado: true, envioecomStatus: "Em trânsito", items: [{ productName: "Retatrutida", quantity: 1 }] },
  { id: "b", enviado: false, envioecomStatus: null, items: [{ productName: "Tesamorelin", quantity: 1 }] },
];

test("pedido dividido mostra enviado vs aguardando envio", () => {
  assert.equal(isCustomerSplitOrder(packages, false), true);
  assert.equal(getCustomerPackageSituation(packages[0]).label, "Em trânsito");
  assert.equal(getCustomerPackageSituation(packages[1]).kind, "waiting");
  assert.equal(getCustomerPackageSituation(packages[1]).label, "Aguardando envio");
  assert.equal(getCustomerSplitSituation(packages, false), "Enviado parcialmente");
  assert.equal(getCustomerSplitBadgeStatus(packages, "paid", false), "enviado_parcial");
  assert.equal(getCustomerPartialHint(packages, false), "Parte do pedido já saiu. O restante ainda está sendo preparado.");
});

test("admin já marcou enviado some o pacote interno e o parcial", () => {
  assert.equal(isCustomerSplitOrder(packages, true), false);
  assert.equal(getCustomerSplitBadgeStatus(packages, "paid", true), "enviado");
  assert.equal(getCustomerSplitSituation(packages, true), "Em trânsito");
  assert.equal(getCustomerPartialHint(packages, true), null);
  const visible = collapseCustomerPackagesForOrder(packages, true);
  assert.equal(visible.length, 1);
  assert.deepEqual(visible[0].items?.map((item) => item.productName), ["Retatrutida", "Tesamorelin"]);
});

test("pacote com EnvioEcom ainda não coletado é embalando, não estoque", () => {
  const packing = getCustomerPackageSituation({
    id: "a",
    envioecomStatus: "Processando envio",
    envioecomShipmentId: 8880,
  });
  assert.equal(packing.kind, "packing");
  assert.equal(packing.label, "Estamos embalando esta parte");
  const mixed = getCustomerSplitSituation([
    { id: "a", envioecomStatus: "Processando envio", envioecomShipmentId: 8880 },
    { id: "b" },
  ], false);
  assert.equal(mixed, "Em preparação");
});

test("aguardando coleta vira embalando", () => {
  const packing = getCustomerPackageSituation({
    id: "a",
    envioecomStatus: "Aguardando coleta",
    envioecomShipmentId: 1,
  });
  assert.equal(packing.kind, "packing");
  assert.equal(packing.label, "Estamos embalando esta parte");
});
