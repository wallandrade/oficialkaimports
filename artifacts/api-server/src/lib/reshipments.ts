import crypto from "crypto";
import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  inventoryBalancesTable,
  inventoryMovementsTable,
  manualReshipmentsTable,
  ordersTable,
  productsTable,
  reshipmentsTable,
} from "@workspace/db";

export type ReshipmentStatus =
  | "reenvio_aguardando_estoque"
  | "reenvio_pronto_para_envio"
  | "reenvio_enviado";

type OrderProductInput = {
  id?: string;
  name?: string;
  quantity?: number;
};

type ReshipmentProduct = {
  id: string;
  name: string;
  quantity: number;
};

export type ReshipmentSource = "support" | "manual";

function toProducts(raw: unknown): ReshipmentProduct[] {
  const list = Array.isArray(raw)
    ? (raw as OrderProductInput[])
    : typeof raw === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as OrderProductInput[]) : [];
          } catch {
            return [];
          }
        })()
      : [];

  return list
    .map((item) => ({
      id: String(item?.id || "").trim(),
      name: String(item?.name || "Produto").trim() || "Produto",
      quantity: Number(item?.quantity) || 0,
    }))
    .filter((item) => item.id && item.quantity > 0);
}

async function getStockMap(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ productId: inventoryBalancesTable.productId, quantity: inventoryBalancesTable.quantity })
    .from(inventoryBalancesTable)
    .where(inArray(inventoryBalancesTable.productId, productIds));

  return new Map(rows.map((row) => [row.productId, Number(row.quantity) || 0]));
}

function hasEnoughStock(items: ReshipmentProduct[], stockByProduct: Map<string, number>): boolean {
  return items.every((item) => (stockByProduct.get(item.id) || 0) >= item.quantity);
}

async function changeBalance(productId: string, delta: number): Promise<void> {
  const currentRows = await db
    .select({ quantity: inventoryBalancesTable.quantity })
    .from(inventoryBalancesTable)
    .where(eq(inventoryBalancesTable.productId, productId))
    .limit(1);

  const current = Number(currentRows[0]?.quantity || 0);
  const next = Math.max(0, current + delta);

  if (!currentRows[0]) {
    await db.insert(inventoryBalancesTable).values({
      productId,
      quantity: next,
      updatedAt: new Date(),
    });
    return;
  }

  await db
    .update(inventoryBalancesTable)
    .set({ quantity: next, updatedAt: new Date() })
    .where(eq(inventoryBalancesTable.productId, productId));
}

async function reserveForReshipment(reshipmentId: string, items: ReshipmentProduct[]): Promise<void> {
  for (const item of items) {
    await changeBalance(item.id, -item.quantity);
    await db.insert(inventoryMovementsTable).values({
      id: crypto.randomBytes(8).toString("hex"),
      productId: item.id,
      type: "reservation",
      quantity: -item.quantity,
      reason: `Reserva para reenvio ${reshipmentId}`,
      referenceId: reshipmentId,
      createdAt: new Date(),
    });
  }
}

