import assert from "node:assert/strict";
import test from "node:test";
import { CHECKOUT_TOKEN_SECRET_MISSING_MESSAGE, readCheckoutTokenSecret } from "./checkout-token-secret";

const FAKE_CHECKOUT_TOKEN_SECRET = "test-checkout-token-secret";

test("CHECKOUT_TOKEN_SECRET vazio impede a inicialização", () => {
  assert.throws(
    () => readCheckoutTokenSecret({}),
    (err: unknown) => err instanceof Error && err.message === CHECKOUT_TOKEN_SECRET_MISSING_MESSAGE,
  );
});

test("os testes usam um CHECKOUT_TOKEN_SECRET fake", () => {
  const previous = process.env.CHECKOUT_TOKEN_SECRET;
  process.env.CHECKOUT_TOKEN_SECRET = FAKE_CHECKOUT_TOKEN_SECRET;
  try {
    assert.equal(readCheckoutTokenSecret(), FAKE_CHECKOUT_TOKEN_SECRET);
  } finally {
    if (previous == null) delete process.env.CHECKOUT_TOKEN_SECRET;
    else process.env.CHECKOUT_TOKEN_SECRET = previous;
  }
});
