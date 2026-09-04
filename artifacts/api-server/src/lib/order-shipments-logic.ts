import crypto from "crypto";
import type { KaInventoryExitPool } from "./yury-inventory";
import { parseKaInventoryExitPool } from "./yury-inventory";
import { buildExternalOrderNumber } from "./envioecom-order-ref";
import { hasEnvioEcomLabelReady, shouldMarkEnviadoFromStatus } from "./envioecom-status";

export type OrderShipmentPool = KaInventoryExitPool;

export type OrderShipmentItem = {
  productId: string | null;
  productName: string;
  quantity: number;
};

export type OrderShipmentAllocationInput = {
  pool: unknown;
  items?: unknown;
};

export type OrderShipmentAllocation = {
  pool: OrderShipmentPool;
  items: OrderShipmentItem[];
};

export type OrderShipmentLogicError = {
  code: string;
  message: string;
};

export function parseOrderShipmentItems(raw: unknown): OrderShipmentItem[] {
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
      const row = item as { id?: unknown; productId?: unknown; name?: unknown; productName?: unknown; quantity?: unknown };
      return {
        productId: String(row?.productId || row?.id || "").trim() || null,
        productName: String(row?.productName || row?.name || "Produto").trim() || "Produto",
        quantity: Math.trunc(Number(row?.quantity || 0)),
      };
    })
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);

  const grouped = new Map<string, OrderShipmentItem>();
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

function itemKey(item: OrderShipmentItem): string {
  return item.productId ? `id:${item.productId}` : `name:${item.productName.trim().toLowerCase()}`;
}

export function isSplitShipments(packages: unknown): boolean {
  return Array.isArray(packages) && packages.length >= 2;
}

export function packageInventoryReferenceId(packageId: string): string {
  return `pkg:${String(packageId || "").trim()}`;
}

export function validateOrderShipmentAllocation(
  orderItems: unknown,
  packages: OrderShipmentAllocationInput[],
): { ok: true; packages: OrderShipmentAllocation[] } | { ok: false; error: OrderShipmentLogicError } {
  const required = parseOrderShipmentItems(orderItems);
  if (required.length === 0) {
    return { ok: false, error: { code: "INVALID_ITEMS", message: "Pedido sem itens para dividir." } };
  }
  if (!Array.isArray(packages) || packages.length < 2) {
    return { ok: false, error: { code: "NEED_TWO_ORIGINS", message: "Divida o envio em no mínimo 2 origens." } };
  }

  const allocated: OrderShipmentAllocation[] = [];
  const seenPools = new Set<OrderShipmentPool>();
  for (const row of packages) {
    const pool = parseKaInventoryExitPool(row?.pool);
    if (!pool) {
      return { ok: false, error: { code: "INVALID_POOL", message: "Cada pacote precisa de origem loja, motoboy ou minas." } };
    }
    if (seenPools.has(pool)) {
      return { ok: false, error: { code: "DUPLICATE_POOL", message: "Só 1 pacote por origem. Não crie dois pacotes da mesma origem." } };
    }
    seenPools.add(pool);
    const items = parseOrderShipmentItems(row?.items);
    if (items.length === 0) {
      return { ok: false, error: { code: "EMPTY_PACKAGE", message: `O pacote ${pool} não tem itens.` } };
    }
    allocated.push({ pool, items });
  }

  const allocatedByKey = new Map<string, { item: OrderShipmentItem; quantity: number }>();
  for (const pkg of allocated) {
    for (const item of pkg.items) {
      const key = itemKey(item);
      const prev = allocatedByKey.get(key);
      allocatedByKey.set(key, {
        item: {
          productId: prev?.item.productId || item.productId,
          productName: prev?.item.productName || item.productName,
          quantity: (prev?.quantity || 0) + item.quantity,
        },
        quantity: (prev?.quantity || 0) + item.quantity,
      });
    }
  }

  const requiredByKey = new Map(required.map((item) => [itemKey(item), item] as const));
  for (const [key, requiredItem] of requiredByKey) {
    const got = allocatedByKey.get(key)?.quantity || 0;
    if (got !== requiredItem.quantity) {
      return {
        ok: false,
        error: {
          code: "QTY_MISMATCH",
          message: `A soma das qtds precisa fechar o pedido. ${requiredItem.productName}: pedido ${requiredItem.quantity}, alocado ${got}.`,
        },
      };
    }
  }
  for (const [key, allocatedItem] of allocatedByKey) {
    if (!requiredByKey.has(key)) {
      return {
        ok: false,
        error: {
          code: "EXTRA_ITEM",
          message: `Item ${allocatedItem.item.productName} não está no pedido.`,
        },
      };
    }
  }

  return { ok: true, packages: allocated };
}

function historyHasEvents(history: unknown): boolean {
  return Array.isArray(history) && history.length > 0;
}

export function buildPackageExternalOrderNumber(
  order: { orderNumber?: number | null; id: string },
  pool: OrderShipmentPool,
  current?: {
    envioecomShipmentId?: number | null;
    envioecomExternalOrderNumber?: string | null;
    envioecomStatusHistory?: unknown;
  },
  salt?: string,
): string {
  const bound = String(current?.envioecomExternalOrderNumber || "").trim();
  if (current?.envioecomShipmentId && bound) return bound;
  const base = `${buildExternalOrderNumber(order)}-${pool}`;
  if (!bound && !historyHasEvents(current?.envioecomStatusHistory)) return base;
  const suffix = String(salt || crypto.randomBytes(3).toString("hex").slice(0, 4)).replace(/[^a-z0-9]/gi, "").slice(0, 8) || "n1";
  return `${base}-${suffix}`;
}

export type ShipmentStatusLike = {
  envioecomLabelUrl?: string | null;
  envioecomStatus?: string | null;
  enviado?: boolean | null;
};

