const MIN_WEIGHT_KG = 0.3;
const MAX_WEIGHT_KG = 30;
const MIN_DIM_CM = 2;
const MAX_DIM_CM = 100;
const MAX_DECLARED_VALUE = 3000;

/** Pacote do simulador EnvioEcom — usado quando o produto não tem medidas reais. */
export const ENVIOECOM_STANDARD_PACKAGE = {
  weightKg: 0.3,
  heightCm: 2,
  widthCm: 12,
  lengthCm: 17,
  declaredValue: 5,
} as const;

export type EnvioEcomPackageDefaults = {
  weightKg: number;
  lengthCm: number;
  heightCm: number;
  widthCm: number;
};

export type EnvioEcomQuoteProduct = {
  weight: number;
  length: number;
  height: number;
  width: number;
  quantity: number;
  price: number;
};

export type EnvioEcomCreateItem = {
  name: string;
  quantity: number;
  unit_cost: number;
};

type ParsedQuoteItem = {
  id?: string;
  name: string;
  quantity: number;
  price: number;
  weight?: number;
  height?: number;
  width?: number;
  length?: number;
};

function toPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function optionalPositive(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseOrderProducts(raw: unknown): Array<ParsedQuoteItem> {
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
      const row = item as {
        id?: unknown;
        name?: unknown;
        quantity?: unknown;
        price?: unknown;
        weight?: unknown;
        height?: unknown;
        width?: unknown;
        length?: unknown;
      };
      return {
        id: String(row?.id || "").trim() || undefined,
        name: String(row?.name || "Produto").trim() || "Produto",
        quantity: Math.max(1, Math.trunc(toPositiveNumber(row?.quantity, 1))),
        price: Math.max(0, toPositiveNumber(row?.price, 0)),
        weight: optionalPositive(row?.weight),
        height: optionalPositive(row?.height),
        width: optionalPositive(row?.width),
        length: optionalPositive(row?.length),
      };
    })
    .filter((item) => item.quantity > 0);
}

function hasRealPackageMeasures(items: ParsedQuoteItem[]): boolean {
  return items.length > 0 && items.every((item) => (
    item.weight != null && item.height != null && item.width != null && item.length != null
  ));
}

/**
 * EnvioEcom empilha altura se receber N linhas. Sem medidas no cadastro KA:
 * 1 pacote 2×12×17, 0,3 kg, R$ 5 — igual ao simulador do painel.
 */
export function buildConsolidatedQuotePackage(input: {
  products: unknown;
  defaults?: EnvioEcomPackageDefaults;
}): { product: EnvioEcomQuoteProduct; items: EnvioEcomCreateItem[]; declaredValue: number } {
  const items = parseOrderProducts(input.products);
  const createItems = items.map((item) => ({
    name: item.name.slice(0, 120),
    quantity: item.quantity,
    unit_cost: round2(item.price),
  }));

  if (hasRealPackageMeasures(items)) {
    const weight = round3(clamp(
      items.reduce((sum, item) => sum + (item.weight || 0) * item.quantity, 0),
      MIN_WEIGHT_KG,
      MAX_WEIGHT_KG,
    ));
    const length = round2(clamp(Math.max(...items.map((item) => item.length || 0)), MIN_DIM_CM, MAX_DIM_CM));
    const width = round2(clamp(Math.max(...items.map((item) => item.width || 0)), MIN_DIM_CM, MAX_DIM_CM));
    const height = round2(clamp(Math.max(...items.map((item) => item.height || 0)), MIN_DIM_CM, MAX_DIM_CM));
    const declaredValue = round2(clamp(
      items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      0.01,
      MAX_DECLARED_VALUE,
    ));
    return {
      product: { weight, length, height, width, quantity: 1, price: declaredValue },
      items: createItems,
      declaredValue,
    };
  }

  const declaredValue = ENVIOECOM_STANDARD_PACKAGE.declaredValue;
  return {
    product: {
      weight: ENVIOECOM_STANDARD_PACKAGE.weightKg,
      length: ENVIOECOM_STANDARD_PACKAGE.lengthCm,
      height: ENVIOECOM_STANDARD_PACKAGE.heightCm,
      width: ENVIOECOM_STANDARD_PACKAGE.widthCm,
      quantity: 1,
      price: declaredValue,
    },
    items: createItems,
    declaredValue,
  };
}

export function formatDimension(value: number): string {
  return String(round2(value));
}

export function formatWeight(value: number): string {
  return round3(value).toFixed(3);
}

export function formatMoney(value: number): string {
  return round2(value).toFixed(2);
}
