import assert from "node:assert/strict";
import test from "node:test";

import {
  collectDeliveryHits,
  deliveryHintForCarrier,
  isDeliveredHintStatus,
  type CarrierDeliverySource,
} from "./carrier-delivery-hint";

const since = new Date("2026-04-26T12:00:00.000Z");
const recent = new Date("2026-10-12T15:00:00.000Z");
const older = new Date("2026-10-01T15:00:00.000Z");

function row(partial: Partial<CarrierDeliverySource> & Pick<CarrierDeliverySource, "orderId">): CarrierDeliverySource {
  return {
    carrierName: "J&T Express envioEcom",
    status: "Objeto entregue",
    deliveredAt: recent,
    orderNumber: 2401,
    cityName: "Vitória",
    state: "ES",
    packageCount: 0,
    fromPackage: false,
    ...partial,
  };
}

test("só conta status de entrega, sem devolução e sem não entregue", () => {
  assert.equal(isDeliveredHintStatus("Objeto entregue"), true);
  assert.equal(isDeliveredHintStatus("Em trânsito"), false);
  assert.equal(isDeliveredHintStatus("Devolvido ao remetente"), false);
  assert.equal(isDeliveredHintStatus("Não entregue"), false);
  assert.equal(isDeliveredHintStatus("Cancelado"), false);
});

test("a mesma cidade e a mesma transportadora citam o pedido mais recente", () => {
  const hits = collectDeliveryHits(
    { city: "Vitoria", state: "es" },
    "order-atual",
    since,
    [
      row({ orderId: "a", orderNumber: 2401, deliveredAt: older, cityName: "Vitoria" }),
      row({ orderId: "b", orderNumber: 2500, deliveredAt: recent, carrierName: "J&T Express" }),
      row({ orderId: "order-atual", orderNumber: 2561 }),
      row({ orderId: "c", cityName: "Vila Velha", orderNumber: 2600 }),
      row({ orderId: "d", carrierName: "Jadlog envioEcom", orderNumber: 2700 }),
      row({ orderId: "e", status: "Em trânsito", orderNumber: 2800 }),
      row({ orderId: "f", deliveredAt: new Date("2026-01-01T15:00:00.000Z"), orderNumber: 1000 }),
    ],
  );
  const hint = deliveryHintForCarrier("J&T Express envioEcom", hits);
  assert.equal(hint?.message, "Vitória/ES já recebeu pela J&T Express (pedido #2500, 12/10).");
  assert.equal(deliveryHintForCarrier("Jadlog envioEcom", hits)?.message, "Vitória/ES já recebeu pela Jadlog (pedido #2700, 12/10).");
  assert.equal(deliveryHintForCarrier("Correios Pac", hits), null);
});

test("pedido dividido entra pelo pacote e o pai fica de fora", () => {
  const hits = collectDeliveryHits(
    { city: "Vitória", state: "ES" },
    "",
    since,
    [
      row({ orderId: "split", fromPackage: false, packageCount: 2, carrierName: "Jadlog", orderNumber: 1 }),
      row({
        orderId: "split",
        fromPackage: true,
        packageCount: 2,
        carrierName: "J&T Express envioEcom",
        orderNumber: 3001,
      }),
      row({ orderId: "single", fromPackage: true, packageCount: 1, carrierName: "BUSLOG", orderNumber: 2 }),
      row({ orderId: "single", fromPackage: false, packageCount: 1, carrierName: "BUSLOG envioEcom", orderNumber: 3002 }),
    ],
  );
  assert.equal(
    deliveryHintForCarrier("J&T Express", hits)?.message,
    "Vitória/ES já recebeu pela J&T Express (pedido #3001, 12/10).",
  );
  assert.equal(deliveryHintForCarrier("Jadlog", hits), null);
  assert.match(deliveryHintForCarrier("BUSLOG envioEcom", hits)?.message || "", /pedido #3002/);
});
