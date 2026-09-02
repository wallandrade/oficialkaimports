import { db, inventoryBalancesTable, inventoryMovementsTable, motoboyDeliveryReservationsTable, ordersTable, productsTable } from "@workspace/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { registerInventoryEntry } from "./reshipments";
import { completeOrderLogistics } from "./order-logistics";
import { broadcastNotification } from "../routes/notifications";
import { clearOrderManualPriority } from "./order-priority";
import {
  addKaInventoryExitedPool,
  defaultKaInventoryExitPool,
  parseKaInventoryExitedPools,
  serializeKaInventoryExitedPools,
  type KaInventoryExitPool,
} from "./yury-inventory";
import { debitYuryInventoryForKaOrder, YuryInventoryExitError } from "./yury-inventory-exit";

function buildOrderTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

function buildInventoryBalanceTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(
      eq(inventoryBalancesTable.tenantId, tenantId),
      isNull(inventoryBalancesTable.tenantId),
      eq(inventoryBalancesTable.tenantId, ""),
    );
  }
  return eq(inventoryBalancesTable.tenantId, tenantId);
}

function parseOrderItemsForInventory(raw: unknown): Array<{ productId: string | null; productName: string; quantity: number }> {
  const parsed = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const value = JSON.parse(raw);
            return Array.isArray(value) ? value : [];
          } catch {
            return [];
          }
        })()
      : [];

  const items = parsed
    .map((item) => {
      const row = item as { id?: unknown; name?: unknown; quantity?: unknown };
      return {
        productId: String(row?.id || "").trim() || null,
        productName: String(row?.name || "Produto").trim() || "Produto",
        quantity: Number(row?.quantity || 0),
      };
    })
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);

  const grouped = new Map<string, { productId: string | null; productName: string; quantity: number }>();
  for (const item of items) {
    const key = item.productId ? `id:${item.productId}` : `name:${item.productName.toLowerCase()}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      productId: prev?.productId || item.productId,
      productName: prev?.productName || item.productName,
      quantity: (prev?.quantity || 0) + item.quantity,
    });
  }
  return [...grouped.values()];
}

export class OrderEnviadoError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OrderEnviadoError";
    this.code = code;
  }
}

async function persistInventoryExitState(
  orderId: string,
  tenantId: string,
  pool: KaInventoryExitPool,
  exitedPools: KaInventoryExitPool[],
): Promise<void> {
  await db.update(ordersTable)
    .set({
      inventoryExitPool: pool,
      inventoryExitedPools: serializeKaInventoryExitedPools(exitedPools),
      updatedAt: new Date(),
    })
    .where(and(eq(ordersTable.id, orderId), buildOrderTenantWhere(tenantId)));
}

async function hasLegacyFozExit(orderId: string): Promise<boolean> {
  const rows = await db
    .select({
      type: inventoryMovementsTable.type,
      reason: inventoryMovementsTable.reason,
      quantity: inventoryMovementsTable.quantity,
    })
    .from(inventoryMovementsTable)
    .where(eq(inventoryMovementsTable.referenceId, orderId));
  return rows.some((row) => {
    const type = String(row.type || "").trim().toLowerCase();
    const reason = String(row.reason || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    const qty = Number(row.quantity) || 0;
    return type === "exit" && qty < 0 && reason.startsWith("saida por envio do pedido");
  });
}

async function debitFozForOrder(input: {
  orderId: string;
  tenantId: string;
  clientName: string | null;
  items: Array<{ productId: string | null; productName: string; quantity: number }>;
}): Promise<void> {
  const missingIds = input.items.filter((item) => !item.productId);
  let resolvedItems = input.items;
  if (missingIds.length > 0) {
    const productRows = await db.select({ id: productsTable.id, name: productsTable.name }).from(productsTable);
    const productIdByName = new Map(productRows.map((row) => [String(row.name || "").trim().toLowerCase(), row.id] as const));
    resolvedItems = input.items.map((item) => {
      if (item.productId) return item;
      return { ...item, productId: productIdByName.get(item.productName.trim().toLowerCase()) || null };
    });
  }

  const stillMissingIds = resolvedItems.filter((item) => !item.productId);
  if (stillMissingIds.length > 0) {
    throw new OrderEnviadoError(
      "INVENTORY_PRODUCT_MAPPING_ERROR",
      `Não foi possível mapear os produtos no estoque: ${stillMissingIds.map((item) => item.productName).join(", ")}.`,
    );
  }

  const productIds = resolvedItems.map((item) => item.productId!).filter(Boolean);
  const balanceRows = productIds.length > 0
    ? await db
        .select({ productId: inventoryBalancesTable.productId, quantity: inventoryBalancesTable.quantity })
        .from(inventoryBalancesTable)
        .where(and(buildInventoryBalanceTenantWhere(input.tenantId), inArray(inventoryBalancesTable.productId, productIds)))
    : [];

  const stockByProduct = new Map<string, number>();
  for (const row of balanceRows as Array<{ productId: string; quantity: number }>) {
    stockByProduct.set(String(row.productId), Number(row.quantity) || 0);
  }

  const insufficient = resolvedItems.filter((item) => (stockByProduct.get(item.productId!) || 0) < item.quantity);
  if (insufficient.length > 0) {
    const details = insufficient
      .map((item) => `${item.productName} (precisa ${item.quantity}, disponível ${stockByProduct.get(item.productId!) || 0})`)
      .join("; ");
    throw new OrderEnviadoError("INSUFFICIENT_STOCK", `Estoque insuficiente para envio: ${details}.`);
  }

  for (const item of resolvedItems) {
    await registerInventoryEntry({
      tenantId: input.tenantId,
      productId: item.productId!,
      quantity: -item.quantity,
      reason: `Saída por envio do pedido ${input.orderId}`,
      referenceId: input.orderId,
      clientName: input.clientName,
    });
  }
}

export async function debitOrderInventoryPool(input: {
  orderId: string;
  tenantId: string;
  pool: KaInventoryExitPool;
}): Promise<{ alreadyDebited: boolean; pool: KaInventoryExitPool; exitedPools: KaInventoryExitPool[] }> {
  const rows = await db
    .select({
      id: ordersTable.id,
      products: ordersTable.products,
      clientName: ordersTable.clientName,
      inventoryExitPool: ordersTable.inventoryExitPool,
      inventoryExitedPools: ordersTable.inventoryExitedPools,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, input.orderId), buildOrderTenantWhere(input.tenantId)))
    .limit(1);

  const order = rows[0];
  if (!order) throw new OrderEnviadoError("NOT_FOUND", "Pedido não encontrado.");

  let exitedPools = parseKaInventoryExitedPools(order.inventoryExitedPools);
  if (input.pool === "loja" && !exitedPools.includes("loja") && await hasLegacyFozExit(order.id)) {
    exitedPools = addKaInventoryExitedPool(exitedPools, "loja");
  }

  if (exitedPools.includes(input.pool)) {
    await persistInventoryExitState(order.id, input.tenantId, input.pool, exitedPools);
    return { alreadyDebited: true, pool: input.pool, exitedPools };
  }

  const orderItems = parseOrderItemsForInventory(order.products);
  if (orderItems.length > 0) {
    if (input.pool === "loja") {
      await debitFozForOrder({
        orderId: order.id,
        tenantId: input.tenantId,
        clientName: order.clientName || null,
        items: orderItems,
      });
    } else {
      try {
        await debitYuryInventoryForKaOrder({
          referenceId: order.id,
          pool: input.pool,
          items: orderItems,
        });
      } catch (error) {
        if (error instanceof YuryInventoryExitError) {
          throw new OrderEnviadoError(error.code, error.message);
        }
        throw error;
      }
    }
  }

  exitedPools = addKaInventoryExitedPool(exitedPools, input.pool);
  await persistInventoryExitState(order.id, input.tenantId, input.pool, exitedPools);
  return { alreadyDebited: false, pool: input.pool, exitedPools };
}

export async function ensureOrderMarkedEnviado(orderId: string, tenantId: string): Promise<{ enviado: boolean; already: boolean }> {
  const rows = await db
    .select({
      id: ordersTable.id,
      products: ordersTable.products,
      clientName: ordersTable.clientName,
      enviado: ordersTable.enviado,
      shippingType: ordersTable.shippingType,
      motoboyDeliveryDate: ordersTable.motoboyDeliveryDate,
      motoboyDeliveryTime: ordersTable.motoboyDeliveryTime,
      inventoryExitPool: ordersTable.inventoryExitPool,
      inventoryExitedPools: ordersTable.inventoryExitedPools,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), buildOrderTenantWhere(tenantId)))
    .limit(1);

  const order = rows[0];
  if (!order) throw new OrderEnviadoError("NOT_FOUND", "Pedido não encontrado.");
  if (order.enviado) {
    await clearOrderManualPriority(orderId);
    return { enviado: true, already: true };
  }

  const orderItems = parseOrderItemsForInventory(order.products);
  if (orderItems.length > 0) {
    await debitOrderInventoryPool({
      orderId,
      tenantId,
      pool: defaultKaInventoryExitPool(order),
    });
  }

  await db.update(ordersTable)
    .set({ enviado: true, updatedAt: new Date() })
    .where(and(eq(ordersTable.id, orderId), buildOrderTenantWhere(tenantId)));
  await clearOrderManualPriority(orderId);

  await db.delete(motoboyDeliveryReservationsTable).where(and(
    eq(motoboyDeliveryReservationsTable.orderId, orderId),
    eq(motoboyDeliveryReservationsTable.tenantId, tenantId),
  ));
  await completeOrderLogistics(orderId, tenantId);
  broadcastNotification({ type: "order_enviado_updated", data: { id: orderId, enviado: true, tenantId } });
  return { enviado: true, already: false };
}

export { parseOrderItemsForInventory };
