if (!String(process.env.CHECKOUT_TOKEN_SECRET || "").trim()) {
  process.env.CHECKOUT_TOKEN_SECRET = "test-checkout-token-secret";
}
