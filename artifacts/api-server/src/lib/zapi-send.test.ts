import assert from "node:assert/strict";
import test from "node:test";
import { sendZapiMessage, zapiOutboundRequest } from "./zapi-send";

const FAKE_PHONE = "5500000000000";
const REAL_PHONE = "5511999991234";
const ENV = {
  ZAPI_MAIN_INSTANCE_ID: "inst",
  ZAPI_MAIN_TOKEN: "tok",
  ZAPI_CLIENT_TOKEN: "cli",
};

test("o corpo do send-text não leva token", () => {
  const request = zapiOutboundRequest({ phone: FAKE_PHONE, kind: "text", message: "pedido pago" });
  assert.equal("error" in request, false);
  if ("error" in request) return;
  assert.equal(request.suffix, "/send-text");
  assert.deepEqual(request.body, { phone: FAKE_PHONE, message: "pedido pago" });
  assert.equal(JSON.stringify(request.body).includes("tok"), false);
});

test("dry-run não chama a rede nem com celular real", async () => {
  let called = 0;
  const result = await sendZapiMessage({
    instance: "main",
    phone: REAL_PHONE,
    kind: "text",
    message: "oi",
    live: true,
    env: { ...ENV, WHATSAPP_ZAPI_DRY_RUN: "1" },
    fetchImpl: async () => {
      called += 1;
      throw new Error("rede");
    },
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.ok, true);
  assert.equal(called, 0);
});

test("modo só de teste recusa celular real", async () => {
  let called = 0;
  const result = await sendZapiMessage({
    instance: "main",
    phone: REAL_PHONE,
    kind: "text",
    message: "oi",
    live: true,
    env: { ...ENV, WHATSAPP_ZAPI_FAKE_ONLY: "1" },
    fetchImpl: async () => {
      called += 1;
      throw new Error("rede");
    },
  });
  assert.equal(result.error, "fake_only");
  assert.equal(result.terminal, true);
  assert.equal(called, 0);
});

test("sem confirmação de produção um celular real não sai", async () => {
  let called = 0;
  const result = await sendZapiMessage({
    instance: "main",
    phone: REAL_PHONE,
    kind: "text",
    message: "oi",
    env: ENV,
    fetchImpl: async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.error, "live_not_confirmed");
  assert.equal(called, 0);
});

test("número falso recebe 200 sem colocar o token no corpo", async () => {
  let body = "";
  const result = await sendZapiMessage({
    instance: "main",
    phone: FAKE_PHONE,
    kind: "text",
    message: "oi",
    live: true,
    env: ENV,
    fetchImpl: async (url, init) => {
      assert.equal(String(url).startsWith("https://api.z-api.io/instances/inst/token/tok/send-text"), true);
      body = String(init?.body || "");
      assert.equal(new Headers(init?.headers).get("Client-Token"), "cli");
      return new Response(JSON.stringify({ zaapId: "1", messageId: "2" }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(body), { phone: FAKE_PHONE, message: "oi" });
});
