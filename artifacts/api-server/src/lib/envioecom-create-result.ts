export type CreatedShipmentPatch = {
  shipmentId?: number | null;
  barcode?: string | null;
  trackingKey?: string | null;
  deliveryMode?: string | null;
  status?: string | null;
  freightCost?: string | number | null;
  externalOrderNumber?: string | null;
};

export type EnvioEcomCreateSummary = {
  outcome: "ok" | "error" | "empty" | "unparsed";
  keys: string[];
  resultsCount: number | null;
  errorCode: string | null;
  hasShipmentId: boolean;
  hasBarcode: boolean;
};

export type CreatedShipmentAssessment = {
  ok: boolean;
  patch: CreatedShipmentPatch;
  message: string;
  summary: EnvioEcomCreateSummary;
};

const FALLBACK_MESSAGE = "A EnvioEcom não devolveu o código do envio. Nada foi salvo.";
const EMPTY_MESSAGE = "A EnvioEcom respondeu sem criar o envio. Nada foi salvo.";

const PII_KEY = /(?:^|_)(?:name|nome|document|documento|cpf|cnpj|phone|telefone|celular|email|mail|logradouro|street|address|endereco|bairro|neighborhood|complemento|cidade|city|localidade|cep|zip|token|password|senha)(?:_|$)/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value == null || typeof value === "object") continue;
    if (typeof value === "string" && !/^\d+$/.test(value.trim())) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return null;
}

function barcodeFrom(row: Record<string, unknown>): string | null {
  return pickString(
    row.barcode,
    row.tracking_code,
    row.trackingCode,
    row.codigo_rastreio,
    row.codigo,
    row.tracking,
  );
}

function shipmentIdFrom(row: Record<string, unknown>): number | null {
  return pickNumber(row.shipping_id, row.shipment_id, row.shipmentId, row.id);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item == null || typeof item === "object" ? "" : String(item).trim()))
    .filter(Boolean);
}

function pushRecords(target: Record<string, unknown>[], value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) pushRecords(target, item);
    return;
  }
  const row = asRecord(value);
  if (Object.keys(row).length) target.push(row);
}

function resultArrays(root: Record<string, unknown>): unknown[] {
  const shipping = asRecord(root.shipping_create);
  return [shipping.results, shipping.shipments, root.results, root.shipments];
}

function resultsMeta(root: Record<string, unknown>): { sawArray: boolean; empty: boolean; count: number | null } {
  let sawArray = false;
  let empty = false;
  let count: number | null = null;
  for (const value of resultArrays(root)) {
    if (!Array.isArray(value)) continue;
    sawArray = true;
    if (count == null) count = value.length;
    if (value.length === 0) empty = true;
    else return { sawArray: true, empty: false, count: value.length };
  }
  return { sawArray, empty: sawArray && empty, count };
}

function candidates(root: Record<string, unknown>): Record<string, unknown>[] {
  const shipping = asRecord(root.shipping_create);
  const rows: Record<string, unknown>[] = [];
  for (const value of resultArrays(root)) pushRecords(rows, value);
  pushRecords(rows, shipping.data);
  pushRecords(rows, shipping.shipment);
  pushRecords(rows, shipping.shipping);
  pushRecords(rows, root.data);
  pushRecords(rows, root.shipment);
  pushRecords(rows, root.shipping);
  if (Object.keys(shipping).length) rows.push(shipping);
  rows.push(root);
  return rows;
}

function errorCodeOf(value: unknown): string | null {
  const row = asRecord(value);
  const code = pickString(row.code, row.error_code, row.errorCode);
  if (code && /^[A-Za-z0-9_.:-]{1,64}$/.test(code)) return code.slice(0, 64);
  return null;
}

function errorText(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null || value === false) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return null;
  if (Array.isArray(value)) {
    const parts = value.map((item) => errorText(item, depth + 1)).filter((item): item is string => !!item);
    return parts.length ? parts.join("; ") : null;
  }
  const row = asRecord(value);
  if (!Object.keys(row).length) return null;
  const code = errorCodeOf(row);
  const message = pickString(row.message, row.msg, row.reason, row.description);
  if (code || message) return [code, message].filter(Boolean).join(": ");
  if ("error" in row) return errorText(row.error, depth + 1);
  return null;
}

function statusIsError(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return value >= 400;
  const text = String(value || "").trim().toLowerCase();
  return text === "error" || text === "erro" || text === "failed" || text === "failure";
}

function explicitError(row: Record<string, unknown>): string | null {
  if (row.success === false || row.ok === false || statusIsError(row.status) || statusIsError(row.statusCode)) {
    return errorText(row.error) || errorText(row.errors) || errorText(row.message) || "A EnvioEcom recusou o envio.";
  }
  return errorText(row.error) || errorText(row.errors);
}

function looseErrorEnvelope(row: Record<string, unknown>): string | null {
  const code = pickString(row.code);
  const message = pickString(row.message);
  if (!code || !message) return null;
  if (shipmentIdFrom(row) || barcodeFrom(row)) return null;
  return `${code}: ${message}`;
}

function looksLikeErrorCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(value) && value.includes("_");
}

function codeFromText(value: string | null): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (looksLikeErrorCode(text)) return text;
  const match = text.match(/^([A-Z][A-Z0-9_]{2,63})\s*[:—-]\s+\S/);
  if (match && looksLikeErrorCode(match[1])) return match[1];
  return null;
}

function stringError(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return errorText(value);
}

function firstResultItem(root: Record<string, unknown>): Record<string, unknown> | null {
  const shipping = asRecord(root.shipping_create);
  for (const list of [shipping.results, root.results]) {
    if (!Array.isArray(list) || list.length === 0) continue;
    return asRecord(list[0]);
  }
  return null;
}

function itemHasShipment(item: Record<string, unknown> | null): boolean {
  if (!item) return false;
  return shipmentIdFrom(item) != null || !!barcodeFrom(item);
}

type RefusalDetail = {
  sentence: string | null;
  errorCode: string | null;
  payment: string | null;
  paymentCode: string | null;
};

function pushUnique(target: string[], value: string | null) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  const index = target.findIndex((item) => item === text || item.includes(text) || text.includes(item));
  if (index === -1) {
    target.push(text);
    return;
  }
  if (text.length > target[index].length) target[index] = text;
}

function paymentFailure(root: Record<string, unknown>): { text: string | null; code: string | null } {
  const payment = asRecord(root.payment_processing);
  let code = errorCodeOf(payment) || errorCodeOf(payment.error);
  if (!code && Array.isArray(payment.errors)) {
    for (const item of payment.errors) {
      code = errorCodeOf(item) || codeFromText(typeof item === "string" ? item : errorText(item));
      if (code) break;
    }
  }
  if (!code) code = codeFromText(errorText(payment.errors)) || codeFromText(stringError(payment.error));
  const parts: string[] = [];
  pushUnique(parts, errorText(payment.errors));
  pushUnique(parts, stringError(payment.error));
  pushUnique(parts, pickString(payment.message));
  return { text: parts.length ? parts.join(" — ") : null, code };
}

function refusalDetail(root: Record<string, unknown>): RefusalDetail {
  const shipping = asRecord(root.shipping_create);
  const batchRejected = shipping.success === false || root.success === false;
  const item = firstResultItem(root);
  const useItem = !!item && (batchRejected || !itemHasShipment(item));
  let sentence: string | null = null;
  let errorCode: string | null = null;
  if (useItem && item) {
    errorCode = errorCodeOf(item);
    if ("error" in item && item.error != null && item.error !== false && item.error !== "") {
      sentence = stringError(item.error);
    }
    if (!sentence) sentence = pickString(item.message, item.msg) || errorText(item.errors);
    if (!errorCode) errorCode = codeFromText(sentence);
  }
  const payment = paymentFailure(root);
  const noShipment = batchRejected || !itemHasShipment(item);
  if (!errorCode && noShipment) errorCode = payment.code;
  return {
    sentence,
    errorCode,
    payment: noShipment ? payment.text : null,
    paymentCode: noShipment ? payment.code : null,
  };
}

function hasRefusal(detail: RefusalDetail): boolean {
  return !!(detail.sentence || detail.payment || detail.errorCode || detail.paymentCode);
}

const REFUSAL_LEAD = "A EnvioEcom recusou o envio";

function refusalMessage(fallback: string | null, detail: RefusalDetail): string {
  const parts: string[] = [];
  pushUnique(parts, detail.sentence);
  if (detail.errorCode) pushUnique(parts, detail.errorCode);
  pushUnique(parts, detail.payment);
  if (detail.paymentCode && detail.paymentCode !== detail.errorCode) pushUnique(parts, detail.paymentCode);
  if (!parts.length) return fallback || `${REFUSAL_LEAD}.`;
  const body = parts.join(" — ");
  if (body.startsWith(REFUSAL_LEAD)) return body;
  return `${REFUSAL_LEAD}: ${body}`;
}

function collectPiiValues(value: unknown, key: string, depth: number, found: string[]) {
  if (depth > 6 || found.length > 40) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length >= 3 && PII_KEY.test(key)) found.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPiiValues(item, key, depth + 1, found);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    collectPiiValues(child, childKey, depth + 1, found);
  }
}

export function safeEnvioEcomPublicMessage(raw: string | null | undefined, payload?: unknown, fallback = FALLBACK_MESSAGE): string {
  let text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  const hidden: string[] = [];
  if (payload) collectPiiValues(payload, "", 0, hidden);
  const unique = Array.from(new Set(hidden)).sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    if (secret.length < 3) continue;
    text = text.split(secret).join("[oculto]");
  }
  text = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[oculto]")
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, "[oculto]")
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, "[oculto]")
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}-?\d{4}/g, "[oculto]")
    .replace(/\b\d{5}-?\d{3}\b/g, "[oculto]")
    .replace(/\b\d{11,}\b/g, "[oculto]")
    .replace(/\b(?:bearer|token|senha|password)\b\s*[:=]?\s*\S+/gi, "[oculto]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "[oculto]") return fallback;
  if (text.length > 280) return `${text.slice(0, 277)}...`;
  return text;
}

