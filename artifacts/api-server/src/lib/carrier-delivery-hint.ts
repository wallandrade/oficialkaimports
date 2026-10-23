import { carrierDisplayName, carrierKey, foldPlace, stateCode } from "./carrier-loss";
import { shouldMarkCompletedFromStatus } from "./envioecom-status";

export type CarrierDeliveryHit = {
  carrierKey: string;
  carrierName: string;
  orderNumber: number | null;
  deliveredAt: Date;
  cityName: string;
  state: string;
};

export type CarrierDeliverySource = {
  orderId: string;
  carrierName: string | null;
  status: string | null;
  deliveredAt: Date | null;
  orderNumber: number | null;
  cityName: string | null;
  state: string | null;
  packageCount: number;
  fromPackage: boolean;
};

export function isDeliveredHintStatus(status: unknown): boolean {
  const normalized = String(status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.includes("nao entregue")) return false;
  return shouldMarkCompletedFromStatus(status);
}

export function collectDeliveryHits(
  destination: { city?: string | null; state?: string | null },
  excludeOrderId: string,
  since: Date,
  rows: CarrierDeliverySource[],
): CarrierDeliveryHit[] {
  const city = foldPlace(destination.city);
  const state = stateCode(destination.state);
  const skipOrderId = String(excludeOrderId || "").trim();
  if (!city || !state) return [];
  const hits: CarrierDeliveryHit[] = [];
  for (const row of rows) {
    if (skipOrderId && row.orderId === skipOrderId) continue;
    if (row.fromPackage ? row.packageCount < 2 : row.packageCount >= 2) continue;
    if (foldPlace(row.cityName) !== city || stateCode(row.state) !== state) continue;
    if (!row.deliveredAt || row.deliveredAt.getTime() < since.getTime()) continue;
    if (!isDeliveredHintStatus(row.status)) continue;
    const key = carrierKey(row.carrierName);
    if (!key) continue;
    hits.push({
      carrierKey: key,
      carrierName: carrierDisplayName(row.carrierName) || String(row.carrierName || "").trim(),
      orderNumber: row.orderNumber != null && row.orderNumber > 0 ? row.orderNumber : null,
      deliveredAt: row.deliveredAt,
      cityName: String(row.cityName || "").trim(),
      state,
    });
  }
  return hits;
}

export function deliveryHintForCarrier(
  carrierRaw: unknown,
  hits: CarrierDeliveryHit[],
): { message: string } | null {
  const key = carrierKey(carrierRaw);
  if (!key) return null;
  const match = hits
    .filter((hit) => hit.carrierKey === key)
    .sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime())[0];
  if (!match) return null;
  return { message: deliveryHintMessage(match) };
}

export function deliveryHintMessage(hit: CarrierDeliveryHit): string {
  const city = String(hit.cityName || "").trim();
  const state = stateCode(hit.state);
  const place = city && state ? `${city}/${state}` : (city || "Esta cidade");
  const carrier = carrierDisplayName(hit.carrierName) || "esta transportadora";
  const details = [
    hit.orderNumber != null && hit.orderNumber > 0 ? `pedido #${hit.orderNumber}` : "",
    formatDayMonth(hit.deliveredAt),
  ].filter(Boolean);
  const tail = details.length ? ` (${details.join(", ")})` : "";
  return `${place} já recebeu pela ${carrier}${tail}.`;
}

function formatDayMonth(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  }).format(value);
}
