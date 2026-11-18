import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, orderShipmentsTable, ordersTable } from "@workspace/db";
import { addOrderEvent } from "../lib/order-events";
import { parseOrderShipmentItems } from "../lib/order-shipments-logic";
import {
  decideLabelStockWrite,
  getLabelStockSyncToken,
  inspectLabelStock,
  labelStockAuthStatus,
  parseLabelStockResult,
  readLabelStockCredential,
  type LabelStockResult,
  type LabelStockSource,
  type PendingLabelStock,
} from "../lib/label-stock-feed";
import { listYuryInventoryBalances } from "../lib/yury-inventory-sync";
import {
  addKaInventoryExitedPool,
  serializeKaInventoryExitedPools,
  type YuryInventoryPool,
} from "../lib/yury-inventory";

const router: IRouter = Router();
const LIST_LIMIT = 1000;
const YURY_POOLS = ["motoboy", "minas", "santa_catarina"] as const;

function rejectAuth(authorization: unknown, apiKey: unknown): { status: 401 | 503; error: string } | null {
  const status = labelStockAuthStatus(
    readLabelStockCredential(authorization, apiKey),
    getLabelStockSyncToken(),
  );
  if (status === 503) return { status, error: "LABEL_STOCK_SYNC_DISABLED" };
  if (status === 401) return { status, error: "UNAUTHORIZED" };
  return null;
}

async function splitOrderIds(): Promise<Set<string>> {
  const rows = await db
    .select({ orderId: orderShipmentsTable.orderId })
    .from(orderShipmentsTable)
    .groupBy(orderShipmentsTable.orderId)
    .having(sql`count(*) >= 2`);
  return new Set(rows.map((row) => String(row.orderId)));
}

function compareLabels(a: PendingLabelStock, b: PendingLabelStock): number {
  const left = a.orderNumber ?? -1;
  const right = b.orderNumber ?? -1;
  if (left !== right) return right - left;
  return a.labelId.localeCompare(b.labelId);
}

