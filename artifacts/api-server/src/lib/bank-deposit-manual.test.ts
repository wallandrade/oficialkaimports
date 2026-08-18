import assert from "node:assert/strict";
import test from "node:test";

import { isManualInterDepositOrder } from "./bank-deposit-manual";

test("whatsapp_pix entra na conciliação Inter mesmo com transactionId", () => {
  assert.equal(
    isManualInterDepositOrder({ paymentMethod: "whatsapp_pix", transactionId: "tx-123" }),
    true,
  );
});

test("PIX com transactionId (CNPay/DentPeg) fica de fora", () => {
  assert.equal(
    isManualInterDepositOrder({ paymentMethod: "pix", transactionId: "cn-abc" }),
    false,
  );
});

test("PIX sem transactionId entra (depósito manual)", () => {
  assert.equal(isManualInterDepositOrder({ paymentMethod: "pix", transactionId: null }), true);
  assert.equal(isManualInterDepositOrder({ paymentMethod: "pix", transactionId: "  " }), true);
  assert.equal(isManualInterDepositOrder({ paymentMethod: null, transactionId: null }), true);
});

test("cartão simulado e crédito de afiliado ficam de fora", () => {
  assert.equal(isManualInterDepositOrder({ paymentMethod: "card_simulation" }), false);
  assert.equal(isManualInterDepositOrder({ paymentMethod: "affiliate_credit" }), false);
});
