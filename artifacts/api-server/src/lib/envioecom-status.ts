export type EnvioEcomHistoryEvent = {
  at: string;
  status: string;
  location?: string | null;
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
  "etiqueta gerada",
  "pronto para envio",
  "processando envio",
  "aguardando expedicao",
  "aguardando ser coletado",
  "aguardando coleta",
  "aguardando postagem",
  "dc-e emitida",
  "dce emitida",
];

const STILL_AT_STORE_MARKERS = [
  "aguardando ser coletado",
  "aguardando coleta",
  "aguardando postagem",
  "coleta solicitada",
];

const COLLECTED_MARKERS = [
  "em rota",
  "transferencia",
  "coleta efetuada",
  "nao entrou",
  "depositado",
  "coletado",
  "em transito",
  "postado",
  "expedido",
  "saiu para entrega",
  "entregue",
  "objeto entregue",
];

function statusMatches(status: unknown, markers: string[]): boolean {
  const normalized = normalizeStatus(status);
  if (!normalized) return false;
  if (isEnvioEcomCancelledStatus(normalized) || normalized.includes("aguardando pagamento")) return false;
  return markers.some((marker) => normalized.includes(marker));
}

function isStillAtStoreStatus(status: unknown): boolean {
  const normalized = normalizeStatus(status);
  if (!normalized) return false;
  return STILL_AT_STORE_MARKERS.some((marker) => normalized.includes(marker));
}

export function shouldMarkEnviadoFromStatus(status: unknown): boolean {
  if (isStillAtStoreStatus(status)) return false;
  return statusMatches(status, COLLECTED_MARKERS);
}

/** Entregue 50, trânsito 40, etiqueta 20, envio criado 15, resto 5. */
export function envioecomTrackingRank(status: unknown): number {
  const normalized = normalizeStatus(status);
  if (!normalized) return 5;
  if (isEnvioEcomCancelledStatus(normalized) || normalized.includes("aguardando pagamento")) return 5;
  if (normalized.includes("entregue") && !normalized.includes("devolucao") && !normalized.includes("devolvido")) return 50;
  if (normalized.includes("coleta solicitada") && !shouldMarkEnviadoFromStatus(status)) return 5;
  if (isStillAtStoreStatus(status) || statusMatches(status, LABEL_READY_MARKERS)) return 20;
  if (shouldMarkEnviadoFromStatus(status)) return 40;
  if (normalized.includes("envio criado")) return 15;
  return 5;
}

export function isEnvioEcomCancelledStatus(status: unknown): boolean {
  const normalized = normalizeStatus(status);
  return normalized.includes("cancelad") || normalized.includes("cancelamento");
}

export function isLabelBlockedStatus(status: unknown): boolean {
  const normalized = normalizeStatus(status);
  return isEnvioEcomCancelledStatus(normalized) || normalized.includes("aguardando pagamento");
}

export function resolveStatusAfterLabelGenerated(current: unknown): string {
  const status = String(current || "").trim();
  if (isLabelBlockedStatus(status)) return status || "Etiqueta emitida";
  if (statusMatches(status, LABEL_READY_MARKERS) || shouldMarkEnviadoFromStatus(status)) {
    return status;
  }
  return "Etiqueta emitida";
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
  if (isEnvioEcomCancelledStatus(normalized) || normalized.includes("devolucao") || normalized.includes("devolvido")) return false;
  return normalized.includes("entregue");
}

export type EnvioEcomTrackingGroup = "delivered" | "in_transit" | "awaiting" | "cancelled" | "other";

