import assert from "node:assert/strict";
import test from "node:test";

import { applyGenericShipmentItemName, buildConsolidatedQuotePackage } from "./envioecom-package";
import {
  appendStatusHistory,
  classifyEnvioEcomTrackingGroup,
  hasEnvioEcomLabelReady,
  isOpenEnvioEcomTrackingStatus,
  isProvisionalBarcode,
  shouldMarkCompletedFromStatus,
  shouldMarkEnviadoFromStatus,
} from "./envioecom-status";

test("cotacao usa 1 pacote padrao 2x12x17 0.3kg R$5", () => {
  const packed = buildConsolidatedQuotePackage({
    products: [
      { name: "A", quantity: 3, price: 100 },
      { name: "B", quantity: 2, price: 50 },
    ],
    defaults: { weightKg: 0.3, lengthCm: 20, heightCm: 10, widthCm: 15 },
  });

  assert.equal(packed.product.quantity, 1);
  assert.equal(packed.product.price, 5);
  assert.equal(packed.product.weight, 0.3);
  assert.equal(packed.product.height, 2);
  assert.equal(packed.product.width, 12);
  assert.equal(packed.product.length, 17);
  assert.equal(packed.items.length, 2);
  assert.equal(packed.items.every((item) => item.name === ""), true);
});

test("create usa nome generico e nunca o catalogo", () => {
  const packed = buildConsolidatedQuotePackage({
    products: [
      { name: "Whey Isolado 900g", quantity: 2, price: 180 },
      { name: "Creatina", quantity: 1, price: 90 },
    ],
  });
  const items = applyGenericShipmentItemName(packed.items, "Suplementos", packed.declaredValue);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.name), ["Suplementos", "Suplementos"]);
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].unit_cost, 180);
  assert.equal(items[1].quantity, 1);
  assert.equal(items[1].unit_cost, 90);
  assert.equal(items.some((item) => /whey|creatina/i.test(item.name)), false);
});

test("create sem produtos usa 1 item generico com o subtotal", () => {
  const items = applyGenericShipmentItemName([], "  ", 49.9);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Mercadoria");
  assert.equal(items[0].quantity, 1);
  assert.equal(items[0].unit_cost, 49.9);
});

test("medidas reais no produto usam caixa e valor do pedido", () => {
  const packed = buildConsolidatedQuotePackage({
    products: [{ name: "Caro", quantity: 2, price: 900, weight: 1, height: 8, width: 20, length: 30 }],
  });
  assert.equal(packed.product.quantity, 1);
  assert.equal(packed.product.price, 1800);
  assert.equal(packed.product.weight, 2);
  assert.equal(packed.product.height, 8);
  assert.equal(packed.product.width, 20);
  assert.equal(packed.product.length, 30);
});

test("barcode EC e provisório", () => {
  assert.equal(isProvisionalBarcode("EC726384"), true);
  assert.equal(isProvisionalBarcode("888030869624681"), false);
  assert.equal(isProvisionalBarcode("AA123456789BR"), false);
});

test("etiqueta pronta nao marca enviado; coleta/postagem marca", () => {
  assert.equal(shouldMarkEnviadoFromStatus("Pronto para envio"), false);
  assert.equal(shouldMarkEnviadoFromStatus("DC-e emitida"), false);
  assert.equal(shouldMarkEnviadoFromStatus("Etiqueta emitida"), false);
  assert.equal(shouldMarkEnviadoFromStatus("Aguardando pagamento"), false);
  assert.equal(shouldMarkEnviadoFromStatus("Coletado"), true);
  assert.equal(shouldMarkEnviadoFromStatus("Postado"), true);
  assert.equal(shouldMarkEnviadoFromStatus("Em trânsito"), true);
  assert.equal(shouldMarkCompletedFromStatus("Entregue"), true);
  assert.equal(shouldMarkCompletedFromStatus("Cancelado"), false);
});

test("etiqueta pronta libera fila mesmo sem status de transito", () => {
  assert.equal(hasEnvioEcomLabelReady({ envioecomStatus: "Envio criado" }), false);
  assert.equal(hasEnvioEcomLabelReady({
    envioecomLabelUrl: "https://cdn.example/label.pdf",
    envioecomStatus: "Envio criado",
  }), true);
  assert.equal(hasEnvioEcomLabelReady({ envioecomStatus: "Etiqueta emitida" }), true);
  assert.equal(hasEnvioEcomLabelReady({ envioecomStatus: "DC-e emitida" }), true);
});

test("historico e idempotente no mesmo status+barcode", () => {
  const first = appendStatusHistory([], { at: "2026-08-13T12:00:00.000Z", status: "Postado", barcode: "8880" });
  const second = appendStatusHistory(first, { at: "2026-08-13T12:01:00.000Z", status: "Postado", barcode: "8880" });
  assert.equal(second.length, 1);
});

test("board classifica status em grupos de rastreio", () => {
  assert.equal(classifyEnvioEcomTrackingGroup("Entregue"), "delivered");
  assert.equal(classifyEnvioEcomTrackingGroup("Em trânsito"), "in_transit");
  assert.equal(classifyEnvioEcomTrackingGroup("DC-e emitida"), "awaiting");
  assert.equal(classifyEnvioEcomTrackingGroup("Pronto para envio"), "awaiting");
  assert.equal(classifyEnvioEcomTrackingGroup("Cancelado"), "cancelled");
  assert.equal(isOpenEnvioEcomTrackingStatus("Postado"), true);
  assert.equal(isOpenEnvioEcomTrackingStatus("Entregue"), false);
});
