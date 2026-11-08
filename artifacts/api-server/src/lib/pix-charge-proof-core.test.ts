import assert from "node:assert/strict";
import test from "node:test";
import { decidePixAuthentication, hashPixWebhookToken, pixTokenHashMatches } from "./pix-charge-proof-core";

const tokenA = "token-transacao-a";
const tokenB = "token-transacao-b";
const hashA = hashPixWebhookToken(tokenA);

test("hash não devolve o token e só casa com o mesmo valor", () => {
  assert.equal(hashA.includes(tokenA), false);
  assert.equal(pixTokenHashMatches(hashA, tokenA), true);
  assert.equal(pixTokenHashMatches(hashA, tokenB), false);
  assert.equal(pixTokenHashMatches("", tokenA), false);
});

test("segredo global autentica sem token de transação", () => {
  const auth = decidePixAuthentication({
    globalSecretMatches: true,
    presentedToken: "",
    storedTokenHash: null,
  });
  assert.equal(auth.ok, true);
  if (auth.ok) assert.equal(auth.method, "shared_secret");
});

test("token do corpo sem hash gravado não cria confiança", () => {
  const auth = decidePixAuthentication({
    globalSecretMatches: false,
    presentedToken: tokenA,
    storedTokenHash: null,
  });
  assert.equal(auth.ok, false);
  if (!auth.ok) assert.equal(auth.reason, "proof_not_stored");
});

test("token de outra transação não passa", () => {
  const auth = decidePixAuthentication({
    globalSecretMatches: false,
    presentedToken: tokenB,
    storedTokenHash: hashA,
  });
  assert.equal(auth.ok, false);
  if (!auth.ok) assert.equal(auth.reason, "token_mismatch");
});

test("token igual ao gravado na criação autentica só essa prova", () => {
  const auth = decidePixAuthentication({
    globalSecretMatches: false,
    presentedToken: tokenA,
    storedTokenHash: hashA,
  });
  assert.equal(auth.ok, true);
  if (auth.ok) assert.equal(auth.method, "transaction_token");
});