export async function createOrRefreshReshipment(params: {
  orderId: string;
  supportTicketId: string;
  productsRaw: unknown;
  resolvedReason?: string;
}): Promise<{ id: string; status: ReshipmentStatus; missingProducts: string[] }> {
  const items = toProducts(params.productsRaw);
  const id = crypto.randomBytes(8).toString("hex");

  if (items.length === 0) {
    throw new Error("Pedido não possui itens válidos para reenvio.");
  }

  const productIds = Array.from(new Set(items.map((item) => item.id)));

  const existingProductRows = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(inArray(productsTable.id, productIds));

  const existingProductIds = new Set(existingProductRows.map((row) => row.id));
  const validItems = items.filter((item) => existingProductIds.has(item.id));

  if (validItems.length === 0) {
    throw new Error("Itens do pedido não existem no catálogo de produtos.");
  }

  const validProductIds = Array.from(new Set(validItems.map((item) => item.id)));
  const stockByProduct = await getStockMap(validProductIds);
  const enoughNow = hasEnoughStock(validItems, stockByProduct);
  const nextStatus: ReshipmentStatus = enoughNow ? "reenvio_pronto_para_envio" : "reenvio_aguardando_estoque";

  const existingRows = await db
    .select({ id: reshipmentsTable.id, status: reshipmentsTable.status })
    .from(reshipmentsTable)
    .where(eq(reshipmentsTable.orderId, params.orderId))
    .limit(1);

  const reshipmentId = existingRows[0]?.id || id;

  if (existingRows[0]) {
    await db
      .update(reshipmentsTable)
      .set({
        supportTicketId: params.supportTicketId,
        status: nextStatus,
        productsSnapshot: validItems,
        resolvedReason: params.resolvedReason || null,
        authorizedAt: new Date(),
        sentAt: null,
        updatedAt: new Date(),
      })
      .where(eq(reshipmentsTable.id, reshipmentId));
  } else {
    await db.insert(reshipmentsTable).values({
      id: reshipmentId,
      orderId: params.orderId,
      supportTicketId: params.supportTicketId,
      status: nextStatus,
      productsSnapshot: validItems,
      resolvedReason: params.resolvedReason || null,
      authorizedAt: new Date(),
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const alreadyReserved = existingRows[0]?.status === "reenvio_pronto_para_envio";
  if (enoughNow && !alreadyReserved) {
    await reserveForReshipment(reshipmentId, validItems);
  }

  const missingProducts = validItems
    .filter((item) => (stockByProduct.get(item.id) || 0) < item.quantity)
    .map((item) => item.name);

  return {
    id: reshipmentId,
    status: nextStatus,
    missingProducts,
  };
}

export async function releasePendingReshipments(): Promise<number> {
  const pendingRows = await db
    .select({
      id: reshipmentsTable.id,
      productsSnapshot: reshipmentsTable.productsSnapshot,
      createdAt: reshipmentsTable.createdAt,
    })
    .from(reshipmentsTable)
    .where(eq(reshipmentsTable.status, "reenvio_aguardando_estoque"))
    .orderBy(asc(reshipmentsTable.createdAt));

  const pendingManualRows = await db
    .select({
      id: manualReshipmentsTable.id,
      productsSnapshot: manualReshipmentsTable.productsSnapshot,
      createdAt: manualReshipmentsTable.createdAt,
    })
    .from(manualReshipmentsTable)
    .where(eq(manualReshipmentsTable.status, "reenvio_aguardando_estoque"))
    .orderBy(asc(manualReshipmentsTable.createdAt));

  let released = 0;

  for (const row of pendingRows) {
    const items = toProducts(row.productsSnapshot);
    if (items.length === 0) continue;

    const productIds = Array.from(new Set(items.map((item) => item.id)));
    const stockByProduct = await getStockMap(productIds);
    const canRelease = hasEnoughStock(items, stockByProduct);

    if (!canRelease) continue;

    await reserveForReshipment(row.id, items);
    await db
      .update(reshipmentsTable)
      .set({ status: "reenvio_pronto_para_envio", updatedAt: new Date() })
      .where(eq(reshipmentsTable.id, row.id));
    released += 1;
  }

  for (const row of pendingManualRows) {
    const items = toProducts(row.productsSnapshot);
    if (items.length === 0) continue;

    const productIds = Array.from(new Set(items.map((item) => item.id)));
    const stockByProduct = await getStockMap(productIds);
    const canRelease = hasEnoughStock(items, stockByProduct);

    if (!canRelease) continue;

    await reserveForReshipment(row.id, items);
    await db
      .update(manualReshipmentsTable)
      .set({ status: "reenvio_pronto_para_envio", updatedAt: new Date() })
      .where(eq(manualReshipmentsTable.id, row.id));
    released += 1;
  }

  return released;
}

export async function createManualReshipment(params: {
  clientName: string;
  clientPhone: string;
  clientDocument?: string | null;
  addressCep: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement?: string | null;
  addressNeighborhood: string;
  addressCity: string;
  addressState: string;
  notes?: string | null;
  productId: string;
  quantity: number;
  createdByUsername?: string | null;
}): Promise<{ id: string; status: ReshipmentStatus; missingProducts: string[] }> {
  const productId = String(params.productId || "").trim();
  const quantity = Number(params.quantity || 0);

  if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Produto e quantidade devem ser válidos.");
  }

  const [product] = await db
    .select({ id: productsTable.id, name: productsTable.name, isActive: productsTable.isActive })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);

  if (!product || !product.isActive) {
    throw new Error("Produto inválido para reenvio manual.");
  }

  const items: ReshipmentProduct[] = [{ id: product.id, name: product.name, quantity }];
  const stockByProduct = await getStockMap([product.id]);
  const enoughNow = hasEnoughStock(items, stockByProduct);
  const nextStatus: ReshipmentStatus = enoughNow ? "reenvio_pronto_para_envio" : "reenvio_aguardando_estoque";

  const id = `manual_${crypto.randomBytes(8).toString("hex")}`;

  await db.insert(manualReshipmentsTable).values({
    id,
    status: nextStatus,
    productsSnapshot: items,
    clientName: String(params.clientName || "").trim(),
    clientPhone: String(params.clientPhone || "").trim(),
    clientDocument: String(params.clientDocument || "").trim() || null,
    addressCep: String(params.addressCep || "").trim(),
    addressStreet: String(params.addressStreet || "").trim(),
    addressNumber: String(params.addressNumber || "").trim(),
    addressComplement: String(params.addressComplement || "").trim() || null,
    addressNeighborhood: String(params.addressNeighborhood || "").trim(),
    addressCity: String(params.addressCity || "").trim(),
    addressState: String(params.addressState || "").trim(),
    notes: String(params.notes || "").trim() || null,
    createdByUsername: String(params.createdByUsername || "").trim() || null,
    authorizedAt: new Date(),
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  if (enoughNow) {
    await reserveForReshipment(id, items);
  }

  return {
    id,
    status: nextStatus,
    missingProducts: enoughNow ? [] : [product.name],
  };
}

export async function registerInventoryEntry(params: {
  productId: string;
  quantity: number;
  reason?: string;
  referenceId?: string;
}): Promise<void> {
  await changeBalance(params.productId, params.quantity);

  const isExit = Number(params.quantity) < 0;

  await db.insert(inventoryMovementsTable).values({
    id: crypto.randomBytes(8).toString("hex"),
    productId: params.productId,
    type: isExit ? "exit" : "entry",
    quantity: params.quantity,
    reason: params.reason || (isExit ? "Saida manual de estoque" : "Entrada manual de estoque"),
    referenceId: params.referenceId || null,
    createdAt: new Date(),
  });
}

export async function listReshipments(status?: string): Promise<Array<{
  id: string;
  source: ReshipmentSource;
  orderId: string | null;
  supportTicketId: string | null;
  status: string;
  products: ReshipmentProduct[];
  resolvedReason: string | null;
  authorizedAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
  clientName: string;
  clientPhone: string | null;
  clientDocument: string | null;
  notes: string | null;
}>> {
  const rows = await db
    .select({
      id: reshipmentsTable.id,
      orderId: reshipmentsTable.orderId,
      supportTicketId: reshipmentsTable.supportTicketId,
      status: reshipmentsTable.status,
      productsSnapshot: reshipmentsTable.productsSnapshot,
      resolvedReason: reshipmentsTable.resolvedReason,
      authorizedAt: reshipmentsTable.authorizedAt,
      sentAt: reshipmentsTable.sentAt,
      createdAt: reshipmentsTable.createdAt,
      clientName: ordersTable.clientName,
      clientPhone: ordersTable.clientPhone,
      clientDocument: ordersTable.clientDocument,
    })
    .from(reshipmentsTable)
    .leftJoin(ordersTable, eq(ordersTable.id, reshipmentsTable.orderId))
    .where(status && status !== "all" ? eq(reshipmentsTable.status, status) : undefined)
    .orderBy(asc(reshipmentsTable.createdAt));

  const manualRows = await db
    .select({
      id: manualReshipmentsTable.id,
      status: manualReshipmentsTable.status,
      productsSnapshot: manualReshipmentsTable.productsSnapshot,
      authorizedAt: manualReshipmentsTable.authorizedAt,
      sentAt: manualReshipmentsTable.sentAt,
      createdAt: manualReshipmentsTable.createdAt,
      clientName: manualReshipmentsTable.clientName,
      clientPhone: manualReshipmentsTable.clientPhone,
      clientDocument: manualReshipmentsTable.clientDocument,
      notes: manualReshipmentsTable.notes,
    })
    .from(manualReshipmentsTable)
    .where(status && status !== "all" ? eq(manualReshipmentsTable.status, status) : undefined)
    .orderBy(asc(manualReshipmentsTable.createdAt));

  const fromSupport = rows.map((row) => ({
    id: row.id,
    source: "support" as const,
    orderId: row.orderId,
    supportTicketId: row.supportTicketId,
    status: row.status,
    products: toProducts(row.productsSnapshot),
    resolvedReason: row.resolvedReason || null,
    authorizedAt: row.authorizedAt?.toISOString() || null,
    sentAt: row.sentAt?.toISOString() || null,
    createdAt: row.createdAt?.toISOString() || null,
    clientName: row.clientName || "Cliente",
    clientPhone: row.clientPhone || null,
    clientDocument: row.clientDocument || null,
    notes: null,
  }));

  const fromManual = manualRows.map((row) => ({
    id: row.id,
    source: "manual" as const,
    orderId: null,
    supportTicketId: null,
    status: row.status,
    products: toProducts(row.productsSnapshot),
    resolvedReason: null,
    authorizedAt: row.authorizedAt?.toISOString() || null,
    sentAt: row.sentAt?.toISOString() || null,
    createdAt: row.createdAt?.toISOString() || null,
    clientName: row.clientName || "Cliente",
    clientPhone: row.clientPhone || null,
    clientDocument: row.clientDocument || null,
    notes: row.notes || null,
  }));

  return [...fromSupport, ...fromManual].sort((a, b) => {
    const ta = Date.parse(a.createdAt || "") || 0;
    const tb = Date.parse(b.createdAt || "") || 0;
    return tb - ta;
  });
}

export async function setReshipmentStatus(id: string, status: ReshipmentStatus): Promise<boolean> {
  const rows = await db
    .select({ id: reshipmentsTable.id, status: reshipmentsTable.status })
    .from(reshipmentsTable)
    .where(eq(reshipmentsTable.id, id))
    .limit(1);

  if (!rows[0]) return false;

  await db
    .update(reshipmentsTable)
    .set({
      status,
      sentAt: status === "reenvio_enviado" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(reshipmentsTable.id, id));

  return true;
}

export async function setManualReshipmentStatus(id: string, status: ReshipmentStatus): Promise<boolean> {
  const rows = await db
    .select({ id: manualReshipmentsTable.id })
    .from(manualReshipmentsTable)
    .where(eq(manualReshipmentsTable.id, id))
    .limit(1);

  if (!rows[0]) return false;

  await db
    .update(manualReshipmentsTable)
    .set({
      status,
      sentAt: status === "reenvio_enviado" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(manualReshipmentsTable.id, id));

  return true;
}

export async function getInventoryOverview(): Promise<{
  balances: Array<{ productId: string; productName: string; quantity: number }>;
  movements: Array<{ id: string; productId: string; productName: string; type: string; quantity: number; reason: string | null; createdAt: string }>;
}> {
  const [balancesRows, productsRows, movementsRows] = await Promise.all([
    db
      .select({ productId: inventoryBalancesTable.productId, quantity: inventoryBalancesTable.quantity })
      .from(inventoryBalancesTable),
    db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable),
    db
      .select()
      .from(inventoryMovementsTable)
      .orderBy(asc(inventoryMovementsTable.createdAt)),
  ]);

  const productNameMap = new Map(productsRows.map((row) => [row.id, row.name]));

  return {
    balances: balancesRows
      .map((row) => ({
        productId: row.productId,
        productName: productNameMap.get(row.productId) || row.productId,
        quantity: Number(row.quantity) || 0,
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName)),
    movements: movementsRows
      .slice(-120)
      .reverse()
      .map((row) => ({
        id: row.id,
        productId: row.productId,
        productName: productNameMap.get(row.productId) || row.productId,
        type: row.type,
        quantity: Number(row.quantity) || 0,
        reason: row.reason || null,
        createdAt: row.createdAt?.toISOString() || new Date().toISOString(),
      })),
  };
}

export async function getReshipmentByOrderIds(orderIds: string[]): Promise<Map<string, {
  id: string;
  status: string;
  supportTicketId: string;
  sentAt: string | null;
}>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: reshipmentsTable.id,
      orderId: reshipmentsTable.orderId,
      status: reshipmentsTable.status,
      supportTicketId: reshipmentsTable.supportTicketId,
      sentAt: reshipmentsTable.sentAt,
    })
    .from(reshipmentsTable)
    .where(inArray(reshipmentsTable.orderId, orderIds));

  return new Map(rows.map((row) => [
    row.orderId,
    {
      id: row.id,
      status: row.status,
      supportTicketId: row.supportTicketId,
      sentAt: row.sentAt?.toISOString() || null,
    },
  ]));
}
