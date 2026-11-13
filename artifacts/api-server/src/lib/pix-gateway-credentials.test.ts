import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseSharedPixAccount,
  isMaskedGatewaySecret,
  maskGatewaySecret,
  pickAppcnpayCredentialPair,
  PIX_NOT_CONFIGURED_FOR_STORE,
  resolveDifferenceChargeTenantId,
} from "./pix-gateway-credentials-core";

test("pick usa o par da loja quando as duas chaves existem", () => {
  const pair = pickAppcnpayCredentialPair({
    tenantPublicKey: "filial-pub",
    tenantSecretKey: "filial-sec",
    envPublicKey: "env-pub",
    envSecretKey: "env-sec",
  });
  assert.equal(pair.source, "tenant");
  assert.equal(pair.publicKey, "filial-pub");
  assert.equal(pair.secretKey, "filial-sec");
});

test("pick nao mistura chave da loja com env", () => {
  assert.throws(
    () => pickAppcnpayCredentialPair({
      tenantPublicKey: "filial-pub",
      tenantSecretKey: "",
      envPublicKey: "env-pub",
      envSecretKey: "env-sec",
    }),
    /chave pública e a chave secreta/,
  );
});

test("pick cai no env só quando a loja principal permite", () => {
  const pair = pickAppcnpayCredentialPair({
    tenantPublicKey: "",
    tenantSecretKey: "",
    envPublicKey: "env-pub",
    envSecretKey: "env-sec",
    allowEnvFallback: true,
  });
  assert.equal(pair.source, "env");
  assert.equal(pair.publicKey, "env-pub");
});

test("filial sem chaves não usa a conta global", () => {
  assert.equal(canUseSharedPixAccount("tenant_filial"), false);
  assert.equal(canUseSharedPixAccount("tenant_loja1"), true);
  assert.equal(canUseSharedPixAccount(""), true);
  assert.throws(
    () => pickAppcnpayCredentialPair({
      tenantPublicKey: "",
      tenantSecretKey: "",
      envPublicKey: "env-pub",
      envSecretKey: "env-sec",
      allowEnvFallback: false,
    }),
    new RegExp(PIX_NOT_CONFIGURED_FOR_STORE),
  );
});

test("cobranca de diferenca herda o tenant do pedido", () => {
  assert.equal(resolveDifferenceChargeTenantId("tenant_filial", "tenant_loja1"), "tenant_filial");
  assert.equal(resolveDifferenceChargeTenantId("  ", "tenant_filial"), "tenant_filial");
  assert.equal(resolveDifferenceChargeTenantId(null, ""), "tenant_loja1");
});

test("mascara e detecta placeholder de GET", () => {
  assert.equal(maskGatewaySecret("abcd1234xyz"), "*******4xyz");
  assert.equal(isMaskedGatewaySecret("*******4xyz"), true);
  assert.equal(isMaskedGatewaySecret("chave-real"), false);
});
