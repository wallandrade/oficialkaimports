import assert from "node:assert/strict";
import test from "node:test";
import {
  clipBackupError,
  formatBackupAlertText,
  parseBackupAlertPhones,
  sendBackupAlert,
} from "./backup-alert.mjs";

const ENV = {
  ZAPI_MAIN_INSTANCE_ID: "inst",
  ZAPI_MAIN_TOKEN: "tok",
  ZAPI_CLIENT_TOKEN: "cli",
};

test("parser de telefones fica só com dígitos que começam com 55", () => {
  assert.deepEqual(
    parseBackupAlertPhones(" 5511999991234, 55 11 98888-7777 , sem-numero, 5511 "),
    ["5511999991234", "5511988887777"],
  );
  assert.deepEqual(parseBackupAlertPhones(undefined), []);
  assert.deepEqual(parseBackupAlertPhones("11999991234"), []);
});

test("texto curto em português corta o erro em 200 caracteres", () => {
  const error = `${"a".repeat(180)} mysql://root:secret@db/app ${"b".repeat(80)}`;
  const text = formatBackupAlertText({
    stages: ["banco"],
    details: [{ stage: "banco", error }],
    now: new Date("2026-11-28T06:05:00.000Z"),
  });
  assert.match(text, /^\[Ka Imports\] Backup falhou\nEtapa: banco\nbanco: /);
  assert.equal(text.includes("secret"), false);
  assert.equal(text.includes("mysql://"), false);
  const detail = text.split("\n")[2];
  const clipped = detail.slice("banco: ".length);
  assert.equal(clipped.length <= 200, true);
  assert.equal(clipBackupError("x".repeat(250)).length, 200);
  assert.equal(text.endsWith("Hora: 28/11/2026 03:05"), true);
});

test("dry-run e modo de teste não chamam a rede para celular real", async () => {
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    throw new Error("rede");
  };
  const dry = await sendBackupAlert({
    env: { ...ENV, WHATSAPP_ZAPI_DRY_RUN: "1" },
    phones: ["5511999991234"],
    message: "oi",
    fetchImpl,
    log() {},
  });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.ok, true);
  const fake = await sendBackupAlert({
    env: { ...ENV, WHATSAPP_ZAPI_FAKE_ONLY: "true" },
    phones: ["5511999991234"],
    message: "oi",
    fetchImpl,
    log() {},
  });
  assert.equal(fake.ok, false);
  assert.equal(called, 0);
});

test("send-text sai direto e o corpo não leva o token", async () => {
  let body = "";
  let header = "";
  const result = await sendBackupAlert({
    env: ENV,
    phones: ["5511999991234"],
    message: "[Ka Imports] Backup falhou",
    log() {},
    fetchImpl: async (url, init) => {
      assert.equal(String(url).includes("/send-text"), true);
      assert.equal(String(url).startsWith("https://api.z-api.io/instances/inst/token/tok/"), true);
      body = String(init?.body || "");
      header = new Headers(init?.headers).get("Client-Token") || "";
      return new Response(JSON.stringify({ zaapId: "1" }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.sent, 1);
  assert.equal(header, "cli");
  assert.deepEqual(JSON.parse(body), { phone: "5511999991234", message: "[Ka Imports] Backup falhou" });
  assert.equal(body.includes("tok"), false);
});
