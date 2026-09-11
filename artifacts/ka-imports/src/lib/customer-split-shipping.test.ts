import assert from "node:assert/strict";
import test from "node:test";
import {
  getCustomerPackageSituation,
  getCustomerSplitBadgeStatus,
  getCustomerSplitSituation,
  isCustomerSplitOrder,
} from "./customer-split-shipping";

test("pedido dividido mostra enviado vs aguardando estoque", () => {
  const packages = [
    { id: "a", enviado: true, envioecomStatus: "Em trânsito", items: [{ productName: "Retatrutida", quantity: 1 }] },
    { id: "b", enviado: false, envioecomStatus: null, items: [{ productName: "Tesamorelin", quantity: 1 }] },
  ];
  assert.equal(isCustomerSplitOrder(packages), true);
  assert.equal(getCustomerPackageSituation(packages[0]).label, "Em trânsito");
  assert.equal(getCustomerPackageSituation(packages[1]).kind, "waiting");
  assert.equal(getCustomerPackageSituation(packages[1]).label, "Aguardando estoque");
  assert.equal(getCustomerSplitSituation(packages), "Enviado parcialmente");
  assert.equal(getCustomerSplitBadgeStatus(packages, "paid", false), "enviado_parcial");
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
  ]);
  assert.equal(mixed, "Parte aguardando estoque");
});
