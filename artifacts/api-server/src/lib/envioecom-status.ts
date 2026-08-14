export type EnvioEcomHistoryEvent = {
  at: string;
  status: string;
  description?: string | null;
  barcode?: string | null;
};

function normalizeStatus(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isProvisionalBarcode(barcode: unknown): boolean {
  const value = String(barcode || "").trim().toUpperCase();
  if (!value) return false;
  return /^EC\d+/i.test(value);
}

export function isUsableLabelBarcode(barcode: unknown): boolean {
  const value = String(barcode || "").trim();
  if (!value) return false;
  return !isProvisionalBarcode(value);
}

const LABEL_READY_MARKERS = [
  "etiqueta emitida",
  "pronto para envio",
  "processando envio",
  "aguardando expedicao",
  "dc-e emitida",
  "dce emitida",
];

const COLLECTED_MARKERS = [
  "coletado",
  "em transito",
  "postado",
  "saiu para entrega",
  "entregue",
  "objeto entregue",
];

function statusMatches(status: unknown, markers: string[]): boolean {
  const normalized = normalizeStatus(status);
  if (!normalized) return false;
  if (normalized.includes("cancelad") || normalized.includes("aguardando pagamento")) return false;
  return markers.some((marker) => normalized.includes(marker));
}

export function shouldMarkEnviadoFromStatus(status: unknown): boolean {
  return statusMatches(status, COLLECTED_MARKERS);
}

export function isLabelBlockedStatus(status: unknown): boolean {
  const normalized = normalizeStatus(status);
  return normalized.includes("cancelad") || normalized.includes("aguardando pagamento");
}

export function hasEnvioEcomLabelReady(input: {
  envioecomLabelUrl?: string | null;
  envioecomStatus?: string | null;
}): boolean {
  if (isLabelBlockedStatus(input.envioecomStatus)) return false;
  if (String(input.envioecomLabelUrl || "").trim()) return true;
  return statusMatches(input.envioecomStatus, LABEL_READY_MARKERS) || shouldMarkEnviadoFromStatus(input.envioecomStatus);
}

export function shouldMarkCompletedFromStatus(status: unknown): boolean {
  const normalized = normalizeStatus(status);
  if (!normalized) return false;
  if (normalized.includes("cancelad") || normalized.includes("devolucao") || normalized.includes("devolvido")) return false;
  return normalized.includes("entregue");
}

export type EnvioEcomTrackingGroup = "delivered" | "in_transit" | "awaiting" | "cancelled" | "other";

export function classifyEnvioEcomTrackingGroup(status: unknown): EnvioEcomTrackingGroup {
  const normalized = normalizeStatus(status);
  if (!normalized) return "other";
  if (normalized.includes("cancelad")) return "cancelled";
  if (normalized.includes("entregue")) return "delivered";
  if (["coletado", "em transito", "postado", "saiu para entrega"].some((marker) => normalized.includes(marker))) {
    return "in_transit";
  }
  if (
    LABEL_READY_MARKERS.some((marker) => normalized.includes(marker))
    || normalized.includes("envio criado")
    || normalized.includes("aguardando")
  ) {
    return "awaiting";
  }
  return "other";
}

export function isOpenEnvioEcomTrackingStatus(status: unknown): boolean {
  const group = classifyEnvioEcomTrackingGroup(status);
  return group !== "delivered" && group !== "cancelled";
}

export function appendStatusHistory(
  current: unknown,
  event: EnvioEcomHistoryEvent,
  limit = 30,
): EnvioEcomHistoryEvent[] {
  const parsed = Array.isArray(current)
    ? current
    : typeof current === "string"
      ? (() => {
          try {
            const value = JSON.parse(current);
            return Array.isArray(value) ? value : [];
          } catch {
            return [];
          }
        })()
      : [];

  const history: EnvioEcomHistoryEvent[] = [];
  for (const row of parsed) {
    const item = row as EnvioEcomHistoryEvent;
    const status = String(item?.status || "").trim();
    const at = String(item?.at || "").trim();
    if (!status || !at) continue;
    history.push({
      at,
      status,
      description: item.description ? String(item.description) : null,
      barcode: item.barcode ? String(item.barcode) : null,
    });
  }

  const last = history[history.length - 1];
  if (last && last.status === event.status && last.barcode === (event.barcode || null)) {
    return history.slice(-limit);
  }

  history.push({
    at: event.at,
    status: event.status,
    description: event.description || null,
    barcode: event.barcode || null,
  });
  return history.slice(-limit);
}
