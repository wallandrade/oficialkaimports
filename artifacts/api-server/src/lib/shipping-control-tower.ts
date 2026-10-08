import { historyEventTimeMs } from "./envioecom-status";

export const TOWER_PERIODS = ["open", "today", "7", "30", "60"] as const;

export type TowerPeriod = (typeof TOWER_PERIODS)[number];

export type TowerKind =
  | "extravio"
  | "avaria"
  | "retencao"
  | "endereco"
  | "destinatario_ausente"
  | "devolucao"
  | "aguardando_retirada";

export type TowerKindDef = {
  kind: TowerKind;
  severity: number;
  label: string;
  action: string;
};

export const TOWER_KINDS: TowerKindDef[] = [
  { kind: "extravio", severity: 70, label: "Extravio", action: "Acionar a transportadora para indenização" },
  { kind: "avaria", severity: 60, label: "Avaria", action: "Acionar a transportadora para indenização" },
  { kind: "retencao", severity: 50, label: "Retenção", action: "Acompanhar a liberação" },
  { kind: "endereco", severity: 40, label: "Problema de endereço", action: "Corrigir o endereço e pedir nova tentativa" },
  { kind: "destinatario_ausente", severity: 30, label: "Destinatário ausente", action: "Entrar em contato com o cliente" },
  { kind: "devolucao", severity: 20, label: "Devolução", action: "Acompanhar a devolução" },
  { kind: "aguardando_retirada", severity: 10, label: "Aguardando retirada", action: "Acompanhar a retirada" },
];

const KIND_BY_CODE = new Map(TOWER_KINDS.map((item) => [item.kind, item]));

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 200;

export type TowerCandidate = {
  orderId: string;
  packageId?: string | null;
  orderNumber?: number | null;
  clientName?: string | null;
  clientPhone?: string | null;
  trackingCode?: string | null;
  barcode?: string | null;
  shipmentId?: number | null;
  carrierRaw?: string | null;
  status?: string | null;
  statusUpdatedAt?: string | Date | null;
  history?: unknown;
};

export type TowerItem = {
  orderId: string;
  packageId: string | null;
  orderNumber: number | null;
  clientName: string | null;
  clientPhone: string | null;
  trackingCode: string;
  barcode: string | null;
  carrier: string;
  kind: TowerKind;
  kindLabel: string;
  action: string;
  status: string;
  statusUpdatedAt: string | null;
};

export type TowerResponse = {
  ok: true;
  period: TowerPeriod;
  since: string;
  occurrences: number;
  byCarrier: Array<{ carrier: string; count: number; percent: number }>;
  byKind: Array<{ kind: TowerKind; label: string; count: number; percent: number }>;
  items: TowerItem[];
  listTruncated: boolean;
};