router.get("/integrations/labels/pending-stock", async (req, res) => {
  const denied = rejectAuth(req.get("authorization"), req.get("x-api-key"));
  if (denied) {
    res.status(denied.status).json({ error: denied.error });
    return;
  }

  try {
    const [balances, splitIds] = await Promise.all([
      listYuryInventoryBalances(),
      splitOrderIds(),
    ]);
    const yuryProducts = balances.map((row) => ({
      productId: row.productId,
      productName: row.productName,
    }));

    const packageRows = await db
      .select({
        labelId: orderShipmentsTable.id,
        orderId: orderShipmentsTable.orderId,
        orderNumber: ordersTable.orderNumber,
        customerName: ordersTable.clientName,
        orderStatus: ordersTable.status,
        pool: orderShipmentsTable.inventoryPool,
        reserved: orderShipmentsTable.inventoryReserved,
        waivedAt: orderShipmentsTable.labelStockWaivedAt,
        labelUrl: orderShipmentsTable.envioecomLabelUrl,
        envioecomStatus: orderShipmentsTable.envioecomStatus,
        barcode: orderShipmentsTable.envioecomBarcode,
        trackingKey: orderShipmentsTable.envioecomTrackingKey,
        manualCode: orderShipmentsTable.manualTrackingCode,
        items: orderShipmentsTable.items,
      })
      .from(orderShipmentsTable)
      .innerJoin(ordersTable, eq(orderShipmentsTable.orderId, ordersTable.id))
      .where(and(
        inArray(orderShipmentsTable.inventoryPool, [...YURY_POOLS]),
        eq(orderShipmentsTable.inventoryReserved, false),
        isNull(orderShipmentsTable.labelStockWaivedAt),
        ne(ordersTable.status, "cancelled"),
      ));

    const orderRows = await db
      .select({
        id: ordersTable.id,
        orderNumber: ordersTable.orderNumber,
        customerName: ordersTable.clientName,
        orderStatus: ordersTable.status,
        shippingType: ordersTable.shippingType,
        motoboyDeliveryDate: ordersTable.motoboyDeliveryDate,
        motoboyDeliveryTime: ordersTable.motoboyDeliveryTime,
        inventoryExitPool: ordersTable.inventoryExitPool,
        inventoryExitedPools: ordersTable.inventoryExitedPools,
        reserved: ordersTable.inventoryReserved,
        waivedAt: ordersTable.labelStockWaivedAt,
        labelUrl: ordersTable.envioecomLabelUrl,
        envioecomStatus: ordersTable.envioecomStatus,
        barcode: ordersTable.envioecomBarcode,
        trackingCode: ordersTable.trackingCode,
        trackingKey: ordersTable.envioecomTrackingKey,
        manualCode: ordersTable.manualTrackingCode,
        products: ordersTable.products,
      })
      .from(ordersTable)
      .where(and(
        isNull(ordersTable.labelStockWaivedAt),
        ne(ordersTable.status, "cancelled"),
        or(
          inArray(ordersTable.inventoryExitPool, [...YURY_POOLS]),
          sql`LOWER(IFNULL(${ordersTable.shippingType}, '')) LIKE '%motoboy%'`,
          sql`LOWER(IFNULL(${ordersTable.shippingType}, '')) LIKE '%minas%'`,
          sql`LOWER(REPLACE(IFNULL(${ordersTable.shippingType}, ''), ' ', '')) LIKE '%santacatarina%'`,
          and(
            sql`${ordersTable.motoboyDeliveryDate} IS NOT NULL`,
            sql`${ordersTable.motoboyDeliveryTime} IS NOT NULL AND ${ordersTable.motoboyDeliveryTime} <> ''`,
          ),
        ),
      ));

    const labels: PendingLabelStock[] = [];
    for (const row of packageRows) {
      if (!splitIds.has(String(row.orderId))) continue;
      const published = inspectLabelStock({
        labelId: row.labelId,
        orderNumber: row.orderNumber,
        customerName: row.customerName,
        orderStatus: row.orderStatus,
        pool: row.pool,
        reserved: Boolean(row.reserved),
        waived: row.waivedAt != null,
        labelUrl: row.labelUrl,
        envioecomStatus: row.envioecomStatus,
        barcode: row.barcode,
        trackingKey: row.trackingKey,
        manualCode: row.manualCode,
        items: parseOrderShipmentItems(row.items),
        yuryProducts,
      }).published;
      if (published) labels.push(published);
    }

    for (const row of orderRows) {
      if (splitIds.has(row.id)) continue;
      const published = inspectLabelStock({
        labelId: row.id,
        orderNumber: row.orderNumber,
        customerName: row.customerName,
        orderStatus: row.orderStatus,
        pool: String(row.inventoryExitPool || "").trim(),
        shippingType: row.shippingType,
        motoboyDeliveryDate: row.motoboyDeliveryDate,
        motoboyDeliveryTime: row.motoboyDeliveryTime,
        inventoryExitPool: row.inventoryExitPool,
        exitedPools: row.inventoryExitedPools,
        reserved: Boolean(row.reserved),
        waived: row.waivedAt != null,
        labelUrl: row.labelUrl,
        envioecomStatus: row.envioecomStatus,
        barcode: row.barcode,
        trackingCode: row.trackingCode,
        trackingKey: row.trackingKey,
        manualCode: row.manualCode,
        items: parseOrderShipmentItems(row.products),
        yuryProducts,
      }).published;
      if (published) labels.push(published);
    }

    labels.sort(compareLabels);
    const truncated = labels.length > LIST_LIMIT;
    res.json({
      labels: truncated ? labels.slice(0, LIST_LIMIT) : labels,
      truncated,
    });
  } catch (err) {
    console.error("[LabelStock] lista falhou", err);
    res.status(500).json({ error: "LABEL_STOCK_LIST_FAILED" });
  }
});

