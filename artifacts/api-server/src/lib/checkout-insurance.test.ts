import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseInsurancePlan,
  resolveCheckoutInsurance,
  type CheckoutInsuranceSettings,
} from "./checkout-insurance";

const settings54: CheckoutInsuranceSettings = {
  enabled: true,
  fullEnabled: true,
  reducedEnabled: true,
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