export function foldTowerText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function towerCarrierDisplay(value: unknown): string {
  const stripped = String(value ?? "")
    .replace(/\benvioecom\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || "Sem transportadora";
}

export function towerCarrierKey(value: unknown): string {
  return foldTowerText(towerCarrierDisplay(value)).replace(/\s+/g, " ").trim();
}

export function hasTowerBinding(row: Pick<TowerCandidate, "barcode" | "shipmentId" | "status">): boolean {
  if (String(row.barcode || "").trim()) return true;
  if (Number(row.shipmentId) > 0) return true;
  if (String(row.status || "").trim()) return true;
  return false;
}

export function resolveTowerPeriod(raw: unknown, now = new Date()): { period: TowerPeriod; since: Date } {
  const text = String(raw ?? "").trim().toLowerCase();
  const period: TowerPeriod = (TOWER_PERIODS as readonly string[]).includes(text) ? text as TowerPeriod : "open";
  if (period === "today") return { period, since: saoPauloMidnight(now) };
  const days = period === "7" ? 7 : period === "30" ? 30 : period === "60" ? 60 : 90;
  return { period, since: new Date(now.getTime() - days * DAY_MS) };
}

function saoPauloMidnight(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return new Date(`${year}-${month}-${day}T00:00:00-03:00`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const HISTORY_DATE_KEYS = ["at", "updated_at", "created_at", "date", "data", "datetime", "data_hora", "timestamp"];

function eventDateMs(item: Record<string, unknown>): number {
  for (const key of HISTORY_DATE_KEYS) {
    const ms = historyEventTimeMs(item[key]);
    if (ms > 0) return ms;
  }
  return 0;
}

export function parseTowerHistory(raw: unknown): Record<string, unknown>[] {
  let value = raw;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item): item is Record<string, unknown> => item != null);
}

/** Último item da lista. Um anterior só substitui se os dois tiverem data e a anterior for mais nova. */
export function pickCurrentHistoryEvent(raw: unknown): Record<string, unknown> | null {
  const list = parseTowerHistory(raw);
  if (!list.length) return null;
  const last = list[list.length - 1];
  const lastMs = eventDateMs(last);
  if (!lastMs) return last;
  let best = last;
  let bestMs = lastMs;
  for (let index = 0; index < list.length - 1; index += 1) {
    const ms = eventDateMs(list[index]);
    if (!ms || ms <= bestMs) continue;
    best = list[index];
    bestMs = ms;
  }
  return best;
}

function eventStatus(item: Record<string, unknown> | null): string {
  return String(item?.status || "").trim();
}

function eventDescription(item: Record<string, unknown> | null): string {
  return String(item?.description || "").trim();
}

export function isTowerDeliveredText(value: unknown): boolean {
  return foldTowerText(value).includes("entregue");
}

export function isTowerCancelledText(value: unknown): boolean {
  const folded = foldTowerText(value);
  if (folded.includes("cancelad")) return true;
  const waiting = folded.indexOf("aguardando");
  if (waiting < 0) return false;
  return folded.indexOf("cancelamento", waiting + "aguardando".length) >= 0;
}

function hasRetido(folded: string): boolean {
  const pattern = /\bretido\b/g;
  for (const match of folded.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (folded.slice(Math.max(0, index - 4), index) === "nao ") continue;
    return true;
  }
  return false;
}

function matchesKind(kind: TowerKind, folded: string): boolean {
  if (!folded) return false;
  if (kind === "extravio") return /extravi|roub|furt|sinistro/.test(folded);
  if (kind === "avaria") return /avaria|danific/.test(folded);
  if (kind === "retencao") {
    return /apreens|apreendid|retencao|receita federal/.test(folded) || hasRetido(folded);
  }
  if (kind === "endereco") {
    return /endereco\s+(insuficiente|incorreto|errado|inexistente|incompleto|nao)/.test(folded)
      || folded.includes("problema de endereco")
      || folded.includes("numero inexistente")
      || /mudou-se|mudou se/.test(folded)
      || folded.includes("destinatario desconhecido");
  }
  if (kind === "destinatario_ausente") return /\bausente\b/.test(folded);
  if (kind === "devolucao") return /devolvid|devolucao/.test(folded);
  return /retirada|retirar/.test(folded) && /aguardando|disponivel|agencia/.test(folded);
}

function matchText(value: unknown): TowerKindDef | null {
  const folded = foldTowerText(value).trim();
  if (!folded) return null;
  for (const kind of TOWER_KINDS) {
    if (matchesKind(kind.kind, folded)) return kind;
  }
  return null;
}

export function classifyTowerOccurrence(
  status: unknown,
  history: unknown,
): TowerKindDef | null {
  if (isTowerDeliveredText(status) || isTowerCancelledText(status)) return null;
  const current = pickCurrentHistoryEvent(history);
  const lastStatus = eventStatus(current);
  if (isTowerDeliveredText(lastStatus) || isTowerCancelledText(lastStatus)) return null;
  let best: TowerKindDef | null = null;
  for (const text of [status, lastStatus, eventDescription(current)]) {
    const hit = matchText(text);
    if (!hit) continue;
    if (!best || hit.severity > best.severity) best = hit;
  }
  return best;
}

export function towerShownCode(row: TowerCandidate): string {
  const barcode = String(row.barcode || "").trim();
  const shipmentId = Number(row.shipmentId) > 0 ? String(Math.trunc(Number(row.shipmentId))) : "";
  if (row.packageId) return barcode || shipmentId;
  return String(row.trackingCode || "").trim() || barcode || shipmentId;
}

function toIso(value: TowerCandidate["statusUpdatedAt"]): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? value.toISOString() : null;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function selectTowerLabels(
  orders: TowerCandidate[],
  packages: TowerCandidate[],
  packageCounts?: ReadonlyMap<string, number> | null,
): TowerCandidate[] {
  const ordersById = new Map<string, TowerCandidate>();
  for (const order of orders) {
    if (!order.orderId || ordersById.has(order.orderId)) continue;
    ordersById.set(order.orderId, order);
  }
  const packagesByOrder = new Map<string, TowerCandidate[]>();
  for (const pkg of packages) {
    if (!pkg.orderId) continue;
    const list = packagesByOrder.get(pkg.orderId) || [];
    if (pkg.packageId && list.some((item) => item.packageId === pkg.packageId)) continue;
    list.push(pkg);
    packagesByOrder.set(pkg.orderId, list);
  }
  const selected: TowerCandidate[] = [];
  for (const orderId of new Set([...ordersById.keys(), ...packagesByOrder.keys()])) {
    const seen = packagesByOrder.get(orderId) || [];
    const recorded = packageCounts?.has(orderId) ? Number(packageCounts.get(orderId)) : Number.NaN;
    const total = Number.isFinite(recorded) ? recorded : seen.length;
    if (total >= 2) {
      for (const pkg of seen) {
        if (hasTowerBinding(pkg)) selected.push(pkg);
      }
      continue;
    }
    const order = ordersById.get(orderId);
    if (order && hasTowerBinding(order)) selected.push({ ...order, packageId: null });
  }
  return selected;
}

function percent(count: number, total: number): number {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function classifySelected(rows: TowerCandidate[]): TowerItem[] {
  const items: TowerItem[] = [];
  for (const row of rows) {
    if (!hasTowerBinding(row)) continue;
    const kind = classifyTowerOccurrence(row.status, row.history);
    if (!kind) continue;
    const updated = toIso(row.statusUpdatedAt);
    items.push({
      orderId: row.orderId,
      packageId: row.packageId ? String(row.packageId) : null,
      orderNumber: row.orderNumber != null && Number.isFinite(Number(row.orderNumber)) ? Math.trunc(Number(row.orderNumber)) : null,
      clientName: row.clientName ?? null,
      clientPhone: row.clientPhone ?? null,
      trackingCode: towerShownCode(row),
      barcode: String(row.barcode || "").trim() || null,
      carrier: towerCarrierDisplay(row.carrierRaw),
      kind: kind.kind,
      kindLabel: kind.label,
      action: kind.action,
      status: String(row.status || "").trim(),
      statusUpdatedAt: updated,
    });
  }
  return items;
}

function sortItems(items: TowerItem[]): TowerItem[] {
  return [...items].sort((left, right) => {
    const leftMs = left.statusUpdatedAt ? Date.parse(left.statusUpdatedAt) : Number.NaN;
    const rightMs = right.statusUpdatedAt ? Date.parse(right.statusUpdatedAt) : Number.NaN;
    const leftMissing = !Number.isFinite(leftMs);
    const rightMissing = !Number.isFinite(rightMs);
    if (leftMissing && rightMissing) return left.orderId.localeCompare(right.orderId);
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    if (leftMs !== rightMs) return leftMs - rightMs;
    return left.orderId.localeCompare(right.orderId);
  });
}

export function buildControlTower(input: {
  periodRaw?: unknown;
  carrierRaw?: unknown;
  kindRaw?: unknown;
  now?: Date;
  orders?: TowerCandidate[];
  packages?: TowerCandidate[];
  packageCounts?: ReadonlyMap<string, number> | null;
}): TowerResponse {
  const { period, since } = resolveTowerPeriod(input.periodRaw, input.now);
  const classified = classifySelected(selectTowerLabels(
    input.orders || [],
    input.packages || [],
    input.packageCounts,
  ));
  const occurrences = classified.length;
  const carrierCounts = new Map<string, { carrier: string; count: number }>();
  for (const item of classified) {
    const key = towerCarrierKey(item.carrier);
    const current = carrierCounts.get(key);
    if (current) current.count += 1;
    else carrierCounts.set(key, { carrier: item.carrier, count: 1 });
  }
  const byCarrier = [...carrierCounts.values()]
    .sort((left, right) => right.count - left.count || left.carrier.localeCompare(right.carrier, "pt-BR"))
    .map((row) => ({ ...row, percent: percent(row.count, occurrences) }));

  const kindCounts = new Map<TowerKind, number>();
  for (const item of classified) kindCounts.set(item.kind, (kindCounts.get(item.kind) || 0) + 1);
  const byKind = [...kindCounts.entries()]
    .map(([kind, count]) => {
      const def = KIND_BY_CODE.get(kind)!;
      return { kind, label: def.label, count, percent: percent(count, occurrences) };
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "pt-BR"));

  const carrierFilter = String(input.carrierRaw || "").trim() ? towerCarrierKey(input.carrierRaw) : "";
  const kindText = String(input.kindRaw || "").trim();
  const kindFilter = KIND_BY_CODE.has(kindText as TowerKind) ? kindText as TowerKind : "";
  const filtered = classified.filter((item) => {
    if (carrierFilter && towerCarrierKey(item.carrier) !== carrierFilter) return false;
    if (kindFilter && item.kind !== kindFilter) return false;
    return true;
  });
  const sorted = sortItems(filtered);
  return {
    ok: true,
    period,
    since: since.toISOString(),
    occurrences,
    byCarrier,
    byKind,
    items: sorted.slice(0, LIST_LIMIT),
    listTruncated: sorted.length > LIST_LIMIT,
  };
}
