import assert from "node:assert/strict";
import test from "node:test";

import {
  decideLabelStockWrite,
  getLabelStockSyncToken,
  inspectLabelStock,
  labelStockAuthStatus,
  labelStockCode,
  parseLabelStockResult,
  publishLabelProducts,
  readLabelStockCredential,
  type LabelStockSource,
} from "./label-stock-feed";

const yuryProducts = [
  { productId: "y-tg", productName: "TG Tirzepatida" },
  { productId: "y-reto", productName: "Retatrutida" },
];

function source(overrides: Partial<LabelStockSource> = {}): LabelStockSource {
  return {
    labelId: "pkg-1",
    orderNumber: 2401,
    customerName: "Ana",
    orderStatus: "paid",
    pool: "motoboy",
    reserved: false,
    waived: false,
    labelUrl: "https://labels.example/1.pdf",
    envioecomStatus: "Etiqueta gerada",
    barcode: "888031000015326",
    items: [{ productId: null, productName: "T.G Tirzepatida", quantity: 2 }],
    yuryProducts,
    ...overrides,
  };
}

test("lista só etiqueta pronta de Motoboy, Minas ou Santa Catarina", () => {
  const ready = inspectLabelStock(source()).published;
  assert.ok(ready);
  assert.equal(ready.warehouse, "motoboy");
  assert.equal(ready.orderNumber, 2401);
  assert.equal(ready.customerName, "Ana");
  assert.equal(ready.status, "Etiqueta gerada");
  assert.equal(ready.code, "888031000015326");
  assert.deepEqual(ready.products, [{ productId: "y-tg", name: "TG Tirzepatida", quantity: 2 }]);

  assert.equal(inspectLabelStock(source({ pool: "minas" })).published?.warehouse, "minas");
  assert.equal(inspectLabelStock(source({ pool: "santa_catarina" })).published?.warehouse, "santa_catarina");
  assert.equal(inspectLabelStock(source({ pool: "loja" })).published, null);
  assert.equal(inspectLabelStock(source({ pool: "sao paulo" })).published, null);
  assert.equal(inspectLabelStock(source({ pool: "motoboy", shippingType: "São Paulo" })).published?.warehouse, "motoboy");
});

test("cancelada, sem etiqueta, já baixada ou saída sem abater fica de fora", () => {
  assert.equal(inspectLabelStock(source({ orderStatus: "cancelled" })).published, null);
  assert.equal(inspectLabelStock(source({
    labelUrl: null,
    envioecomStatus: "Envio criado",
  })).published, null);
  assert.equal(inspectLabelStock(source({ envioecomStatus: "Cancelado" })).published, null);
  assert.equal(inspectLabelStock(source({ reserved: true })).published, null);
  assert.equal(inspectLabelStock(source({ exitedPools: "motoboy" })).published, null);
  assert.equal(inspectLabelStock(source({ waived: true })).published, null);
});

test("código provisório EC não entra; o productId sem par na Yury fica vazio", () => {
  assert.equal(labelStockCode({
    barcode: "EC12345",
    trackingKey: "BR123456789BR",
    manualCode: "AA123456789BR",
  }), "BR123456789BR");
  assert.deepEqual(publishLabelProducts([
    { productId: "y-reto", productName: "outro nome", quantity: 1 },
    { productId: null, productName: "Sem cadastro", quantity: 3 },
  ], yuryProducts), [
    { productId: "y-reto", name: "Retatrutida", quantity: 1 },
    { productId: null, name: "Sem cadastro", quantity: 3 },
  ]);
});

test("baixou_estoque e saiu_sem_abater não se substituem, e a baixa não chama o exit", () => {
  const open = inspectLabelStock(source());
  const debited = decideLabelStockWrite({
    closure: open.closure,
    published: open.published,
    result: "baixou_estoque",
  });
  assert.equal(debited.http, 200);
  assert.equal(debited.alreadyApplied, false);
  if (debited.http === 200 && !debited.alreadyApplied) {
    assert.equal(debited.callsYuryExit, false);
  }

  const again = decideLabelStockWrite({
    closure: "baixou_estoque",
    published: null,
    result: "baixou_estoque",
  });
  assert.deepEqual(again, { http: 200, alreadyApplied: true });

  const conflict = decideLabelStockWrite({
    closure: "baixou_estoque",
    published: null,
    result: "saiu_sem_abater",
  });
  assert.deepEqual(conflict, { http: 409, code: "RESULT_CONFLICT" });

  const missing = decideLabelStockWrite({
    closure: null,
    published: null,
    result: "saiu_sem_abater",
  });
  assert.deepEqual(missing, { http: 404, code: "LABEL_NOT_FOUND" });
  assert.equal(parseLabelStockResult("baixou_estoque"), "baixou_estoque");
  assert.equal(parseLabelStockResult("pedido"), null);
});

test("token da lista é o LABEL_STOCK_SYNC_TOKEN", () => {
  const prev = process.env.LABEL_STOCK_SYNC_TOKEN;
  delete process.env.LABEL_STOCK_SYNC_TOKEN;
  assert.equal(labelStockAuthStatus("x", getLabelStockSyncToken()), 503);
  process.env.LABEL_STOCK_SYNC_TOKEN = "segredo";
  assert.equal(labelStockAuthStatus("", getLabelStockSyncToken()), 401);
  assert.equal(labelStockAuthStatus("outro", getLabelStockSyncToken()), 401);
  assert.equal(labelStockAuthStatus("segredo", getLabelStockSyncToken()), 200);
  assert.equal(readLabelStockCredential("Bearer segredo", ""), "segredo");
  assert.equal(readLabelStockCredential("", "segredo"), "segredo");
  if (prev == null) delete process.env.LABEL_STOCK_SYNC_TOKEN;
  else process.env.LABEL_STOCK_SYNC_TOKEN = prev;
});
