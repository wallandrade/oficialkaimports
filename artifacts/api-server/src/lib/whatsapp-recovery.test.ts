import assert from "node:assert/strict";
import test from "node:test";
import { pickRecoveryCandidate, recoveryMessage } from "./whatsapp-recovery";

const day = 24 * 60 * 60 * 1000;

test("recuperação começa pelo cliente mais antigo e pula quem já recebeu", () => {
  const now = new Date("2026-10-23T15:00:00.000Z");
  const old = { phone: "5535991111111", name: "Ana", lastAt: new Date(now.getTime() - 80 * day) };
  const older = { phone: "5535992222222", name: "Bia", lastAt: new Date(now.getTime() - 120 * day) };
  const recent = { phone: "5535993333333", name: "Caio", lastAt: new Date(now.getTime() - 10 * day) };
  const picked = pickRecoveryCandidate({
    customers: [old, older, recent],
    sent: [{ phone: older.phone, lastOrderAt: older.lastAt }],
    ignored: new Set(),
    now,
    days: 40,
  });
  assert.equal(picked?.phone, old.phone);
});

test("mensagem troca o primeiro nome", () => {
  const text = recoveryMessage("Oi, {nome}.", "Maria Silva");
  assert.equal(text, "Oi, Maria.");
});
