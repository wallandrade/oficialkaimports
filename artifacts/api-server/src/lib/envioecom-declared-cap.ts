/** Teto do valor declarado/segurado quando a cotação não informa o limite da transportadora. */
export const ENVIOECOM_DECLARED_CAP = 1000;

/** Teto da própria EnvioEcom (`cost` / soma do pacote). Limite acima disso é ignorado. */
export const ENVIOECOM_DECLARED_ABS_MAX = 3000;

const LIMIT_KEYS = [
  "max_declared_value",
  "declared_value_limit",
  "declaredValueLimit",
  "max_insurance_value",
  "insurance_limit",
  "insured_value_limit",
  "valor_maximo_declarado",
  "limite_valor_declarado",
];

export type DeclaredCap = {
  value: number;
  from: number;
  capped: boolean;
  limit: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `1.000,00`, `2.500,00` e `1.000`. Ponto sozinho com 1 ou 2 casas (`19.85`) continua decimal. */
function parseDeclaredLimitAmount(value: unknown): number {
  if (typeof value === "number") return value;
  const raw = String(value ?? "").trim().replace(/[R$\s]/gi, "");
  if (!raw) return NaN;
  if (!raw.includes(",") && /^\d{1,3}(\.\d{3})+$/.test(raw)) {
    return Number(raw.replace(/\./g, ""));
  }
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function normalizeDeclaredLimit(value: unknown): number | null {
  if (typeof value === "string" && !value.trim()) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = parseDeclaredLimitAmount(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > ENVIOECOM_DECLARED_ABS_MAX) return null;
  return roundMoney(parsed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A doc pública da cotação não manda o teto. Se a opção trouxer um campo conhecido, usa ele. */
export function carrierDeclaredLimitFromQuote(quote: unknown): number | null {
  const row = asRecord(quote);
  if (!row) return null;
  for (const key of LIMIT_KEYS) {
    const found = normalizeDeclaredLimit(row[key]);
    if (found) return found;
  }
  const nested = asRecord(row.limits) || asRecord(row.limit);
  if (!nested || nested === row) return null;
  return carrierDeclaredLimitFromQuote(nested);
}

export function capEnvioEcomDeclaredValue(amount: number, limit?: unknown): DeclaredCap {
  const from = roundMoney(Number.isFinite(amount) ? amount : 0);
  const cap = normalizeDeclaredLimit(limit) ?? ENVIOECOM_DECLARED_CAP;
  if (from > cap) return { value: cap, from, capped: true, limit: cap };
  return { value: from, from, capped: false, limit: cap };
}

type DeclaredItem = { quantity: number; unit_cost: number };

function itemQuantity(item: DeclaredItem): number {
  const qty = Math.trunc(Number(item.quantity));
  return Number.isFinite(qty) && qty >= 1 ? qty : 1;
}

function itemsTotal(items: DeclaredItem[]): number {
  return roundMoney(items.reduce((sum, item) => sum + itemQuantity(item) * Number(item.unit_cost || 0), 0));
}

function unitForTotal(quantity: number, total: number): number {
  const qty = Math.max(1, quantity);
  let unit = Math.floor((total / qty) * 100) / 100;
  if (unit < 0.01) unit = 0.01;
  while (roundMoney(unit * qty) > total && unit > 0.01) {
    unit = roundMoney(unit - 0.01);
  }
  return unit;
}

/**
 * `cost` é o valor declarado que a transportadora segura e que entra na DC-e.
 * `items[].unit_cost * quantity` acompanha esse total, para a declaração não passar do teto.
 */
export function fitDeclaredShipmentItems<T extends DeclaredItem>(
  items: T[],
  declaredCost: number,
  limit?: unknown,
): { items: T[]; declaredCost: number; capped: boolean; limit: number; from: number } {
  const from = roundMoney(Math.max(itemsTotal(items), Number.isFinite(declaredCost) ? declaredCost : 0));
  const capped = capEnvioEcomDeclaredValue(from, limit);
  if (!capped.capped || items.length === 0) {
    return { items, declaredCost: roundMoney(declaredCost), capped: false, limit: capped.limit, from: capped.from };
  }
  const current = itemsTotal(items);
  const target = capped.value;
  if (items.length === 1) {
    const qty = itemQuantity(items[0]);
    const unit = unitForTotal(qty, target);
    const next = [{ ...items[0], quantity: qty, unit_cost: unit }];
    return {
      items: next,
      declaredCost: roundMoney(unit * qty),
      capped: true,
      limit: capped.limit,
      from: capped.from,
    };
  }
  const ratio = current > 0 ? target / current : 0;
  const next = items.map((item) => {
    const qty = itemQuantity(item);
    const unit = Math.max(0.01, Math.floor(Number(item.unit_cost || 0) * ratio * 100) / 100);
    return { ...item, quantity: qty, unit_cost: unit };
  });
  let total = itemsTotal(next);
  if (total > target) {
    const last = next[next.length - 1];
    const others = roundMoney(total - last.quantity * last.unit_cost);
    last.unit_cost = unitForTotal(last.quantity, Math.max(0.01, roundMoney(target - others)));
    total = itemsTotal(next);
  }
  return { items: next, declaredCost: total, capped: true, limit: capped.limit, from: capped.from };
}
