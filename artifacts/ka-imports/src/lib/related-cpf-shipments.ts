const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type RelatedCpfProduct = {
  productId: string | null;
  productName: string;
  quantity: number;
};

export type RelatedCpfWarningLevel = "none" | "recent" | "same_product";

export type RelatedCpfShipment = {
  orderId: string;
  orderNumber: number | null;
  parentOrderId: string | null;
  isReshipRelated: boolean;
  shippedAt: string;
  enviado: boolean;
  barcode: string | null;
  envioecomShipmentId: number | null;
  envioecomStatus: string | null;
  accountId: string | null;
  accountName: string | null;
  products: RelatedCpfProduct[];
  sameProduct: boolean;
  recent: boolean;
  hasEnvioEcom?: boolean;
};

export type RelatedCpfShipmentsResult = {
  cpf: string | null;
  shipments: RelatedCpfShipment[];
  recentCount: number;
  sameProductCount: number;
  warningLevel: RelatedCpfWarningLevel;
  recentDays: number;
};

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: RelatedCpfShipmentsResult }>();
const inflight = new Map<string, Promise<RelatedCpfShipmentsResult>>();

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { Authorization: `Bearer ${token}` }
    : {};
}

export function emptyRelatedCpfShipmentsResult(): RelatedCpfShipmentsResult {
  return {
    cpf: null,
    shipments: [],
    recentCount: 0,
    sameProductCount: 0,
    warningLevel: "none",
    recentDays: 14,
  };
}

export function relatedCpfOrderLabel(shipment: RelatedCpfShipment): string {
  const number = Number(shipment.orderNumber);
  return Number.isFinite(number) && number > 0 ? `#${Math.trunc(number)}` : shipment.orderId.slice(0, 8);
}

export async function fetchRelatedCpfShipments(
  orderId: string,
  signal?: AbortSignal,
): Promise<RelatedCpfShipmentsResult> {
  const id = String(orderId || "").trim();
  if (!id) return emptyRelatedCpfShipmentsResult();
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  const pending = inflight.get(id);
  if (pending) return pending;

  const request = (async () => {
    const res = await fetch(`${BASE}/api/admin/orders/${encodeURIComponent(id)}/related-shipments`, {
      headers: adminHeaders(),
      signal,
    });
    if (!res.ok) throw new Error("Falha ao buscar envios deste CPF.");
    const data = await res.json() as RelatedCpfShipmentsResult;
    const normalized: RelatedCpfShipmentsResult = {
      cpf: data.cpf || null,
      shipments: Array.isArray(data.shipments) ? data.shipments : [],
      recentCount: Number(data.recentCount || 0),
      sameProductCount: Number(data.sameProductCount || 0),
      warningLevel: data.warningLevel === "same_product" || data.warningLevel === "recent"
        ? data.warningLevel
        : "none",
      recentDays: Number(data.recentDays || 14),
    };
    cache.set(id, { at: Date.now(), data: normalized });
    return normalized;
  })();

  inflight.set(id, request);
  try {
    return await request;
  } finally {
    inflight.delete(id);
  }
}