const STATUS_RANK = [
  "none",
  "created",
  "label",
  "collected",
  "delivered",
] as const;

function normalizeStatusRank(status: unknown): (typeof STATUS_RANK)[number] {
  const normalized = String(status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.includes("cancelad") || normalized.includes("cancelamento")) return "none";
  if (normalized.includes("entregue")) return "delivered";
  if (["coletado", "em transito", "postado", "saiu para entrega"].some((marker) => normalized.includes(marker))) {
    return "collected";
  }
  if (
    hasEnvioEcomLabelReady({ envioecomStatus: String(status || ""), envioecomLabelUrl: null })
    || normalized.includes("aguardando coleta")
  ) {
    return "label";
  }
  if (normalized.includes("envio criado") || normalized.includes("aguardando")) return "created";
  return "created";
}

function rankIndex(rank: (typeof STATUS_RANK)[number]): number {
  return STATUS_RANK.indexOf(rank);
}

export function leastAdvancedShipmentStatus(packages: Array<{ envioecomStatus?: string | null }>): string | null {
  if (!packages.length) return null;
  let least = packages[0];
  let leastRank = rankIndex(normalizeStatusRank(least.envioecomStatus));
  for (const pkg of packages.slice(1)) {
    const rank = rankIndex(normalizeStatusRank(pkg.envioecomStatus));
    if (rank < leastRank) {
      least = pkg;
      leastRank = rank;
    }
  }
  return String(least.envioecomStatus || "").trim() || null;
}

export function packageHasLabelReady(pkg: ShipmentStatusLike): boolean {
  if (pkg.enviado) return true;
  return hasEnvioEcomLabelReady({
    envioecomLabelUrl: pkg.envioecomLabelUrl,
    envioecomStatus: pkg.envioecomStatus,
  });
}

export function allPackagesLabelReady(packages: ShipmentStatusLike[]): boolean {
  return packages.length > 0 && packages.every(packageHasLabelReady);
}

export function allPackagesEnviado(packages: Array<{ enviado?: boolean | null; envioecomStatus?: string | null }>): boolean {
  return packages.length > 0 && packages.every((pkg) => Boolean(pkg.enviado) || shouldMarkEnviadoFromStatus(pkg.envioecomStatus));
}

export function allPackagesReserved(packages: Array<{ inventoryReserved?: boolean | null }>): boolean {
  return packages.length > 0 && packages.every((pkg) => Boolean(pkg.inventoryReserved));
}

export function allPackagesDelivered(packages: Array<{ envioecomStatus?: string | null }>): boolean {
  return packages.length > 0 && packages.every((pkg) => {
    const normalized = String(pkg.envioecomStatus || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    return normalized.includes("entregue") && !normalized.includes("cancelad");
  });
}

export function rollupParentLabelUrl(packages: Array<{ envioecomLabelUrl?: string | null }>): string | null {
  if (!packages.length) return null;
  const urls = packages.map((pkg) => String(pkg.envioecomLabelUrl || "").trim()).filter(Boolean);
  if (urls.length !== packages.length) return null;
  return urls[0] || null;
}

export function pickInheritPackageIndex(
  packages: OrderShipmentAllocation[],
  preferredPool?: string | null,
): number {
  const preferred = parseKaInventoryExitPool(preferredPool);
  if (preferred) {
    const index = packages.findIndex((pkg) => pkg.pool === preferred);
    if (index >= 0) return index;
  }
  return 0;
}

export function mapOrderShipmentPackage(row: {
  id: string;
  orderId: string;
  inventoryPool: string;
  items: unknown;
  enviado?: boolean | null;
  inventoryReserved?: boolean | null;
  envioecomShipmentId?: number | null;
  envioecomBarcode?: string | null;
  envioecomTrackingKey?: string | null;
  envioecomDeliveryMode?: string | null;
  envioecomStatus?: string | null;
  envioecomStatusUpdatedAt?: Date | string | null;
  envioecomStatusHistory?: unknown;
  envioecomLabelUrl?: string | null;
  envioecomFreightCost?: string | number | null;
  envioecomExternalOrderNumber?: string | null;
  envioecomAccountId?: string | null;
}, options?: { light?: boolean }) {
  const light = Boolean(options?.light);
  const labelUrl = String(row.envioecomLabelUrl || "").trim() || null;
  return {
    id: row.id,
    orderId: row.orderId,
    inventoryPool: parseKaInventoryExitPool(row.inventoryPool) || row.inventoryPool,
    items: parseOrderShipmentItems(row.items),
    enviado: Boolean(row.enviado),
    inventoryReserved: Boolean(row.inventoryReserved),
    envioecomShipmentId: row.envioecomShipmentId ?? null,
    envioecomBarcode: row.envioecomBarcode ?? null,
    envioecomTrackingKey: row.envioecomTrackingKey ?? null,
    envioecomDeliveryMode: row.envioecomDeliveryMode ?? null,
    envioecomStatus: row.envioecomStatus ?? null,
    envioecomStatusUpdatedAt: row.envioecomStatusUpdatedAt
      ? (row.envioecomStatusUpdatedAt instanceof Date
        ? row.envioecomStatusUpdatedAt.toISOString()
        : String(row.envioecomStatusUpdatedAt))
      : null,
    envioecomStatusHistory: row.envioecomStatusHistory ?? [],
    envioecomLabelUrl: light && labelUrl && /^data:/i.test(labelUrl) ? null : labelUrl,
    envioecomFreightCost: row.envioecomFreightCost != null ? Number(row.envioecomFreightCost) : null,
    envioecomExternalOrderNumber: row.envioecomExternalOrderNumber ?? null,
    envioecomAccountId: row.envioecomAccountId ?? null,
  };
}
