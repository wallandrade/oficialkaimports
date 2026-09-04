import assert from "node:assert/strict";
import test from "node:test";

import { applyGenericShipmentItemName, buildConsolidatedQuotePackage, buildGenericShipmentItem } from "./envioecom-package";
import { formatEnvioEcomDetails } from "./envioecom-client";
import {
  appendStatusHistory,
  classifyEnvioEcomTrackingGroup,
  extractStatusHistoryFromShipment,
  hasEnvioEcomLabelReady,
  isEnvioEcomCancelledStatus,
  isLabelBlockedStatus,
  isOpenEnvioEcomTrackingStatus,
  isProvisionalBarcode,
  mergeEnvioEcomHistory,
  resolveStatusAfterLabelGenerated,
  shouldMarkCompletedFromStatus,
  shouldMarkEnviadoFromStatus,
} from "./envioecom-status";
import { parseEnvioEcomLinkRef } from "./envioecom-link-ref";

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

test("create usa 1 item generico com qty e valor do setting", () => {
  const packed = buildConsolidatedQuotePackage({
    products: [
      { name: "Whey Isolado 900g", quantity: 2, price: 180 },
      { name: "Creatina", quantity: 1, price: 90 },
    ],
  });
  const items = applyGenericShipmentItemName(packed.items, "Suplementos", packed.declaredValue, {
    quantity: 1,
    unitCost: 5,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Suplementos");
  assert.equal(items[0].quantity, 1);
  assert.equal(items[0].unit_cost, 5);
  assert.equal(items.some((item) => /whey|creatina/i.test(item.name)), false);
});

test("create sem produtos usa 1 item generico com o subtotal", () => {
  const items = applyGenericShipmentItemName([], "  ", 49.9);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Mercadoria");
  assert.equal(items[0].quantity, 1);
  assert.equal(items[0].unit_cost, 49.9);
});

test("create colapsa pedido com 10 produtos em 1 linha da etiqueta", () => {
  const packed = buildConsolidatedQuotePackage({
    products: Array.from({ length: 10 }, (_, i) => ({ name: `Peca ${i + 1}`, quantity: 1, price: 80 })),
  });
  const items = applyGenericShipmentItemName(packed.items, "Tela de celular", packed.declaredValue, {
    quantity: 1,
    unitCost: 25.5,
  });
  assert.equal(packed.items.length, 10);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Tela de celular");
  assert.equal(items[0].quantity, 1);
  assert.equal(items[0].unit_cost, 25.5);
});

test("DACE usa cost do valor global, nao o R$5 da cotacao", () => {
  const packed = buildConsolidatedQuotePackage({
    products: [{ name: "Peca", quantity: 10, price: 80 }],
  });
  const line = buildGenericShipmentItem({
    name: "Tela de celular",
    quantity: 1,
    unitCost: "89,9",
    fallbackUnitCost: packed.declaredValue,
  });
  assert.equal(packed.declaredValue, 5);
  assert.equal(line.items[0].name, "Tela de celular");
  assert.equal(line.items[0].quantity, 1);
  assert.equal(line.items[0].unit_cost, 89.9);
  assert.equal(line.declaredCost, 89.9);
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
  assert.equal(shouldMarkEnviadoFromStatus("Etiqueta gerada"), false);
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
  assert.equal(hasEnvioEcomLabelReady({ envioecomStatus: "Etiqueta gerada" }), true);
  assert.equal(hasEnvioEcomLabelReady({ envioecomStatus: "Aguardando coleta" }), true);
  assert.equal(hasEnvioEcomLabelReady({ envioecomStatus: "DC-e emitida" }), true);
  assert.equal(hasEnvioEcomLabelReady({
    envioecomLabelUrl: "https://cdn.example/label.pdf",
    envioecomStatus: "Cancelado",
  }), false);
  assert.equal(hasEnvioEcomLabelReady({
    envioecomLabelUrl: "https://cdn.example/label.pdf",
    envioecomStatus: "Aguardando cancelamento",
  }), false);
  assert.equal(hasEnvioEcomLabelReady({ envioecomStatus: "Cancelado" }), false);
  assert.equal(isLabelBlockedStatus("Aguardando cancelamento"), true);
  assert.equal(isLabelBlockedStatus("Etiqueta gerada"), false);
  assert.equal(isEnvioEcomCancelledStatus("Aguardando cancelamento"), true);
  assert.equal(isEnvioEcomCancelledStatus("Etiqueta gerada"), false);
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
  assert.equal(classifyEnvioEcomTrackingGroup("Etiqueta gerada"), "awaiting");
  assert.equal(classifyEnvioEcomTrackingGroup("Pronto para envio"), "awaiting");
  assert.equal(classifyEnvioEcomTrackingGroup("Cancelado"), "cancelled");
  assert.equal(classifyEnvioEcomTrackingGroup("Aguardando cancelamento"), "cancelled");
  assert.equal(isOpenEnvioEcomTrackingStatus("Postado"), true);
  assert.equal(isOpenEnvioEcomTrackingStatus("Entregue"), false);
});

test("parser junta cidade e unidade no evento de rastreio", () => {
  const events = extractStatusHistoryFromShipment({
    status_history: [
      {
        status: "Expedido - SN RAO",
        cidade: "Ribeirão Preto",
        description: "Expedido - SN RAO",
        updated_at: "2026-08-14T13:00:00.000Z",
      },
      {
        status: "Coletado",
        location: { cidade: "Ribeirão Preto", unidade: "SN RAO" },
        updated_at: "2026-08-14T12:00:00.000Z",
      },
    ],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].status, "Expedido - SN RAO");
  assert.equal(events[0].location, "Ribeirão Preto - SN RAO");
  assert.equal(events[0].description, null);
  assert.equal(events[1].location, "Ribeirão Preto - SN RAO");
});

test("parser le cidade em location.name e city_name", () => {
  const events = extractStatusHistoryFromShipment({
    status_history: [
      {
        status: "Saiu para Entrega",
        location: { name: "Mossoró - F MVF 02-RN" },
        updated_at: "2026-08-24T15:08:30.000Z",
      },
      {
        status: "Expedido - CE FOR",
        location: { city_name: "Fortaleza", unit: "CE FOR" },
        updated_at: "2026-08-22T20:29:26.000Z",
      },
      {
        status: "Recebido - F MVF 02-RN",
        municipio: "Mossoró",
        updated_at: "2026-08-24T05:56:29.000Z",
      },
    ],
  });
  assert.equal(events[0].location, "Mossoró - F MVF 02-RN");
  assert.equal(events[1].location, "Fortaleza - CE FOR");
  assert.equal(events[2].location, "Mossoró - F MVF 02-RN");
});

test("parser le cidade quando city vem como objeto", () => {
  const events = extractStatusHistoryFromShipment({
    data: {
      status_history: [
        {
          status: "Saiu para Entrega",
          location: { city: { name: "Mossoró" }, unit: "F MVF 02-RN" },
          updated_at: "2026-08-24T15:08:30.000Z",
        },
      ],
    },
  });
  assert.equal(events[0].location, "Mossoró - F MVF 02-RN");
});

test("historico com 2+ eventos substitui; 1 evento faz append", () => {
  const current = [
    { at: "2026-08-13T10:00:00.000Z", status: "Envio criado", location: null, description: null, barcode: "8880" },
  ];
  const replaced = mergeEnvioEcomHistory(current, [
    { at: "2026-08-14T12:00:00.000Z", status: "Coletado", location: "Ribeirão Preto - SN RAO", barcode: "8880" },
    { at: "2026-08-14T13:00:00.000Z", status: "Expedido - SN RAO", location: "Ribeirão Preto - SN RAO", barcode: "8880" },
  ]);
  assert.equal(replaced.length, 2);
  assert.equal(replaced[1].status, "Expedido - SN RAO");

  const appended = mergeEnvioEcomHistory(current, [
    { at: "2026-08-14T12:00:00.000Z", status: "Coletado", location: "Ribeirão Preto - SN RAO", barcode: "8880" },
  ]);
  assert.equal(appended.length, 2);
  assert.equal(appended[1].location, "Ribeirão Preto - SN RAO");
});

test("nao grava nota sintetica de consulta de rastreio", () => {
  const current = [
    { at: "2026-08-13T10:00:00.000Z", status: "Postado", location: null, description: null, barcode: "8880" },
  ];
  const merged = mergeEnvioEcomHistory(current, [], {
    at: "2026-08-14T12:00:00.000Z",
    status: "Postado",
    description: "Status atualizado ao consultar rastreio",
    barcode: "8880",
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].description, null);
});

test("gerar etiqueta promove Envio criado para Etiqueta emitida", () => {
  assert.equal(resolveStatusAfterLabelGenerated("Envio criado"), "Etiqueta emitida");
  assert.equal(resolveStatusAfterLabelGenerated(""), "Etiqueta emitida");
  assert.equal(resolveStatusAfterLabelGenerated("DC-e emitida"), "DC-e emitida");
  assert.equal(resolveStatusAfterLabelGenerated("Etiqueta gerada"), "Etiqueta gerada");
  assert.equal(resolveStatusAfterLabelGenerated("Coletado"), "Coletado");
  assert.equal(resolveStatusAfterLabelGenerated("Cancelado"), "Cancelado");
});

test("parseEnvioEcomLinkRef separa ID curto de rastreio", () => {
  assert.deepEqual(parseEnvioEcomLinkRef("726270"), { shipmentId: 726270 });
  assert.deepEqual(parseEnvioEcomLinkRef("888030877622416"), { barcode: "888030877622416" });
  assert.deepEqual(parseEnvioEcomLinkRef("EC12345"), { barcode: "EC12345" });
  assert.deepEqual(parseEnvioEcomLinkRef("  726270  "), { shipmentId: 726270 });
  assert.deepEqual(parseEnvioEcomLinkRef(""), {});
});

test("append preenche location vazia no mesmo status", () => {
  const first = appendStatusHistory([], { at: "2026-08-13T12:00:00.000Z", status: "Expedido - SN RAO", barcode: "8880" });
  const second = appendStatusHistory(first, {
    at: "2026-08-13T12:01:00.000Z",
    status: "Expedido - SN RAO",
    location: "Ribeirão Preto - SN RAO",
    barcode: "8880",
  });
  assert.equal(second.length, 1);
  assert.equal(second[0].location, "Ribeirão Preto - SN RAO");
});

test("erro EnvioEcom junta message e details", () => {
  assert.equal(
    formatEnvioEcomDetails({ document_number: ["CPF inválido"] }),
    "document_number: CPF inválido",
  );
  assert.equal(
    formatEnvioEcomDetails([{ field: "phone_number", message: "Telefone inválido" }]),
    "phone_number: Telefone inválido",
  );
});
