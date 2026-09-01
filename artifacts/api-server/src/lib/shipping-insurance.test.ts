import assert from "node:assert/strict";
import { test } from "node:test";
import { computeShippingInsuranceAmount } from "./shipping-insurance";

test("seguro e 10% do valor apos cupom, nao do subtotal cheio", () => {
  assert.equal(computeShippingInsuranceAmount(false, 2540, 762), 0);
  assert.equal(computeShippingInsuranceAmount(true, 2540, 0), 254);
  assert.equal(computeShippingInsuranceAmount(true, 2540, 762), 177.8);
  assert.equal(computeShippingInsuranceAmount(true, 2540, 2540), 0);
  assert.equal(computeShippingInsuranceAmount(true, 100, 150), 0);
});
