import assert from "node:assert/strict";
import test from "node:test";
import {
  filenameFromContentDisposition,
  inlinePdfContentDisposition,
  shipmentLabelPdfFilename,
  shipmentPoolLabel,
} from "./shipment-label-filename";

test("etiqueta usa o nome do cliente e o número do pedido", () => {
  assert.equal(
    shipmentLabelPdfFilename({ clientName: "Maria Silva", orderNumber: 2041 }),
    "Maria Silva 2041.pdf",
  );
});

test("nome vazio vira Cliente", () => {
  assert.equal(shipmentLabelPdfFilename({ clientName: "  ", orderNumber: null }), "Cliente.pdf");
});

test("acentos e barras não quebram o arquivo", () => {
  assert.equal(
    shipmentLabelPdfFilename({ clientName: "José/da Silva", orderNumber: 12 }),
    "José da Silva 12.pdf",
  );
});

test("split acrescenta o pool", () => {
  assert.equal(shipmentPoolLabel("loja"), "Fóz Guaçu");
  assert.equal(
    shipmentLabelPdfFilename({
      clientName: "Ana",
      orderNumber: 9,
      poolLabel: shipmentPoolLabel("motoboy"),
    }),
    "Ana 9 Motoboy.pdf",
  );
});

test("Content-Disposition fica em ASCII e o nome unicode volta no parse", () => {
  const header = inlinePdfContentDisposition("José Silva 12.pdf");
  assert.equal(/[^\x00-\x7F]/.test(header), false);
  assert.equal(filenameFromContentDisposition(header), "José Silva 12.pdf");
});
