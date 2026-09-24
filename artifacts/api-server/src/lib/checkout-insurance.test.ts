import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canReship,
  cappedLineDiscount,
  fullInsuranceMixedRateLabel,
  insuranceLinesFromProducts,
  orderLineNet,
  parseInsurancePlan,
  parseInsuranceSettingsFromMap,
  resolveCheckoutInsurance,
  type CheckoutInsuranceSettings,
} from "./checkout-insurance";

const settings54: CheckoutInsuranceSettings = {
  enabled: true,
  fullEnabled: true,
  reducedEnabled: true,
  cashbackEnabled: true,
  fullPercent: 54,
  reducedPercent: 10,
  keepPercent: 10,
  specialPercent: null,
  specialProductIds: [],
  fullLabel: "Quero garantia 100%",
  fullDescription: "full",
  reducedLabel: "Quero garantia só se sumir ou roubarem",
  reducedDescription: "reduced",
};

function resolve(plan: "full" | "reduced" | "none", extra: Partial<Parameters<typeof resolveCheckoutInsurance>[0]> = {}) {
  return resolveCheckoutInsurance({
    includeInsurance: plan !== "none",
    insurancePlan: plan === "none" ? undefined : plan,
    subtotal: 850,
    shippingCost: 50,
    discountAmount: 0,
    settings: settings54,
    ...extra,
  });
}

test("full sem cupom → seguro 459 / keep 85 / saldo 374 / total 1359", () => {
  const result = resolve("full");
  assert.equal(result.plan, "full");
  assert.equal(result.insuranceAmount, 459);
  assert.equal(result.keepAmount, 85);
  assert.equal(result.cashbackAmount, 374);
  assert.equal(result.total, 1359);
});

test("reduced sem cupom → 85 / 85 / 0 / total 985", () => {
  const result = resolve("reduced");
  assert.equal(result.plan, "reduced");
  assert.equal(result.insuranceAmount, 85);
  assert.equal(result.keepAmount, 85);
  assert.equal(result.cashbackAmount, 0);
  assert.equal(result.total, 985);
});

test("none → 0 / 0 / 0 / total 900", () => {
  const result = resolve("none");
  assert.equal(result.plan, "none");
  assert.equal(result.includeInsurance, false);
  assert.equal(result.insuranceAmount, 0);
  assert.equal(result.keepAmount, 0);
  assert.equal(result.cashbackAmount, 0);
  assert.equal(result.total, 900);
});

test("full + 10% nos produtos → seguro 459 (não 765×0,54) / desconto 85 / total 1274", () => {
  const result = resolve("full", { discountAmount: 85 });
  assert.equal(result.insuranceAmount, 459);
  assert.notEqual(result.insuranceAmount, 413.1);
  assert.equal(result.keepAmount, 85);
  assert.equal(result.cashbackAmount, 374);
  assert.equal(result.total, 1274);
});

test("reduced + 10% nos produtos → 85 / desconto 85 / total 900", () => {
  const result = resolve("reduced", { discountAmount: 85 });
  assert.equal(result.insuranceAmount, 85);
  assert.equal(result.keepAmount, 85);
  assert.equal(result.cashbackAmount, 0);
  assert.equal(result.total, 900);
});

test("full + R$ 100 fixo → desconto 100 / total 1259", () => {
  const result = resolve("full", { discountAmount: 100 });
  assert.equal(result.insuranceAmount, 459);
  assert.equal(result.keepAmount, 85);
  assert.equal(result.cashbackAmount, 374);
  assert.equal(result.total, 1259);
});

test("reduced desligado no Admin + create manda reduced → none, seguro 0, total 900", () => {
  const result = resolve("reduced", {
    settings: { ...settings54, reducedEnabled: false },
  });
  assert.equal(result.plan, "none");
  assert.equal(result.includeInsurance, false);
  assert.equal(result.insuranceAmount, 0);
  assert.equal(result.keepAmount, 0);
  assert.equal(result.cashbackAmount, 0);
  assert.equal(result.total, 900);
});

test("full desligado no Admin + create manda full → none (não vira reduced)", () => {
  const result = resolve("full", {
    settings: { ...settings54, fullEnabled: false },
  });
  assert.equal(result.plan, "none");
  assert.equal(result.insuranceAmount, 0);
  assert.equal(result.total, 900);
});

test("canReship: fila só recebe quem pagou seguro", () => {
  assert.equal(canReship("none", "extravio"), false);
  assert.equal(canReship("none", "missing_items"), false);
  assert.equal(canReship("reduced", "apreensao"), false);
  assert.equal(canReship("reduced", "extravio"), true);
  assert.equal(canReship("full", "extravio"), true);
  assert.equal(canReship(parseInsurancePlan(true, ""), "extravio"), true);
});

