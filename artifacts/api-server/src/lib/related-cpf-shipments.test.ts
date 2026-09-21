import assert from "node:assert/strict";
import test from "node:test";

import {
  collectRelatedCpfShipments,
  emptyRelatedCpfShipmentsResult,
  hasUsableRelatedEnvioEcomShipment,
  parseRelatedCpfDigits,
  prettyRelatedAccountName,
} from "./related-cpf-shipments";

const now = new Date("2026-09-21T15:00:00.000Z");

test("CPF só vale com 11 dígitos", () => {
  assert.equal(parseRelatedCpfDigits("050.405.766-92"), "05040576692");
  assert.equal(parseRelatedCpfDigits("123"), null);
  assert.equal(parseRelatedCpfDigits(""), null);
});

test("conta env vira São Paulo", () => {
  assert.equal(prettyRelatedAccountName("env"), "São Paulo");
  assert.equal(prettyRelatedAccountName("tenant"), "Conta da loja");
  assert.equal(prettyRelatedAccountName("minas", { minas: "Minas" }), "Minas");
});

test("ignora cancelado e barcode provisório", () => {
  assert.equal(hasUsableRelatedEnvioEcomShipment({
    envioecomShipmentId: 99,
    envioecomStatus: "Cancelado",
  }), false);
  assert.equal(hasUsableRelatedEnvioEcomShipment({
    envioecomBarcode: "EC12345",
  }), false);
  assert.equal(hasUsableRelatedEnvioEcomShipment({
    envioecomBarcode: "AM123456BR",
  }), true);
});

test("lista envios do mesmo CPF e não alerta reenvio", () => {
  const result = collectRelatedCpfShipments({
    currentOrderId: "child",
    currentParentOrderId: "parent",
    currentProducts: [{ id: "sku-a", name: "JBL", quantity: 1 }],
    now,
    siblings: [
      {
        id: "parent",
        orderNumber: 2230,
        createdAt: "2026-09-18T12:00:00.000Z",
        envioecomBarcode: "AM111",
        envioecomStatus: "Em trânsito",
        envioecomStatusUpdatedAt: "2026-09-18T12:00:00.000Z",
        products: [{ id: "sku-a", name: "JBL", quantity: 1 }],
      },
    ],
  });
  assert.equal(result.shipments.length, 1);
  assert.equal(result.shipments[0].isReshipRelated, true);
  assert.equal(result.warningLevel, "none");
  assert.equal(result.sameProductCount, 0);
});

test("mesmo produto recente gera alerta forte", () => {
  const result = collectRelatedCpfShipments({
    currentOrderId: "order-b",
    currentProducts: [{ id: "sku-a", name: "JBL Tune", quantity: 1 }],
    now,
    siblings: [
      {
        id: "order-a",
        orderNumber: 2230,
        createdAt: "2026-09-18T12:00:00.000Z",
        envioecomShipmentId: 726270,
        envioecomBarcode: "AM123456BR",
        envioecomStatus: "Em trânsito",
        envioecomStatusUpdatedAt: "2026-09-18T12:00:00.000Z",
        envioecomAccountId: "env",
        products: [{ id: "sku-a", name: "JBL Tune", quantity: 1 }],
      },
    ],
  });
  assert.equal(result.warningLevel, "same_product");
  assert.equal(result.recentCount, 1);
  assert.equal(result.sameProductCount, 1);
  assert.equal(result.shipments[0].barcode, "AM123456BR");
  assert.equal(result.shipments[0].accountName, "São Paulo");
});

test("produto diferente recente gera alerta amarelo", () => {
  const result = collectRelatedCpfShipments({
    currentOrderId: "order-b",
    currentProducts: [{ id: "sku-b", name: "Capinha", quantity: 1 }],
    now,
    siblings: [
      {
        id: "order-a",
        orderNumber: 2218,
        createdAt: "2026-09-12T12:00:00.000Z",
        envioecomBarcode: "BR987",
        envioecomStatus: "Entregue",
        envioecomStatusUpdatedAt: "2026-09-12T12:00:00.000Z",
        products: [{ id: "sku-a", name: "JBL Tune", quantity: 1 }],
      },
    ],
  });
  assert.equal(result.warningLevel, "recent");
  assert.equal(result.shipments[0].sameProduct, false);
});