export function classifyEnvioEcomTrackingGroup(status: unknown): EnvioEcomTrackingGroup {
  const normalized = normalizeStatus(status);
  if (!normalized) return "other";
  if (isEnvioEcomCancelledStatus(status)) return "cancelled";
  if (normalized.includes("entregue")) return "delivered";
  if (shouldMarkEnviadoFromStatus(status)) return "in_transit";
  if (
    LABEL_READY_MARKERS.some((marker) => normalized.includes(marker))
    || normalized.includes("envio criado")
    || normalized.includes("coleta solicitada")
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

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pickText(...values: unknown[]): string | null {
  return pickTextAt(values, 0);
}

function pickTextAt(values: unknown[], depth: number): string | null {
  if (depth > 3) return null;
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === "object") {
      if (Array.isArray(value)) continue;
      const rec = value as Record<string, unknown>;
      const nested = pickTextAt(
        [rec.nome, rec.name, rec.cidade, rec.city, rec.city_name, rec.cityName, rec.municipio, rec.localidade, rec.label, rec.title],
        depth + 1,
      );
      if (nested) return nested;
      continue;
    }
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function sameTrackingText(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeStatus(left);
  const b = normalizeStatus(right);
  return !!a && a === b;
}

function extractUnitSuffix(status: string): string | null {
  const match = String(status || "").trim().match(/\s[-–]\s(.+)$/);
  const suffix = (match?.[1] || "").replace(/\s+/g, " ").trim();
  if (!suffix || suffix.length > 48) return null;
  if (/^F[\s-]/i.test(suffix)) return suffix;
  if (/^[A-Z]{1,4}(\s[A-Z0-9-]{1,12}){1,4}$/i.test(suffix)) return suffix.toUpperCase();
  return null;
}

function looksLikeCityOnly(text: string): boolean {
  const normalized = normalizeStatus(text);
  if (!normalized || normalized.length > 60) return false;
  if (/(coleta|chave|dc-e|dce emit|emitid|postad|entreg|cancel|pagamento|consultando|atualizado ao consultar)/.test(normalized)) {
    return false;
  }
  return /[a-z]/.test(normalized);
}

export function isSyntheticTrackingNote(text: unknown): boolean {
  const normalized = normalizeStatus(text);
  return normalized.includes("status atualizado ao consultar") || normalized.includes("consultando rastreio");
}

function firstLocationRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const rec = asPlainRecord(value);
    if (Object.keys(rec).length > 0) return rec;
  }
  return {};
}

function looksLikeFacilityCode(text: string): boolean {
  const value = String(text || "").trim();
  if (!value || value.length > 48) return false;
  if (/^F[\s-]/i.test(value)) return true;
  return /^[A-Z]{1,4}(\s[A-Z0-9-]{1,12}){1,4}$/.test(value);
}

export function normalizeHistoryEvent(raw: unknown): EnvioEcomHistoryEvent | null {
  const item = asPlainRecord(raw);
  const nestedLocation = firstLocationRecord(
    item.location,
    item.local,
    item.localizacao,
    item.address,
    item.endereco,
  );
  const status = pickText(item.status, item.event, item.title, item.situacao, item.name);
  if (!status) return null;

  const nestedName = pickText(nestedLocation.name, nestedLocation.label, nestedLocation.title);
  const nestedNameIsFacility = nestedName ? looksLikeFacilityCode(nestedName) : false;

  const city = pickText(
    item.cidade,
    item.city,
    item.city_name,
    item.cityName,
    item.municipio,
    item.localidade,
    nestedLocation.cidade,
    nestedLocation.city,
    nestedLocation.city_name,
    nestedLocation.cityName,
    nestedLocation.municipio,
    nestedLocation.localidade,
    nestedNameIsFacility ? null : nestedName,
  );
  const unit = pickText(
    item.unidade,
    item.unit,
    item.agency,
    item.agencia,
    item.facility,
    nestedLocation.unidade,
    nestedLocation.unit,
    nestedLocation.agency,
    nestedLocation.agencia,
    nestedLocation.facility,
    nestedNameIsFacility ? nestedName : null,
    extractUnitSuffix(status),
  );
  let location = pickText(
    typeof item.location === "object" ? null : item.location,
    typeof item.local === "object" ? null : item.local,
    typeof item.localizacao === "object" ? null : item.localizacao,
    item.origin,
    item.origem,
  );
  if (!location && nestedName && nestedName.includes(" - ") && looksLikeCityOnly(nestedName.split(" - ")[0] || "")) {
    location = nestedName;
  }
  if (!location && city && unit && !normalizeStatus(city).includes(normalizeStatus(unit))) {
    location = `${city} - ${unit}`;
  } else if (!location && city) {
    location = city;
  }

  let description = pickText(item.description, item.details, item.detail, item.observacao, item.message);
  if (description && sameTrackingText(description, status)) description = null;
  if (description && location && sameTrackingText(description, location)) description = null;
  if (!location && description && looksLikeCityOnly(description) && !sameTrackingText(description, status)) {
    location = unit && !normalizeStatus(description).includes(normalizeStatus(unit))
      ? `${description} - ${unit}`
      : description;
    description = null;
  }
  if (location && sameTrackingText(location, status)) location = null;
  if (isSyntheticTrackingNote(description)) description = null;

  return {
    at: pickText(
      item.updated_at,
      item.created_at,
      item.date,
      item.data,
      item.datetime,
      item.data_hora,
      item.at,
      item.timestamp,
    ) || new Date().toISOString(),
    status,
    location: location || null,
    description: description || null,
    barcode: pickText(item.barcode),
  };
}

