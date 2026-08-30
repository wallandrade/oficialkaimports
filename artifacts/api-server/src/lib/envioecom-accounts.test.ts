import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleEnvioEcomAccounts,
  isEnvioEcomAccountConfigured,
  maskEmail,
  orderEnvioEcomAccountsForFallback,
  parseEnvioEcomExtrasJson,
  pickWriteEnvioEcomAccount,
  toPublicEnvioEcomAccount,
} from "./envioecom-accounts-core";

test("GET mascara e-mail e nunca devolve senha", () => {
  const publicAccount = toPublicEnvioEcomAccount({
    accountId: "abc",
    name: "Conta 2",
    token: "perm-token-1234",
    email: "ab@mail.com",
    password: "secret",
    originCep: "01310100",
    fromEnv: false,
  });
  assert.equal(publicAccount.emailMasked, "ab••••@mail.com");
  assert.equal(publicAccount.tokenMasked?.endsWith("1234"), true);
  assert.equal("password" in publicAccount, false);
  assert.equal("token" in publicAccount, false);
});

test("JSON extra ignora env/tenant e id duplicado", () => {
  const extras = parseEnvioEcomExtrasJson([
    { id: "env", name: "nope", token: "x" },
    { id: "tenant", name: "nope", token: "y" },
    { id: "11111111-1111-1111-1111-111111111111", name: "Conta 2", token: "tok", originCep: "01310-100" },
    { id: "11111111-1111-1111-1111-111111111111", name: "dup", token: "other" },
  ]);
  assert.equal(extras.length, 1);
  assert.equal(extras[0].name, "Conta 2");
  assert.equal(extras[0].originCep, "01310100");
});

test("write sem accountId usa a primeira configurada; id inexistente 404", () => {
  const accounts = assembleEnvioEcomAccounts({
    tenantId: "filial",
    settings: {
      envioecom_token: "loja-token",
      envioecom_origin_cep: "01310100",
      envioecom_accounts: JSON.stringify([
        { id: "aaaa", name: "Conta 2", token: "extra-token", originCep: "04001000" },
      ]),
    },
  });
  const first = pickWriteEnvioEcomAccount(accounts);
  if (!("account" in first)) throw new Error("expected tenant account");
  assert.equal(first.account.accountId, "tenant");
  const missing = pickWriteEnvioEcomAccount(accounts, "nao-existe");
  assert.deepEqual(missing, { error: "NOT_FOUND" });
  const extra = pickWriteEnvioEcomAccount(accounts, "aaaa");
  if (!("account" in extra)) throw new Error("expected extra account");
  assert.equal(extra.account.originCep, "04001000");
});

test("fallback prefere a conta do pedido, depois env, depois o resto", () => {
  const ordered = orderEnvioEcomAccountsForFallback([
    { accountId: "env", name: "São Paulo", token: "e", email: "", password: "", originCep: "01310100", fromEnv: true },
    { accountId: "tenant", name: "Conta da loja", token: "t", email: "", password: "", originCep: "01310100", fromEnv: false },
    { accountId: "aaaa", name: "Conta 2", token: "x", email: "", password: "", originCep: "04001000", fromEnv: false },
  ], "aaaa");
  assert.deepEqual(ordered.map((item) => item.accountId), ["aaaa", "env", "tenant"]);
});

test("zero contas configuradas é NONE", () => {
  assert.equal(isEnvioEcomAccountConfigured({ token: "", email: "a@b.com", password: "" }), false);
  assert.deepEqual(pickWriteEnvioEcomAccount([]), { error: "NONE" });
});

test("mascara e-mail curto", () => {
  assert.equal(maskEmail("ab@mail.com"), "ab••••@mail.com");
});
