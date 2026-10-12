import assert from "node:assert/strict";
import test from "node:test";
import { shipmentLabelPdfFilename } from "./shipment-label-filename";

test("download da etiqueta começa pelo nome do cliente", () => {
  assert.equal(
    shipmentLabelPdfFilename({ clientName: "Maria Silva", orderNumber: 2041 }),
    "Maria Silva 2041.pdf",
  );
  assert.equal(
    shipmentLabelPdfFilename({ clientName: "Ana", orderNumber: 9, poolLabel: "Motoboy" }),
    "Ana 9 Motoboy.pdf",
  );
});
