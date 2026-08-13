import assert from "node:assert/strict";
import test from "node:test";

import { buildConsolidatedQuotePackage } from "./envioecom-package";
import {
  appendStatusHistory,
  isProvisionalBarcode,
  shouldMarkCompletedFromStatus,
  shouldMarkEnviadoFromStatus,
} from "./envioecom-status";

test("cotacao usa 1 pacote mesmo com varios itens", () => {
  const packed = buildConsolidatedQuotePackage({
    products: [
      { name: "A", quantity: 3, price: 100 },
      { name: "B", quantity: 2, price: 50 },
    ],
    defaults: { weightKg: 0.3, lengthCm: 20, heightCm: 10, widthCm: 15 },
  });

  assert.equal(packed.product.quantity, 1);
  assert.equal(packed.product.price, 400);
  assert.equal(packed.items.length, 2);
  assert.ok(packed.product.weight <= 30);
  assert.ok(packed.product.height <= 100);
});

test("valor declarado nao passa de 3000", () => {
  const packed = buildConsolidatedQuotePackage({
    products: [{ name: "Caro", quantity: 10, price: 900 }],
    defaults: { weightKg: 0.3, lengthCm: 20, heightCm: 10, widthCm: 15 },
  });
  assert.equal(packed.product.price, 3000);
});

test("barcode EC e provisório", () => {
  assert.equal(isProvisionalBarcode("EC726384"), true);
  assert.equal(isProvisionalBarcode("888030869624681"), false);
  assert.equal(isProvisionalBarcode("AA123456789BR"), false);
});

test("status de etiqueta pronta marca enviado", () => {
  assert.equal(shouldMarkEnviadoFromStatus("Pronto para envio"), true);
  assert.equal(shouldMarkEnviadoFromStatus("Aguardando pagamento"), false);
  assert.equal(shouldMarkCompletedFromStatus("Entregue"), true);
  assert.equal(shouldMarkCompletedFromStatus("Cancelado"), false);
});

test("historico e idempotente no mesmo status+barcode", () => {
  const first = appendStatusHistory([], { at: "2026-08-13T12:00:00.000Z", status: "Postado", barcode: "8880" });
  const second = appendStatusHistory(first, { at: "2026-08-13T12:01:00.000Z", status: "Postado", barcode: "8880" });
  assert.equal(second.length, 1);
});
