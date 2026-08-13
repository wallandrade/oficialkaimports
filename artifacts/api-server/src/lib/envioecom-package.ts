const MIN_WEIGHT_KG = 0.3;
const MAX_WEIGHT_KG = 30;
const MIN_DIM_CM = 2;
const MAX_DIM_CM = 100;
const MAX_DECLARED_VALUE = 3000;

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

function toPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
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

export function parseOrderProducts(raw: unknown): Array<{ id?: string; name: string; quantity: number; price: number }> {
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
      const row = item as { id?: unknown; name?: unknown; quantity?: unknown; price?: unknown };
      return {
        id: String(row?.id || "").trim() || undefined,
        name: String(row?.name || "Produto").trim() || "Produto",
        quantity: Math.max(1, Math.trunc(toPositiveNumber(row?.quantity, 1))),
        price: Math.max(0, toPositiveNumber(row?.price, 0)),
      };
    })
    .filter((item) => item.quantity > 0);
}

/**
 * EnvioEcom empilha altura se receber N linhas. Produtos da KA não têm medidas:
 * enviamos 1 pacote consolidado + clamp para não estourar QUOTE_ERROR.
 */
export function buildConsolidatedQuotePackage(input: {
  products: unknown;
  defaults: EnvioEcomPackageDefaults;
}): { product: EnvioEcomQuoteProduct; items: EnvioEcomCreateItem[]; declaredValue: number } {
  const items = parseOrderProducts(input.products);
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0) || 1;
  const declaredValue = round2(clamp(
    items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    0.01,
    MAX_DECLARED_VALUE,
  ));

  const weight = round3(clamp(toPositiveNumber(input.defaults.weightKg, MIN_WEIGHT_KG) * quantity, MIN_WEIGHT_KG, MAX_WEIGHT_KG));
  const length = round2(clamp(toPositiveNumber(input.defaults.lengthCm, 20), MIN_DIM_CM, MAX_DIM_CM));
  const width = round2(clamp(toPositiveNumber(input.defaults.widthCm, 15), MIN_DIM_CM, MAX_DIM_CM));
  const height = round2(clamp(toPositiveNumber(input.defaults.heightCm, 10), MIN_DIM_CM, MAX_DIM_CM));

  return {
    product: {
      weight,
      length,
      height,
      width,
      quantity: 1,
      price: declaredValue,
    },
    items: items.map((item) => ({
      name: item.name.slice(0, 120),
      quantity: item.quantity,
      unit_cost: round2(item.price),
    })),
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
