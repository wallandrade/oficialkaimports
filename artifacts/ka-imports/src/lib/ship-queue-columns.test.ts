import assert from "node:assert/strict";
import test from "node:test";

import {
  SHIP_QUEUE_COPY_HEADING,
  buildShipQueueCopyText,
  isMotoboyDashboardOrder,
  isWaitingDashboardShipment,
  splitShipQueueOrders,
  type ShipQueueColumnOrder,
} from "./ship-queue-columns";

function order(partial: ShipQueueColumnOrder & { id: string; clientName: string; orderNumber: number }): ShipQueueColumnOrder & {
  id: string;
  clientName: string;
  orderNumber: number;
} {
  return {
    status: "paid",
    enviado: false,
    shippingType: "PAC",
    shippingVia: null,
    ...partial,
  };
}

function block(row: { orderNumber: number; clientName: string }): string {
  return `PEDIDO #KA-${row.orderNumber}\n\nNome: ${row.clientName}`;
}

test("Envio Shopee fica na coluna da direita e o Copiar TXT de cada lado leva só a própria fila", () => {
  const ana = order({ id: "ana", clientName: "Ana Lima", orderNumber: 2801, shippingVia: null });
  const bruno = order({ id: "bruno", clientName: "Bruno Shopee", orderNumber: 2802, shippingVia: "Shopee" });
  const shipped = order({ id: "shipped", clientName: "Carla Enviada", orderNumber: 2803, shippingVia: "shopee", enviado: true });
  const labeled = order({
    id: "labeled",
    clientName: "Diego Etiqueta",
    orderNumber: 2804,
    shippingVia: null,
    envioecomLabelUrl: "https://cdn.example/etiqueta.pdf",
  });
  const motoboy = order({
    id: "moto",
    clientName: "Eva Motoboy",
    orderNumber: 2805,
    shippingType: "Motoboy",
    shippingVia: "shopee",
  });
  const reship = order({
    id: "reship",
    clientName: "Fabio Reenvio",
    orderNumber: 2806,
    status: "completed",
    enviado: true,
    shippingVia: "shopee",
    reshipment: { id: "rs-1", status: "reenvio_pronto_para_envio" },
  });

  const rows = [ana, bruno, shipped, labeled, motoboy, reship];
  const visibleNormal = rows.filter((row) => isWaitingDashboardShipment(row) && !isMotoboyDashboardOrder(row));
  const split = splitShipQueueOrders(visibleNormal);

  assert.deepEqual(split.normal.map((row) => row.id), ["ana"]);
  assert.deepEqual(split.shopee.map((row) => row.id), ["bruno", "reship"]);
  assert.equal(split.normal.some((row) => row.id === "bruno" || row.id === "shipped" || row.id === "labeled" || row.id === "moto"), false);
  assert.equal(split.shopee.some((row) => row.id === "ana" || row.id === "shipped" || row.id === "labeled" || row.id === "moto"), false);
  assert.equal(isMotoboyDashboardOrder(motoboy), true);
  assert.equal(isWaitingDashboardShipment(shipped), false);
  assert.equal(isWaitingDashboardShipment(labeled), false);

  const left = buildShipQueueCopyText({
    heading: SHIP_QUEUE_COPY_HEADING.normal,
    blocks: split.normal.map(block),
  });
  const right = buildShipQueueCopyText({
    heading: SHIP_QUEUE_COPY_HEADING.shopee,
    storeLabel: "Filial Centro",
    blocks: split.shopee.map(block),
  });

  assert.equal(left, [
    "PEDIDOS PARA ENVIAR: 1",
    "",
    "PEDIDO #KA-2801",
    "",
    "Nome: Ana Lima",
  ].join("\n"));
  assert.equal(left.includes("Bruno Shopee"), false);
  assert.equal(left.includes("Eva Motoboy"), false);
  assert.equal(right.startsWith("Loja: Filial Centro\nENVIO SHOPEE: 2\n\n"), true);
  assert.equal(right.includes("Nome: Bruno Shopee"), true);
  assert.equal(right.includes("Nome: Fabio Reenvio"), true);
  assert.equal(right.includes("Nome: Ana Lima"), false);
  assert.equal(right.includes("PEDIDO #KA-2803"), false);
  assert.equal(right.includes("PEDIDO #KA-2804"), false);
});