test("legado: só checkbox true sem plano = full", () => {
  assert.equal(parseInsurancePlan(true, ""), "full");
  assert.equal(parseInsurancePlan(true, undefined), "full");
  const result = resolveCheckoutInsurance({
    includeInsurance: true,
    subtotal: 850,
    shippingCost: 50,
    settings: settings54,
  });
  assert.equal(result.plan, "full");
  assert.equal(result.insuranceAmount, 459);
});

test("cupom não entra na base do seguro", () => {
  const withCoupon = resolve("full", { discountAmount: 85 });
  const withoutCoupon = resolve("full");
  assert.equal(withCoupon.insuranceAmount, withoutCoupon.insuranceAmount);
});

test("setting vazio: cashback desligado; full fica com o seguro inteiro", () => {
  const parsed = parseInsuranceSettingsFromMap({});
  assert.equal(parsed.cashbackEnabled, false);
  const result = resolveCheckoutInsurance({
    includeInsurance: true,
    insurancePlan: "full",
    subtotal: 733,
    settings: parsed,
  });
  assert.equal(result.insuranceAmount, 73.3);
  assert.equal(result.keepAmount, 73.3);
  assert.equal(result.cashbackAmount, 0);
});

test("full + cashback off + produto especial 20% → loja fica com tudo", () => {
  const result = resolveCheckoutInsurance({
    includeInsurance: true,
    insurancePlan: "full",
    subtotal: 700,
    lines: [
      { productId: "reta", lineTotal: 500 },
      { productId: "outro", lineTotal: 200 },
    ],
    settings: {
      ...settings54,
      cashbackEnabled: false,
      fullPercent: 10,
      specialPercent: 20,
      specialProductIds: ["reta"],
    },
  });
  assert.equal(result.insuranceAmount, 120);
  assert.equal(result.keepAmount, 120);
  assert.equal(result.cashbackAmount, 0);
});

test("reduced + cashback on → saldo continua 0", () => {
  const result = resolve("reduced");
  assert.equal(result.cashbackAmount, 0);
  assert.equal(result.keepAmount, result.insuranceAmount);
});

test("full + cashback on + cobra 10% + keep 15% → saldo 0 (teto é o seguro)", () => {
  const result = resolveCheckoutInsurance({
    includeInsurance: true,
    insurancePlan: "full",
    subtotal: 733,
    settings: { ...settings54, fullPercent: 10, keepPercent: 15, cashbackEnabled: true },
  });
  assert.equal(result.insuranceAmount, 73.3);
  assert.equal(result.keepAmount, 73.3);
  assert.equal(result.cashbackAmount, 0);
});

test("carrinho misto 10%/20% gera rótulo; reduzido não usa", () => {
  const lines = [
    { productId: "reta", lineTotal: 500 },
    { productId: "outro", lineTotal: 200 },
  ];
  const mixed = fullInsuranceMixedRateLabel(lines, {
    fullPercent: 10,
    specialPercent: 20,
    specialProductIds: ["reta"],
  });
  assert.equal(mixed, "10% / 20%");
  assert.equal(fullInsuranceMixedRateLabel([{ productId: "reta", lineTotal: 500 }], {
    fullPercent: 10,
    specialPercent: 20,
    specialProductIds: ["reta"],
  }), null);
});

test("desconto da linha limita ao valor cheio e o seguro usa o líquido", () => {
  const reta = { id: "reta", quantity: 1, price: 1079, lineDiscount: 1000 };
  const glow = { id: "glow", quantity: 1, price: 200 };
  assert.equal(cappedLineDiscount(reta), 1000);
  assert.equal(cappedLineDiscount({ ...reta, lineDiscount: 5000 }), 1079);
  assert.equal(orderLineNet(reta), 79);
  assert.equal(orderLineNet(glow), 200);
  assert.deepEqual(insuranceLinesFromProducts([reta, glow]), [
    { productId: "reta", lineTotal: 79 },
    { productId: "glow", lineTotal: 200 },
  ]);
  const insured = resolveCheckoutInsurance({
    includeInsurance: true,
    insurancePlan: "reduced",
    subtotal: 279,
    shippingCost: 0,
    discountAmount: 10,
    lines: insuranceLinesFromProducts([reta, glow]),
    settings: { ...settings54, reducedPercent: 10 },
    honorToggles: false,
  });
  assert.equal(insured.insuranceAmount, 27.9);
  assert.equal(insured.total, 296.9);
});