function patchFrom(row: Record<string, unknown>, root: Record<string, unknown>): CreatedShipmentPatch {
  const shipping = asRecord(root.shipping_create);
  const barcodes = [
    ...stringList(root.processed_barcodes),
    ...stringList(shipping.processed_barcodes),
  ];
  const adjustments = Array.isArray(root.freight_adjustments) ? root.freight_adjustments : [];
  const adjustment = asRecord(adjustments[0]);
  return {
    shipmentId: shipmentIdFrom(row),
    barcode: barcodeFrom(row) || barcodes[0] || null,
    trackingKey: pickString(row.tracking_key, row.trackingKey),
    deliveryMode: pickString(row.delivery_mode, row.shipping_company, row.carrier),
    status: pickString(row.status),
    freightCost: pickString(adjustment.current, adjustment.freight_cost, row.freight_cost, row.cost),
    externalOrderNumber: pickString(row.orderId, row.external_order_number, row.order_id),
  };
}

function topLevelKeys(root: Record<string, unknown>): string[] {
  return Object.keys(root)
    .filter((key) => !PII_KEY.test(key) && !/token|password|senha|authorization/i.test(key))
    .slice(0, 24);
}

function summaryOf(
  root: Record<string, unknown>,
  outcome: EnvioEcomCreateSummary["outcome"],
  patch: CreatedShipmentPatch,
  errorCode: string | null,
  resultsCount: number | null,
): EnvioEcomCreateSummary {
  return {
    outcome,
    keys: topLevelKeys(root),
    resultsCount,
    errorCode,
    hasShipmentId: Number(patch.shipmentId || 0) > 0,
    hasBarcode: !!String(patch.barcode || "").trim(),
  };
}

export function parseCreatedShipment(payload: unknown): CreatedShipmentPatch {
  const assessed = assessCreatedShipment(payload);
  return assessed.patch;
}

export function assessCreatedShipment(payload: unknown): CreatedShipmentAssessment {
  const root = asRecord(payload);
  const meta = resultsMeta(root);
  const emptyPatch: CreatedShipmentPatch = {};
  const shipping = asRecord(root.shipping_create);
  const detail = refusalDetail(root);
  const topError = explicitError(root) || explicitError(shipping);
  if (topError) {
    const raw = hasRefusal(detail) ? refusalMessage(topError, detail) : topError;
    return {
      ok: false,
      patch: emptyPatch,
      message: safeEnvioEcomPublicMessage(raw, payload),
      summary: summaryOf(
        root,
        "error",
        emptyPatch,
        detail.errorCode || errorCodeOf(root.error) || errorCodeOf(shipping.error),
        meta.count,
      ),
    };
  }

  let itemError: string | null = null;
  for (const row of candidates(root)) {
    if (row === root || row === shipping) {
      if (!shipmentIdFrom(row) && !barcodeFrom(row)) continue;
    }
    const rowError = errorText(row.error) || errorText(row.errors);
    const patch = patchFrom(row, root);
    const hasId = Number(patch.shipmentId || 0) > 0;
    const hasCode = !!String(patch.barcode || "").trim();
    if (rowError && !hasId && !hasCode) {
      itemError = itemError || rowError;
      continue;
    }
    if (rowError && (hasId || hasCode)) {
      return {
        ok: false,
        patch: emptyPatch,
        message: safeEnvioEcomPublicMessage(rowError, payload),
        summary: summaryOf(root, "error", emptyPatch, errorCodeOf(row) || errorCodeOf(row.error), meta.count),
      };
    }
    if (hasId || hasCode) {
      return {
        ok: true,
        patch,
        message: "",
        summary: summaryOf(root, "ok", patch, null, meta.count),
      };
    }
  }

  const looseBarcode = stringList(root.processed_barcodes)[0]
    || stringList(asRecord(root.shipping_create).processed_barcodes)[0]
    || null;
  if (looseBarcode && !itemError) {
    const patch = patchFrom({ barcode: looseBarcode }, root);
    return {
      ok: true,
      patch,
      message: "",
      summary: summaryOf(root, "ok", patch, null, meta.count),
    };
  }

  const envelope = looseErrorEnvelope(root) || looseErrorEnvelope(shipping);
  const merged: RefusalDetail = { ...detail, sentence: detail.sentence || itemError };
  const refused = hasRefusal(merged);
  const outcome = refused || envelope ? "error" : (meta.empty ? "empty" : "unparsed");
  const rawMessage = refused
    ? refusalMessage(null, merged)
    : (envelope || (meta.empty ? EMPTY_MESSAGE : FALLBACK_MESSAGE));
  return {
    ok: false,
    patch: emptyPatch,
    message: refused || envelope ? safeEnvioEcomPublicMessage(rawMessage, payload, rawMessage) : rawMessage,
    summary: summaryOf(root, outcome, emptyPatch, merged.errorCode || errorCodeOf(root) || errorCodeOf(shipping), meta.count),
  };
}