router.post("/integrations/labels/:labelId/stock-result", async (req, res) => {
  const denied = rejectAuth(req.get("authorization"), req.get("x-api-key"));
  if (denied) {
    res.status(denied.status).json({ error: denied.error });
    return;
  }

  const result = parseLabelStockResult((req.body as { result?: unknown } | null)?.result);
  if (!result) {
    res.status(400).json({ error: "INVALID_RESULT" });
    return;
  }
  const labelId = String(req.params.labelId || "").trim();
  if (!labelId) {
    res.status(404).json({ error: "LABEL_NOT_FOUND" });
    return;
  }

  try {
    const [pkg] = await db
      .select({
        id: orderShipmentsTable.id,
        orderId: orderShipmentsTable.orderId,
        pool: orderShipmentsTable.inventoryPool,
        reserved: orderShipmentsTable.inventoryReserved,
        waivedAt: orderShipmentsTable.labelStockWaivedAt,
        labelUrl: orderShipmentsTable.envioecomLabelUrl,
        envioecomStatus: orderShipmentsTable.envioecomStatus,
        barcode: orderShipmentsTable.envioecomBarcode,
        trackingKey: orderShipmentsTable.envioecomTrackingKey,
        manualCode: orderShipmentsTable.manualTrackingCode,
        items: orderShipmentsTable.items,
      })
      .from(orderShipmentsTable)
      .where(eq(orderShipmentsTable.id, labelId))
      .limit(1);

    if (pkg) {
      const [order] = await db
        .select({
          id: ordersTable.id,
          orderNumber: ordersTable.orderNumber,
          customerName: ordersTable.clientName,
          orderStatus: ordersTable.status,
          tenantId: ordersTable.tenantId,
        })
        .from(ordersTable)
        .where(eq(ordersTable.id, pkg.orderId))
        .limit(1);
      if (!order) {
        res.status(404).json({ error: "LABEL_NOT_FOUND" });
        return;
      }
      const siblings = await db
        .select({ id: orderShipmentsTable.id })
        .from(orderShipmentsTable)
        .where(eq(orderShipmentsTable.orderId, order.id));
      if (siblings.length < 2) {
        res.status(404).json({ error: "LABEL_NOT_FOUND" });
        return;
      }
      const source: LabelStockSource = {
        labelId: pkg.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        orderStatus: order.orderStatus,
        pool: pkg.pool,
        reserved: Boolean(pkg.reserved),
        waived: pkg.waivedAt != null,
        labelUrl: pkg.labelUrl,
        envioecomStatus: pkg.envioecomStatus,
        barcode: pkg.barcode,
        trackingKey: pkg.trackingKey,
        manualCode: pkg.manualCode,
        items: parseOrderShipmentItems(pkg.items),
        yuryProducts: [],
      };
      await applyResult(res, {
        result,
        source,
        orderId: order.id,
        tenantId: order.tenantId,
        write: async () => {
          if (result === "baixou_estoque") {
            // A Yury já descontou. Não chamar POST /api/integrations/inventory/exit.
            await db.update(orderShipmentsTable)
              .set({ inventoryReserved: true, updatedAt: new Date() })
              .where(eq(orderShipmentsTable.id, pkg.id));
            return;
          }
          await db.update(orderShipmentsTable)
            .set({ labelStockWaivedAt: new Date(), updatedAt: new Date() })
            .where(eq(orderShipmentsTable.id, pkg.id));
        },
      });
      return;
    }

    const [order] = await db
      .select({
        id: ordersTable.id,
        orderNumber: ordersTable.orderNumber,
        customerName: ordersTable.clientName,
        orderStatus: ordersTable.status,
        tenantId: ordersTable.tenantId,
        shippingType: ordersTable.shippingType,
        motoboyDeliveryDate: ordersTable.motoboyDeliveryDate,
        motoboyDeliveryTime: ordersTable.motoboyDeliveryTime,
        inventoryExitPool: ordersTable.inventoryExitPool,
        inventoryExitedPools: ordersTable.inventoryExitedPools,
        reserved: ordersTable.inventoryReserved,
        waivedAt: ordersTable.labelStockWaivedAt,
        labelUrl: ordersTable.envioecomLabelUrl,
        envioecomStatus: ordersTable.envioecomStatus,
        barcode: ordersTable.envioecomBarcode,
        trackingCode: ordersTable.trackingCode,
        trackingKey: ordersTable.envioecomTrackingKey,
        manualCode: ordersTable.manualTrackingCode,
        products: ordersTable.products,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, labelId))
      .limit(1);
    if (!order) {
      res.status(404).json({ error: "LABEL_NOT_FOUND" });
      return;
    }
    const siblings = await db
      .select({ id: orderShipmentsTable.id })
      .from(orderShipmentsTable)
      .where(eq(orderShipmentsTable.orderId, order.id));
    if (siblings.length >= 2) {
      res.status(409).json({ error: "ORDER_SPLIT_USE_PACKAGE" });
      return;
    }
    const source: LabelStockSource = {
      labelId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      orderStatus: order.orderStatus,
      pool: String(order.inventoryExitPool || "").trim(),
      shippingType: order.shippingType,
      motoboyDeliveryDate: order.motoboyDeliveryDate,
      motoboyDeliveryTime: order.motoboyDeliveryTime,
      inventoryExitPool: order.inventoryExitPool,
      exitedPools: order.inventoryExitedPools,
      reserved: Boolean(order.reserved),
      waived: order.waivedAt != null,
      labelUrl: order.labelUrl,
      envioecomStatus: order.envioecomStatus,
      barcode: order.barcode,
      trackingCode: order.trackingCode,
      trackingKey: order.trackingKey,
      manualCode: order.manualCode,
      items: parseOrderShipmentItems(order.products),
      yuryProducts: [],
    };
    await applyResult(res, {
      result,
      source,
      orderId: order.id,
      tenantId: order.tenantId,
      write: async (warehouse) => {
        if (result === "baixou_estoque") {
          // A Yury já descontou. Não chamar POST /api/integrations/inventory/exit.
          const exited = addKaInventoryExitedPool(order.inventoryExitedPools, warehouse);
          await db.update(ordersTable)
            .set({
              inventoryExitPool: warehouse,
              inventoryExitedPools: serializeKaInventoryExitedPools(exited),
              updatedAt: new Date(),
            })
            .where(eq(ordersTable.id, order.id));
          return;
        }
        await db.update(ordersTable)
          .set({ labelStockWaivedAt: new Date(), updatedAt: new Date() })
          .where(eq(ordersTable.id, order.id));
      },
    });
  } catch (err) {
    console.error("[LabelStock] retorno falhou", err);
    res.status(500).json({ error: "LABEL_STOCK_RESULT_FAILED" });
  }
});

