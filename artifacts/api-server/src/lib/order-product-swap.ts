export type ProductSwapMode = "keep_price" | "pass_difference";

export type OrderProductSwapFrom = {
  id: string;
  name: string;
  quantity: number;
  price: number;
};

export type OrderProductLine = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  costPrice?: number;
  image?: string | null;
  swappedFrom?: OrderProductSwapFrom | null;
  swapMode?: ProductSwapMode | null;
  [key: string]: unknown;
};

export type ShipmentSwapItem = {
  productId: string | null;
  productName: string;
  quantity: number;
};

export type OrderProductSwapError = {
  ok: false;
  code: string;
  message: string;
};

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function asSwappedFrom(raw: unknown): OrderProductSwapFrom | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const name = String(row.name || "").trim();
  const id = String(row.id || "").trim();
  const quantity = Math.trunc(Number(row.quantity || 0));
  const price = roundMoney(Number(row.price || 0));
  if (!name && !id) return null;
  return { id, name: name || id, quantity: quantity > 0 ? quantity : 0, price };
}

export function parseOrderProductLines(raw: unknown): OrderProductLine[] {
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

  return parsed
    .map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const quantity = Math.trunc(Number(row.quantity || 0));
      const swappedFrom = asSwappedFrom(row.swappedFrom);
      const swapMode = row.swapMode === "keep_price" || row.swapMode === "pass_difference"
        ? row.swapMode
        : null;
      return {
        ...row,
        id: String(row.id || "").trim(),
        name: String(row.name || "Produto").trim() || "Produto",
        quantity,
        price: roundMoney(Number(row.price || 0)),
        costPrice: row.costPrice == null ? undefined : roundMoney(Number(row.costPrice)),
        image: String(row.image || "").trim() || null,
        swappedFrom,
        swapMode,
      } as OrderProductLine;
    })
    .filter((item) => item.quantity > 0 && (item.id || item.name));
}

export function lineCost(line: { quantity?: number; costPrice?: number | null }): number {
  return roundMoney(Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.costPrice) || 0));
}

export function lineTotal(line: { quantity?: number; price?: number | null }): number {
  return roundMoney(Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.price) || 0));
}

export function assertOrderCanSwapProduct(order: {
  status?: string | null;
  enviado?: boolean | null;
  inventoryReserved?: boolean | null;
  inventoryExitedPools?: unknown;
  parentOrderId?: string | null;
  observation?: string | null;
  packages?: Array<{ enviado?: boolean | null }> | null;
}): { ok: true } | OrderProductSwapError {
  const status = String(order.status || "").trim().toLowerCase();
  if (status === "cancelled") {
    return { ok: false, code: "ORDER_CANCELLED", message: "Pedido cancelado não aceita troca de produto." };
  }
  if (order.enviado) {
    return { ok: false, code: "ALREADY_SHIPPED", message: "Pedido já enviado. Troca de produto só antes da expedição." };
  }
  if (order.inventoryReserved) {
    return { ok: false, code: "INVENTORY_RESERVED", message: "Estoque já foi baixado neste pedido. Não dá para trocar o SKU agora." };
  }
  const exited = Array.isArray(order.inventoryExitedPools)
    ? order.inventoryExitedPools
    : String(order.inventoryExitedPools || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (exited.length > 0) {
    return { ok: false, code: "INVENTORY_EXITED", message: "Este pedido já teve baixa de estoque. Troca só antes da expedição." };
  }
  if (String(order.parentOrderId || "").trim() || String(order.observation || "").toUpperCase().includes("REENVIO DO PEDIDO")) {
    return { ok: false, code: "RESHIPMENT_CHILD", message: "Filho de reenvio não aceita troca de produto. Use o pedido original." };
  }
  if ((order.packages || []).some((pkg) => pkg.enviado)) {
    return { ok: false, code: "PACKAGE_SHIPPED", message: "Um pacote deste pedido já foi enviado. Troca só antes da expedição." };
  }
  return { ok: true };
}

export function applyProductSwap(input: {
  products: unknown;
  lineIndex: number;
  quantity?: number;
  replacement: { id: string; name: string; unitPrice: number; costPrice: number; image?: string | null };
  mode: ProductSwapMode;
}): { ok: true; products: OrderProductLine[]; from: OrderProductLine; to: OrderProductLine } | OrderProductSwapError {
  const products = parseOrderProductLines(input.products);
  const lineIndex = Math.trunc(Number(input.lineIndex));
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= products.length) {
    return { ok: false, code: "LINE_NOT_FOUND", message: "Item do pedido não encontrado." };
  }
  const from = products[lineIndex];
  const quantity = Math.trunc(Number(input.quantity ?? from.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, code: "INVALID_QTY", message: "Quantidade da troca inválida." };
  }
  if (quantity > from.quantity) {
    return { ok: false, code: "QTY_TOO_HIGH", message: "Quantidade maior do que a linha do pedido." };
  }
  const replacementId = String(input.replacement?.id || "").trim();
  const replacementName = String(input.replacement?.name || "").trim() || "Produto";
  if (!replacementId) {
    return { ok: false, code: "REPLACEMENT_REQUIRED", message: "Escolha o produto novo." };
  }
  if (replacementId === from.id) {
    return { ok: false, code: "SAME_PRODUCT", message: "Escolha um produto diferente do atual." };
  }
  const mode: ProductSwapMode = input.mode === "pass_difference" ? "pass_difference" : "keep_price";
  const unitPrice = roundMoney(mode === "keep_price" ? from.price : Number(input.replacement.unitPrice || 0));
  const costPrice = roundMoney(Math.max(0, Number(input.replacement.costPrice || 0)));
  const to: OrderProductLine = {
    id: replacementId,
    name: replacementName,
    quantity,
    price: unitPrice,
    costPrice,
    image: String(input.replacement.image || "").trim() || null,
    swappedFrom: {
      id: from.id,
      name: from.name,
      quantity,
      price: from.price,
    },
    swapMode: mode,
  };

  const next = products.map((line) => ({ ...line }));
  if (quantity === from.quantity) {
    next[lineIndex] = to;
  } else {
    next[lineIndex] = { ...from, quantity: from.quantity - quantity };
    next.splice(lineIndex + 1, 0, to);
  }
  return { ok: true, products: next, from: { ...from, quantity }, to };
}

