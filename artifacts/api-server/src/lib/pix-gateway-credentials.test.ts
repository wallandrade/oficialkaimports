import assert from "node:assert/strict";
import test from "node:test";
import {
  isMaskedGatewaySecret,
  maskGatewaySecret,
  pickAppcnpayCredentialPair,
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

test("pick cai no env quando a loja nao cadastrou", () => {
  const pair = pickAppcnpayCredentialPair({
    tenantPublicKey: "",
    tenantSecretKey: "",
    envPublicKey: "env-pub",
    envSecretKey: "env-sec",
  });
  assert.equal(pair.source, "env");
  assert.equal(pair.publicKey, "env-pub");
});

test("mascara e detecta placeholder de GET", () => {
  assert.equal(maskGatewaySecret("abcd1234xyz"), "*******4xyz");
  assert.equal(isMaskedGatewaySecret("*******4xyz"), true);
  assert.equal(isMaskedGatewaySecret("chave-real"), false);
});
