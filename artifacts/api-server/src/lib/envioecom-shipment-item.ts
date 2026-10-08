export const SHIPMENT_ITEM_QTY_MAX = 999;
export const SHIPMENT_ITEM_POOL_MAX = 30;
export const SHIPMENT_ITEM_MONEY_MAX = 3000;
export const SHIPMENT_ITEM_NAME_MAX = 120;
export const DEFAULT_SHIPMENT_ITEM_NAME = "Mercadoria";
export const DEFAULT_SHIPMENT_ITEM_UNIT_COST = 5;

export const SHIPMENT_ITEM_SETTING_KEYS = {
  qty: "envioecom_shipment_item_qty",
  legacyQuantity: "envioecom_shipment_item_quantity",
  pool: "envioecom_shipment_item_pool",
  order: "envioecom_shipment_item_pool_order",
  cursor: "envioecom_shipment_item_pool_cursor",
  valueMin: "envioecom_shipment_item_value_min",
  valueMax: "envioecom_shipment_item_value_max",
  reserveName: "envioecom_shipment_item_name",
  reserveValue: "envioecom_shipment_item_unit_cost",
} as const;

/** Catálogo fixo do botão “Usar 20 sugestões”. Sem faixa, cada linha usa o próprio declaredValue. */
export const SUGGESTED_LABEL_OPTIONS = [
  { name: "Peça sensor painel Land Rover", declaredValue: 902.68 },
  { name: "Peça sensor Camaro 2026", declaredValue: 930.43 },
  { name: "Peça sensor placa Range Rover", declaredValue: 814.46 },
  { name: "Peça botão painel BMW", declaredValue: 985.3 },
  { name: "Peça sensor estacionamento Mercedes", declaredValue: 876.2 },
  { name: "Peça emblema grade Porsche", declaredValue: 941.15 },
  { name: "Peça sensor chuva Audi", declaredValue: 858.9 },
  { name: "Peça chave canivete Bentley", declaredValue: 967.4 },
  { name: "Peça conector módulo Jaguar", declaredValue: 823.75 },
  { name: "Peça botão vidro Lexus", declaredValue: 912.08 },
  { name: "Peça sensor pressão pneu Maserati", declaredValue: 889.55 },
  { name: "Peça relé pequeno Ferrari", declaredValue: 954.12 },
  { name: "Peça sensor temperatura Rolls-Royce", declaredValue: 837.6 },
  { name: "Peça interruptor painel Lamborghini", declaredValue: 978.25 },
  { name: "Peça sensor ABS Porsche", declaredValue: 865.33 },
  { name: "Peça moldura botão Mercedes", declaredValue: 921.7 },
  { name: "Peça sensor ré Audi", declaredValue: 848.19 },
  { name: "Peça atuador trava BMW", declaredValue: 993.8 },
  { name: "Peça capa chave Land Rover", declaredValue: 806.42 },
  { name: "Peça sensor luz RAM", declaredValue: 917.55 },
] as const;

export class ShipmentItemConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipmentItemConfigError";
  }
}

export type ShipmentPoolItem = {
  name: string;
  declaredValue: number;
};

export type ShipmentValueRange = {
  min: number;
  max: number;
};

export type ShipmentItemState = {
  quantity: number;
  items: ShipmentPoolItem[];
  range: ShipmentValueRange | null;
  valueMin: string | null;
  valueMax: string | null;
  order: number[];
  cursor: number;
  reserveName: string;
  reserveUnitCost: number;
};

export type PreparedShipmentItemSave = {
  quantity: number;
  items: ShipmentPoolItem[];
  valueMin: string | null;
  valueMax: string | null;
  order: number[];
  cursor: number;
};

