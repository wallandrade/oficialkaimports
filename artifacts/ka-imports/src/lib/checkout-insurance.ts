export type InsurancePlan = "none" | "full" | "reduced";
export type InsuranceProblem = "extravio" | "apreensao" | "missing_items";

export type CheckoutInsuranceSettings = {
  enabled: boolean;
  fullEnabled: boolean;
  reducedEnabled: boolean;
  fullPercent: number;
  reducedPercent: number;
  keepPercent: number;
  specialPercent: number | null;
  specialProductIds: string[];
  fullLabel: string;
  fullDescription: string;
  reducedLabel: string;
  reducedDescription: string;
};

export type InsuranceLine = {
  productId: string;
  lineTotal: number;
};

export type CheckoutInsuranceSnapshot = {
  plan: InsurancePlan;
  includeInsurance: boolean;
  insuranceAmount: number;
  keepAmount: number;
  cashbackAmount: number;
  total: number;
};

export const INSURANCE_SETTING_KEYS = [
  "checkout_insurance_enabled",
  "checkout_insurance_full_enabled",
  "checkout_insurance_reduced_enabled",
  "checkout_insurance_percent",
  "checkout_insurance_reduced_percent",
  "checkout_insurance_keep_percent",
  "checkout_insurance_product_percent",
  "checkout_insurance_product_ids",
  "checkout_insurance_full_label",
  "checkout_insurance_full_description",
  "checkout_insurance_reduced_label",
  "checkout_insurance_reduced_description",
] as const;

export const DEFAULT_INSURANCE_FULL_LABEL = "Quero garantia 100%";
export const DEFAULT_INSURANCE_FULL_DESCRIPTION =
  "🗣️ SEGURO: Cobre se as transportadora perderem a encomenda ou se houver apreensão pela Receita Federal. 📦";
export const DEFAULT_INSURANCE_REDUCED_LABEL = "Quero garantia só se sumir ou roubarem";
export const DEFAULT_INSURANCE_REDUCED_DESCRIPTION =
  "🗣️ SEGURO: Cobre apenas perda ou roubo pelas transportadoras. 📦\n❌ Não cobre apreensão pela Polícia ou Receita Federal.";

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseBoolSetting(raw: string | null | undefined, defaultValue: boolean): boolean {
  if (raw == null || String(raw).trim() === "") return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) return false;
  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) return true;
  return defaultValue;
}

function parsePercentSetting(raw: string | null | undefined, defaultValue: number): number {
  if (raw == null || String(raw).trim() === "") return defaultValue;
  const parsed = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return defaultValue;
  return parsed;
}

export function parseInsurancePlan(includeInsurance: unknown, insurancePlan: unknown): InsurancePlan {
  const raw = String(insurancePlan ?? "").trim().toLowerCase();
  if (raw === "full" || raw === "completo") return "full";
  if (raw === "reduced" || raw === "reduzido") return "reduced";
  if (raw === "none" || raw === "false" || raw === "0" || raw === "nenhum") return "none";
  const included =
    includeInsurance === true
    || includeInsurance === "true"
    || includeInsurance === 1
    || includeInsurance === "1";
  if (!raw && included) return "full";
  return "none";
}

export function applyInsuranceToggles(
  plan: InsurancePlan,
  settings: Pick<CheckoutInsuranceSettings, "enabled" | "fullEnabled" | "reducedEnabled">,
): InsurancePlan {
  if (!settings.enabled) return "none";
  if (plan === "full" && !settings.fullEnabled) return "none";
  if (plan === "reduced" && !settings.reducedEnabled) return "none";
  return plan;
}