export function applySwapToShipmentItems(input: {
  items: ShipmentSwapItem[];
  fromProductId: string;
  quantity: number;
  replacement: { id: string; name: string };
}): { ok: true; items: ShipmentSwapItem[] } | OrderProductSwapError {
  const fromId = String(input.fromProductId || "").trim();
  const replacementId = String(input.replacement.id || "").trim();
  const replacementName = String(input.replacement.name || "").trim() || "Produto";
  const quantity = Math.trunc(Number(input.quantity || 0));
  if (!fromId || !replacementId || quantity <= 0) {
    return { ok: false, code: "INVALID_INPUT", message: "Troca do pacote inválida." };
  }
  const items = (Array.isArray(input.items) ? input.items : []).map((item) => ({
    productId: String(item.productId || "").trim() || null,
    productName: String(item.productName || "").trim() || "Produto",
    quantity: Math.trunc(Number(item.quantity || 0)),
  })).filter((item) => item.quantity > 0);

  const sourceIndex = items.findIndex((item) => item.productId === fromId);
  if (sourceIndex < 0) {
    return { ok: false, code: "PACKAGE_ITEM_NOT_FOUND", message: "Este produto não está neste pacote." };
  }
  if (items[sourceIndex].quantity < quantity) {
    return { ok: false, code: "PACKAGE_QTY_TOO_HIGH", message: "Quantidade maior do que a deste pacote." };
  }

  const next = items.map((item) => ({ ...item }));
  const remaining = next[sourceIndex].quantity - quantity;
  if (remaining <= 0) next.splice(sourceIndex, 1);
  else next[sourceIndex].quantity = remaining;

  const existing = next.find((item) => item.productId === replacementId);
  if (existing) existing.quantity += quantity;
  else next.push({ productId: replacementId, productName: replacementName, quantity });
  return { ok: true, items: next };
}

export function pickPackageForProductSwap(
  packages: Array<{ id?: string | null; enviado?: boolean | null; items?: unknown }>,
  fromProductId: string,
  packageId?: string | null,
): { ok: true; packageId: string | null } | OrderProductSwapError {
  const rows = Array.isArray(packages) ? packages : [];
  if (rows.length < 2) return { ok: true, packageId: null };
  const fromId = String(fromProductId || "").trim();
  const requested = String(packageId || "").trim();
  if (requested) {
    const found = rows.find((pkg) => String(pkg.id || "").trim() === requested);
    if (!found) return { ok: false, code: "PACKAGE_NOT_FOUND", message: "Pacote não encontrado neste pedido." };
    if (found.enviado) return { ok: false, code: "PACKAGE_SHIPPED", message: "Este pacote já foi enviado." };
    return { ok: true, packageId: requested };
  }
  const matches = rows.filter((pkg) => {
    const items = Array.isArray(pkg.items) ? pkg.items : [];
    return items.some((item) => {
      const row = item && typeof item === "object" ? item as { productId?: unknown } : {};
      return String(row.productId || "").trim() === fromId;
    });
  });
  if (matches.length === 0) {
    return { ok: false, code: "PACKAGE_ITEM_NOT_FOUND", message: "Este produto não está em nenhum pacote do split." };
  }
  if (matches.length > 1) {
    return { ok: false, code: "NEED_PACKAGE_ID", message: "Pedido dividido: escolha o pacote da troca (Fóz, Motoboy ou Minas)." };
  }
  if (matches[0].enviado) {
    return { ok: false, code: "PACKAGE_SHIPPED", message: "Este pacote já foi enviado." };
  }
  return { ok: true, packageId: String(matches[0].id || "").trim() || null };
}