async function applyResult(
  res: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void },
  input: {
    result: LabelStockResult;
    source: LabelStockSource;
    orderId: string;
    tenantId: string | null;
    write: (warehouse: YuryInventoryPool) => Promise<void>;
  },
): Promise<void> {
  const inspected = inspectLabelStock(input.source);
  const decision = decideLabelStockWrite({
    closure: inspected.closure,
    published: inspected.published,
    result: input.result,
  });
  if (decision.http === 404 || decision.http === 409) {
    res.status(decision.http).json({ error: decision.code });
    return;
  }
  if (decision.alreadyApplied) {
    res.json({ ok: true, result: input.result, alreadyApplied: true });
    return;
  }
  const warehouse = inspected.warehouse;
  if (!warehouse) {
    res.status(404).json({ error: "LABEL_NOT_FOUND" });
    return;
  }
  await input.write(warehouse);
  await addOrderEvent({
    orderId: input.orderId,
    tenantId: input.tenantId,
    action: input.result === "baixou_estoque" ? "label_stock_exited" : "label_stock_waived",
    actorType: "webhook",
    actorUsername: "yury",
    payload: {
      labelId: input.source.labelId,
      result: input.result,
      warehouse,
    },
  });
  res.json({ ok: true, result: input.result, alreadyApplied: false });
}

export default router;