export function extractStatusHistoryFromShipment(payload: unknown): EnvioEcomHistoryEvent[] {
  const root = asPlainRecord(payload);
  const nested = asPlainRecord(
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? root.data
      : root.shipment && typeof root.shipment === "object" && !Array.isArray(root.shipment)
        ? root.shipment
        : root,
  );
  const tracking = asPlainRecord(nested.tracking);
  const raw = Array.isArray(nested.status_history)
    ? nested.status_history
    : Array.isArray(nested.events)
      ? nested.events
      : Array.isArray(nested.tracking_history)
        ? nested.tracking_history
        : Array.isArray(nested.historico)
          ? nested.historico
          : Array.isArray(tracking.status_history)
            ? tracking.status_history
            : Array.isArray(tracking.events)
              ? tracking.events
              : Array.isArray(root.status_history)
                ? root.status_history
                : [];
  const events: EnvioEcomHistoryEvent[] = [];
  for (const row of raw) {
    const event = normalizeHistoryEvent(row);
    if (event) events.push(event);
  }
  return sortHistoryOldestFirst(events).slice(-30);
}

/** Unix (s ou ms), ISO e dd/mm/aaaa hh:mm:ss. Date.parse não lê a data brasileira. */
export function historyEventTimeMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return 0;
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = br;
    const parsed = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortHistoryOldestFirst(events: EnvioEcomHistoryEvent[]): EnvioEcomHistoryEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const delta = historyEventTimeMs(a.event.at) - historyEventTimeMs(b.event.at);
      if (delta !== 0) return delta;
      return a.index - b.index;
    })
    .map(({ event }) => event);
}

export function resolveEnvioEcomStoredStatus(
  apiStatus: unknown,
  history: EnvioEcomHistoryEvent[] | null | undefined,
): string {
  const api = String(apiStatus || "").trim();
  const sorted = sortHistoryOldestFirst(history || []);
  const newest = String(sorted[sorted.length - 1]?.status || "").trim();
  if (!newest) return api;
  if (envioecomTrackingRank(newest) >= envioecomTrackingRank(api)) return newest;
  return api || newest;
}

export function mergeEnvioEcomHistory(
  current: unknown,
  incoming: EnvioEcomHistoryEvent[] | null | undefined,
  fallback?: EnvioEcomHistoryEvent | null,
  limit = 30,
): EnvioEcomHistoryEvent[] {
  const merged = incoming && incoming.length >= 2
    ? incoming.slice()
    : incoming && incoming.length === 1
      ? appendStatusHistory(current, incoming[0], limit)
      : fallback && fallback.status && !isSyntheticTrackingNote(fallback.description)
        ? appendStatusHistory(current, fallback, limit)
        : parseStoredHistory(current);
  return sortHistoryOldestFirst(merged).slice(-limit);
}

function parseStoredHistory(current: unknown): EnvioEcomHistoryEvent[] {
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
      location: item.location ? String(item.location) : null,
      description: item.description ? String(item.description) : null,
      barcode: item.barcode ? String(item.barcode) : null,
    });
  }
  return history;
}

export function trackingHistoryMissingLocation(current: unknown): boolean {
  const history = parseStoredHistory(current);
  if (!history.length) return true;
  return history.some((event) => !String(event.location || "").trim());
}

export function trackingEventsNewestFirst(current: unknown, limit = 80): EnvioEcomHistoryEvent[] {
  const chrono = parseStoredHistory(current).slice(-limit);
  return chrono
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const delta = historyEventTimeMs(b.event.at) - historyEventTimeMs(a.event.at);
      if (delta !== 0) return delta;
      return b.index - a.index;
    })
    .map(({ event }) => event);
}

export function appendStatusHistory(
  current: unknown,
  event: EnvioEcomHistoryEvent,
  limit = 30,
): EnvioEcomHistoryEvent[] {
  const history = parseStoredHistory(current);
  if (!event?.status) return history.slice(-limit);

  const last = history[history.length - 1];
  if (last && last.status === event.status && last.barcode === (event.barcode || null)) {
    if (!last.location && event.location) {
      history[history.length - 1] = {
        ...last,
        location: event.location,
        description: event.description ?? last.description,
      };
    }
    return history.slice(-limit);
  }

  history.push({
    at: event.at,
    status: event.status,
    location: event.location || null,
    description: event.description || null,
    barcode: event.barcode || null,
  });
  return history.slice(-limit);
}