export function parseInsuranceProductIds(raw: string | null | undefined): string[] {
  if (!raw || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // comma-separated fallback
  }
  return String(raw)
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseInsuranceSettingsFromMap(
  map: Record<string, string | null | undefined>,
): CheckoutInsuranceSettings {
  const specialRaw = map.checkout_insurance_product_percent;
  const specialPercent = specialRaw == null || String(specialRaw).trim() === ""
    ? null
    : parsePercentSetting(specialRaw, 0);

  return {
    enabled: parseBoolSetting(map.checkout_insurance_enabled, true),
    fullEnabled: parseBoolSetting(map.checkout_insurance_full_enabled, true),
    reducedEnabled: parseBoolSetting(map.checkout_insurance_reduced_enabled, true),
    fullPercent: parsePercentSetting(map.checkout_insurance_percent, 10),
    reducedPercent: parsePercentSetting(map.checkout_insurance_reduced_percent, 10),
    keepPercent: parsePercentSetting(map.checkout_insurance_keep_percent, 10),
    specialPercent,
    specialProductIds: parseInsuranceProductIds(map.checkout_insurance_product_ids),
    fullLabel: String(map.checkout_insurance_full_label || "").trim() || DEFAULT_INSURANCE_FULL_LABEL,
    fullDescription: String(map.checkout_insurance_full_description || "").trim() || DEFAULT_INSURANCE_FULL_DESCRIPTION,
    reducedLabel: String(map.checkout_insurance_reduced_label || "").trim() || DEFAULT_INSURANCE_REDUCED_LABEL,
    reducedDescription: String(map.checkout_insurance_reduced_description || "").trim() || DEFAULT_INSURANCE_REDUCED_DESCRIPTION,
  };
}

export async function loadCheckoutInsuranceSettings(
  getValue: (key: string) => Promise<string | null>,
): Promise<CheckoutInsuranceSettings> {
  const entries = await Promise.all(
    INSURANCE_SETTING_KEYS.map(async (key) => [key, await getValue(key)] as const),
  );
  return parseInsuranceSettingsFromMap(Object.fromEntries(entries));
}

export function insuranceLinesFromProducts(
  products: Array<{ id?: string; quantity?: number; price?: number }>,
): InsuranceLine[] {
  return products.map((product) => ({
    productId: String(product.id || ""),
    lineTotal: Math.max(0, Number(product.quantity) || 0) * Math.max(0, Number(product.price) || 0),
  }));
}

export function computeInsuranceAmountForPlan(
  plan: InsurancePlan,
  subtotal: number,
  lines: InsuranceLine[],
  settings: CheckoutInsuranceSettings,
): number {
  if (plan === "none") return 0;
  const base = Math.max(0, Number(subtotal) || 0);
  if (plan === "reduced") {
    return roundMoney(base * (settings.reducedPercent / 100));
  }

  const specialIds = new Set(settings.specialProductIds.map((id) => String(id).trim()).filter(Boolean));
  const specialPercent = settings.specialPercent;
  if (!specialIds.size || specialPercent == null || !Number.isFinite(specialPercent)) {
    return roundMoney(base * (settings.fullPercent / 100));
  }

  let sum = 0;
  for (const line of lines) {
    const lineTotal = Math.max(0, Number(line.lineTotal) || 0);
    const percent = specialIds.has(String(line.productId).trim()) ? specialPercent : settings.fullPercent;
    sum += lineTotal * (percent / 100);
  }
  return roundMoney(sum);
}

export function computeInsuranceSnapshotForPlan(
  plan: InsurancePlan,
  subtotal: number,
  insuranceAmount: number,
  keepPercent: number,
): { keepAmount: number; cashbackAmount: number } {
  if (plan === "none" || insuranceAmount <= 0) {
    return { keepAmount: 0, cashbackAmount: 0 };
  }
  if (plan === "reduced") {
    return { keepAmount: insuranceAmount, cashbackAmount: 0 };
  }
  const keepRaw = roundMoney(Math.max(0, Number(subtotal) || 0) * (keepPercent / 100));
  const keepAmount = Math.min(keepRaw, insuranceAmount);
  const cashbackAmount = roundMoney(insuranceAmount - keepAmount);
  return { keepAmount, cashbackAmount };
}

export function resolveCheckoutInsurance(input: {
  includeInsurance?: unknown;
  insurancePlan?: unknown;
  subtotal: number;
  shippingCost?: number;
  discountAmount?: number;
  lines?: InsuranceLine[];
  settings: CheckoutInsuranceSettings;
  honorToggles?: boolean;
}): CheckoutInsuranceSnapshot {
  const requested = parseInsurancePlan(input.includeInsurance, input.insurancePlan);
  const plan = input.honorToggles === false ? requested : applyInsuranceToggles(requested, input.settings);
  const subtotal = Math.max(0, Number(input.subtotal) || 0);
  const shippingCost = Math.max(0, Number(input.shippingCost) || 0);
  const discountAmount = Math.max(0, Number(input.discountAmount) || 0);
  const insuranceAmount = computeInsuranceAmountForPlan(plan, subtotal, input.lines || [], input.settings);
  const snapshot = computeInsuranceSnapshotForPlan(plan, subtotal, insuranceAmount, input.settings.keepPercent);
  const total = roundMoney(Math.max(0, subtotal + shippingCost + insuranceAmount - discountAmount));
  return {
    plan,
    includeInsurance: plan !== "none",
    insuranceAmount,
    keepAmount: snapshot.keepAmount,
    cashbackAmount: snapshot.cashbackAmount,
    total,
  };
}

export function insuranceCoversProblem(plan: InsurancePlan, problem: InsuranceProblem): boolean {
  if (problem === "missing_items") return false;
  if (plan === "full") return true;
  if (plan === "reduced") return problem === "extravio";
  return false;
}

export function insuranceSnapshotColumns(snapshot: CheckoutInsuranceSnapshot) {
  return {
    includeInsurance: snapshot.includeInsurance,
    insurancePlan: snapshot.plan === "none" ? null : snapshot.plan,
    insuranceAmount: String(snapshot.insuranceAmount),
    insuranceKeepAmount: String(snapshot.keepAmount),
    insuranceCashbackAmount: String(snapshot.cashbackAmount),
    insuranceClaimStatus: "none" as const,
    insuranceReshipCount: 0,
    insuranceCashbackGranted: false,
  };
}