export type DrawnShipmentItem = {
  name: string;
  quantity: number;
  unitCost: number;
  consumed: boolean;
  order: number[];
  cursor: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isBlank(value: unknown): boolean {
  return String(value ?? "").trim() === "";
}

export function parseLooseMoney(value: unknown): number {
  const raw = String(value ?? "").trim().replace(/[R$\s]/gi, "");
  if (!raw) return NaN;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function formatShipmentMoney(value: number): string {
  return round2(value).toFixed(2);
}

export function suggestedShipmentItemFixedValue(index: number): number {
  return round2(SUGGESTED_LABEL_OPTIONS[index].declaredValue);
}

export function randomMoneyInclusive(min: number, max: number, random: () => number = Math.random): number {
  const minCents = Math.round(min * 100);
  const maxCents = Math.round(max * 100);
  const low = Math.min(minCents, maxCents);
  const high = Math.max(minCents, maxCents);
  const cents = low + Math.floor(random() * (high - low + 1));
  return cents / 100;
}

export function shuffleIndices(length: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const current = order[i];
    order[i] = order[j];
    order[j] = current;
  }
  return order;
}

export function isIndexPermutation(order: number[], length: number): boolean {
  if (order.length !== length) return false;
  const seen = new Set<number>();
  for (const value of order) {
    if (!Number.isInteger(value) || value < 0 || value >= length || seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseStoredPool(raw: unknown): ShipmentPoolItem[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  const items: ShipmentPoolItem[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const record = row as { name?: unknown; declaredValue?: unknown };
    const name = String(record.name || "").trim().slice(0, SHIPMENT_ITEM_NAME_MAX);
    const value = parseLooseMoney(record.declaredValue);
    if (!name || !Number.isFinite(value) || value < 0 || value > SHIPMENT_ITEM_MONEY_MAX) continue;
    items.push({ name, declaredValue: round2(value) });
    if (items.length >= SHIPMENT_ITEM_POOL_MAX) break;
  }
  return items;
}

export function parseStoredOrder(raw: unknown): number[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
}

export function parseStoredCursor(raw: unknown): number {
  const parsed = Math.trunc(parseLooseMoney(raw));
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

export function parseStoredQuantity(raw: unknown): number {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return 1;
  const parsed = Number(text);
  if (parsed < 1 || parsed > SHIPMENT_ITEM_QTY_MAX) return 1;
  return parsed;
}

function parseReserveName(raw: unknown): string {
  const trimmed = String(raw ?? "").trim().slice(0, SHIPMENT_ITEM_NAME_MAX);
  return trimmed || DEFAULT_SHIPMENT_ITEM_NAME;
}

function parseReserveUnitCost(raw: unknown): number {
  const parsed = parseLooseMoney(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > SHIPMENT_ITEM_MONEY_MAX) return DEFAULT_SHIPMENT_ITEM_UNIT_COST;
  return round2(parsed);
}

function parseRangePair(minRaw: unknown, maxRaw: unknown): ShipmentValueRange | null {
  if (isBlank(minRaw) || isBlank(maxRaw)) return null;
  const min = parseLooseMoney(minRaw);
  const max = parseLooseMoney(maxRaw);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min < 0 || max < 0 || min > SHIPMENT_ITEM_MONEY_MAX || max > SHIPMENT_ITEM_MONEY_MAX) return null;
  if (round2(min) > round2(max)) return null;
  return { min: round2(min), max: round2(max) };
}

export function readShipmentItemState(settings: Record<string, string | undefined>): ShipmentItemState {
  const quantity = parseStoredQuantity(
    settings[SHIPMENT_ITEM_SETTING_KEYS.qty] ?? settings[SHIPMENT_ITEM_SETTING_KEYS.legacyQuantity],
  );
  const items = parseStoredPool(settings[SHIPMENT_ITEM_SETTING_KEYS.pool]);
  const range = parseRangePair(
    settings[SHIPMENT_ITEM_SETTING_KEYS.valueMin],
    settings[SHIPMENT_ITEM_SETTING_KEYS.valueMax],
  );
  return {
    quantity,
    items,
    range,
    valueMin: range ? formatShipmentMoney(range.min) : null,
    valueMax: range ? formatShipmentMoney(range.max) : null,
    order: parseStoredOrder(settings[SHIPMENT_ITEM_SETTING_KEYS.order]),
    cursor: parseStoredCursor(settings[SHIPMENT_ITEM_SETTING_KEYS.cursor]),
    reserveName: parseReserveName(settings[SHIPMENT_ITEM_SETTING_KEYS.reserveName]),
    reserveUnitCost: parseReserveUnitCost(settings[SHIPMENT_ITEM_SETTING_KEYS.reserveValue]),
  };
}

function assertMoneyBound(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > SHIPMENT_ITEM_MONEY_MAX) {
    throw new ShipmentItemConfigError(`${label} deve ficar entre 0 e 3000.`);
  }
  return round2(value);
}

export function prepareShipmentItemSave(input: {
  quantity: unknown;
  items: unknown;
  valueMin: unknown;
  valueMax: unknown;
}, random: () => number = Math.random): PreparedShipmentItemSave {
  const quantityText = String(input.quantity ?? "").trim();
  if (!/^\d+$/.test(quantityText)) {
    throw new ShipmentItemConfigError("Quantidade deve ser um número de 1 a 999.");
  }
  const quantity = Number(quantityText);
  if (quantity < 1 || quantity > SHIPMENT_ITEM_QTY_MAX) {
    throw new ShipmentItemConfigError("Quantidade deve ser um número de 1 a 999.");
  }

  const minBlank = isBlank(input.valueMin);
  const maxBlank = isBlank(input.valueMax);
  let range: ShipmentValueRange | null = null;
  if (minBlank !== maxBlank) {
    throw new ShipmentItemConfigError("Preencha mínimo e máximo juntos, ou deixe os dois vazios.");
  }
  if (!minBlank && !maxBlank) {
    const min = assertMoneyBound(parseLooseMoney(input.valueMin), "Mínimo");
    const max = assertMoneyBound(parseLooseMoney(input.valueMax), "Máximo");
    if (min > max) throw new ShipmentItemConfigError("Mínimo não pode passar do máximo.");
    if (quantity * Math.round(max * 100) > SHIPMENT_ITEM_MONEY_MAX * 100) {
      throw new ShipmentItemConfigError("Quantidade × máximo não pode passar de R$ 3000.");
    }
    range = { min, max };
  }

  if (!Array.isArray(input.items)) {
    throw new ShipmentItemConfigError("Informe a lista de nomes.");
  }
  if (input.items.length > SHIPMENT_ITEM_POOL_MAX) {
    throw new ShipmentItemConfigError("A lista aceita no máximo 30 linhas.");
  }

  const items: ShipmentPoolItem[] = input.items.map((row, index) => {
    const record = row && typeof row === "object" ? row as { name?: unknown; declaredValue?: unknown } : {};
    const name = String(record.name || "").trim().slice(0, SHIPMENT_ITEM_NAME_MAX);
    if (!name) throw new ShipmentItemConfigError(`Informe o nome da linha ${index + 1}.`);
    const declaredValue = assertMoneyBound(parseLooseMoney(record.declaredValue), `Valor da linha ${index + 1}`);
    if (!range && quantity * Math.round(declaredValue * 100) > SHIPMENT_ITEM_MONEY_MAX * 100) {
      throw new ShipmentItemConfigError("Quantidade × valor da linha não pode passar de R$ 3000.");
    }
    return { name, declaredValue };
  });

  return {
    quantity,
    items,
    valueMin: range ? formatShipmentMoney(range.min) : null,
    valueMax: range ? formatShipmentMoney(range.max) : null,
    order: shuffleIndices(items.length, random),
    cursor: 0,
  };
}

export function drawShipmentLabelItem(input: {
  pool: ShipmentPoolItem[];
  order: number[];
  cursor: number;
  range: ShipmentValueRange | null;
  quantity: number;
  reserveName: string;
  reserveUnitCost: number;
  random?: () => number;
}): DrawnShipmentItem {
  const quantity = input.quantity >= 1 && input.quantity <= SHIPMENT_ITEM_QTY_MAX
    ? Math.trunc(input.quantity)
    : 1;
  if (input.pool.length === 0) {
    return {
      name: parseReserveName(input.reserveName),
      quantity,
      unitCost: parseReserveUnitCost(input.reserveUnitCost),
      consumed: false,
      order: input.order,
      cursor: input.cursor,
    };
  }

  const random = input.random ?? Math.random;
  const needsShuffle = !isIndexPermutation(input.order, input.pool.length)
    || !Number.isInteger(input.cursor)
    || input.cursor < 0
    || input.cursor >= input.pool.length;
  const order = needsShuffle ? shuffleIndices(input.pool.length, random) : input.order;
  const cursor = needsShuffle ? 0 : input.cursor;
  const item = input.pool[order[cursor]];
  const unitCost = input.range
    ? randomMoneyInclusive(input.range.min, input.range.max, random)
    : item.declaredValue;

  return {
    name: item.name,
    quantity,
    unitCost: round2(unitCost),
    consumed: true,
    order,
    cursor: cursor + 1,
  };
}
