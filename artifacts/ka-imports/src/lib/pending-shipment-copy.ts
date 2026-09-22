export type LabelReadyInput = {
  envioecomStatus?: string | null;
  envioecomLabelUrl?: string | null;
  enviado?: boolean | null;
  packages?: Array<{
    envioecomStatus?: string | null;
    envioecomLabelUrl?: string | null;
    enviado?: boolean | null;
  }> | null;
};

export type PendingCopyItem = {
  id: string | null;
  name: string;
  quantity: number;
};

export type PendingShipmentCopy = {
  items: PendingCopyItem[];
  isPartialSplit: boolean;
  remainingPools: string[];
};

export type PendingShipmentCopyOrder = {
  products?: unknown;
  packages?: Array<{
    inventoryPool?: string | null;
    items?: Array<{
      productId?: string | null;
      id?: string | null;
      productName?: string;
      name?: string;
      quantity?: number;
    }>;
    envioecomStatus?: string | null;
    envioecomLabelUrl?: string | null;
    enviado?: boolean | null;
  }> | null;
};

const LABEL_READY_MARKERS = [
  "etiqueta emitida",
  "etiqueta gerada",
  "pronto para envio",
  "processando envio",
  "aguardando expedicao",
  "aguardando coleta",
  "dc-e emitida",
  "dce emitida",
  "coletado",
  "em transito",
  "postado",
  "expedido",
  "saiu para entrega",
  "entregue",
  "objeto entregue",
];

export function hasEnvioEcomLabelReady(order: LabelReadyInput): boolean {
  const packages = Array.isArray(order.packages) ? order.packages : [];
  if (packages.length >= 2) {
    return packages.every((pkg) => hasEnvioEcomLabelReady({
      envioecomStatus: pkg.envioecomStatus,
      envioecomLabelUrl: pkg.envioecomLabelUrl,
      enviado: pkg.enviado,
      packages: [],
    }));
  }
  const normalized = String(order.envioecomStatus || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (normalized.includes("cancelad") || normalized.includes("cancelamento") || normalized.includes("aguardando pagamento")) {
    return false;
  }
  if (order.enviado) return true;
  if (String(order.envioecomLabelUrl || "").trim()) return true;
  if (!normalized) return false;
  return LABEL_READY_MARKERS.some((marker) => normalized.includes(marker));
}

export function inventoryPoolCopyLabel(pool?: string | null): string {
  const normalized = String(pool || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ");
  if (normalized === "motoboy") return "Motoboy";
  if (normalized === "minas") return "Minas";
  if (normalized === "loja" || normalized.includes("foz")) return "Fóz Guaçu";
  return "";
}

function parseOrderProducts(raw: unknown): PendingCopyItem[] {
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  return rows
    .map((item) => {
      const row = item as { id?: unknown; name?: unknown; quantity?: unknown };
      return {
        id: String(row?.id || "").trim() || null,
        name: String(row?.name || "Produto").trim() || "Produto",
        quantity: Math.trunc(Number(row?.quantity || 0)),
      };
    })
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);
}

function parsePackageItems(items: unknown): PendingCopyItem[] {
  const rows = Array.isArray(items) ? items : [];
  return rows
    .map((item) => {
      const row = item as {
        productId?: unknown;
        id?: unknown;
        productName?: unknown;
        name?: unknown;
        quantity?: unknown;
      };
      return {
        id: String(row?.productId || row?.id || "").trim() || null,
        name: String(row?.productName || row?.name || "Produto").trim() || "Produto",
        quantity: Math.trunc(Number(row?.quantity || 0)),
      };
    })
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);
}

function groupCopyItems(items: PendingCopyItem[]): PendingCopyItem[] {
  const grouped = new Map<string, PendingCopyItem>();
  for (const item of items) {
    const key = item.id ? `id:${item.id}` : `name:${item.name.trim().toLowerCase()}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      id: prev?.id || item.id,
      name: prev?.name || item.name,
      quantity: (prev?.quantity || 0) + item.quantity,
    });
  }
  return [...grouped.values()];
}

export function getPendingShipmentCopy(order: PendingShipmentCopyOrder): PendingShipmentCopy {
  const fallbackItems = parseOrderProducts(order.products);
  const packages = Array.isArray(order.packages) ? order.packages : [];
  if (packages.length < 2) {
    return { items: fallbackItems, isPartialSplit: false, remainingPools: [] };
  }

  const pending = packages.filter((pkg) => !hasEnvioEcomLabelReady({
    envioecomStatus: pkg.envioecomStatus,
    envioecomLabelUrl: pkg.envioecomLabelUrl,
    enviado: pkg.enviado,
    packages: [],
  }));

  if (pending.length === 0) {
    return { items: [], isPartialSplit: true, remainingPools: [] };
  }

  const items = groupCopyItems(pending.flatMap((pkg) => parsePackageItems(pkg.items)));
  const remainingPools = [...new Set(
    pending
      .map((pkg) => inventoryPoolCopyLabel(pkg.inventoryPool))
      .filter(Boolean),
  )];
  const isPartialSplit = pending.length < packages.length;

  return {
    items: items.length ? items : (isPartialSplit ? [] : fallbackItems),
    isPartialSplit,
    remainingPools,
  };
}

export function pendingShipmentResumoHeading(copy: PendingShipmentCopy): string {
  if (!copy.isPartialSplit) return "Resumo pedido";
  if (copy.remainingPools.length === 1) {
    return `Resumo pedido (falta etiqueta — ${copy.remainingPools[0]})`;
  }
  if (copy.remainingPools.length > 1) {
    return `Resumo pedido (falta etiqueta — ${copy.remainingPools.join(", ")})`;
  }
  return "Resumo pedido (falta etiqueta)";
}