test("envio antigo não alerta mesmo com o mesmo produto", () => {
  const result = collectRelatedCpfShipments({
    currentOrderId: "order-b",
    currentProducts: [{ id: "sku-a", name: "JBL", quantity: 1 }],
    now,
    siblings: [
      {
        id: "order-a",
        orderNumber: 1800,
        createdAt: "2026-08-01T12:00:00.000Z",
        envioecomBarcode: "OLD123",
        envioecomStatus: "Entregue",
        envioecomStatusUpdatedAt: "2026-08-01T12:00:00.000Z",
        products: [{ id: "sku-a", name: "JBL", quantity: 1 }],
      },
    ],
  });
  assert.equal(result.warningLevel, "none");
  assert.equal(result.shipments.length, 1);
});

test("split emite um rastreio por pacote e ignora o pedido atual", () => {
  const result = collectRelatedCpfShipments({
    currentOrderId: "current",
    currentProducts: [{ id: "sku-a", name: "A", quantity: 1 }],
    now,
    siblings: [
      { id: "current", envioecomBarcode: "SELF", products: [{ id: "sku-a", name: "A", quantity: 1 }] },
      {
        id: "split",
        orderNumber: 2100,
        createdAt: "2026-09-19T12:00:00.000Z",
        products: [{ id: "sku-a", name: "A", quantity: 1 }, { id: "sku-b", name: "B", quantity: 1 }],
        packages: [
          {
            id: "p1",
            inventoryPool: "loja",
            items: [{ id: "sku-a", name: "A", quantity: 1 }],
            envioecomBarcode: "FOZ123",
            envioecomStatus: "Em trânsito",
            envioecomStatusUpdatedAt: "2026-09-19T12:00:00.000Z",
          },
          {
            id: "p2",
            inventoryPool: "minas",
            items: [{ id: "sku-b", name: "B", quantity: 1 }],
            envioecomBarcode: "MG456",
            envioecomStatus: "Etiqueta gerada",
            envioecomStatusUpdatedAt: "2026-09-20T12:00:00.000Z",
          },
          {
            id: "p3",
            inventoryPool: "motoboy",
            items: [{ id: "sku-c", name: "C", quantity: 1 }],
            envioecomStatus: "Cancelado",
            envioecomBarcode: "CANCEL",
          },
        ],
      },
    ],
  });
  assert.equal(result.shipments.length, 2);
  assert.deepEqual(result.shipments.map((row) => row.barcode), ["MG456", "FOZ123"]);
  assert.equal(result.warningLevel, "same_product");
});

test("rastreio 8880 só no trackingCode entra na lista", () => {
  const result = collectRelatedCpfShipments({
    currentOrderId: "order-b",
    currentProducts: [{ id: "sku-a", name: "JBL", quantity: 1 }],
    now,
    siblings: [
      {
        id: "order-a",
        orderNumber: 1990,
        createdAt: "2026-09-10T12:00:00.000Z",
        trackingCode: "888030914282340",
        products: [{ id: "sku-a", name: "JBL", quantity: 1 }],
      },
    ],
  });
  assert.equal(result.shipments.length, 1);
  assert.equal(result.shipments[0].barcode, "888030914282340");
  assert.equal(result.shipments[0].hasEnvioEcom, true);
});

test("pedido pago sem rastreio ainda aparece, sem alerta", () => {
  const result = collectRelatedCpfShipments({
    currentOrderId: "order-b",
    currentProducts: [{ id: "sku-b", name: "Capinha", quantity: 1 }],
    now,
    siblings: [
      {
        id: "order-a",
        orderNumber: 1801,
        createdAt: "2026-09-08T12:00:00.000Z",
        enviado: false,
        products: [{ id: "sku-a", name: "JBL", quantity: 1 }],
      },
    ],
  });
  assert.equal(result.shipments.length, 1);
  assert.equal(result.shipments[0].barcode, null);
  assert.equal(result.shipments[0].hasEnvioEcom, false);
  assert.equal(result.warningLevel, "none");
});

test("enviado sem barcode entra na lista e não alerta", () => {
  const result = collectRelatedCpfShipments({
    currentOrderId: "order-b",
    now,
    siblings: [
      {
        id: "order-a",
        orderNumber: 1700,
        createdAt: "2026-09-15T12:00:00.000Z",
        enviado: true,
        products: [{ id: "sku-a", name: "JBL", quantity: 1 }],
      },
    ],
  });
  assert.equal(result.shipments.length, 1);
  assert.equal(result.warningLevel, "none");
});

test("resultado vazio tem warning none", () => {
  const empty = emptyRelatedCpfShipmentsResult("05040576692");
  assert.equal(empty.warningLevel, "none");
  assert.equal(empty.cpf, "05040576692");
  assert.equal(empty.recentDays, 14);
});
