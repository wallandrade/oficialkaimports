import assert from "node:assert/strict";
import test from "node:test";
import { addRecoverySpend, canonicalRecoveryPhone, pickRecoveryCandidate, recoveryAnswerId, recoveryMessage, recoveryOptionList, recoveryOrderAmount, recoveryQuietHours, recoverySurveyStats } from "./whatsapp-recovery";

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

test("recuperação não repete o mesmo telefone quando a data gravada volta um pouco menor", () => {
  const now = new Date("2026-10-23T15:00:00.000Z");
  const first = { phone: "5535991111111", name: "Ana", lastAt: new Date(now.getTime() - 80 * day) };
  const next = { phone: "5535992222222", name: "Bia", lastAt: new Date(now.getTime() - 70 * day) };
  const picked = pickRecoveryCandidate({
    customers: [first, next],
    sent: [{ phone: first.phone, lastOrderAt: new Date(first.lastAt.getTime() - 3 * 60 * 60 * 1000) }],
    ignored: new Set(),
    now,
    days: 40,
  });
  assert.equal(picked?.phone, next.phone);
});

test("gasto soma só os pedidos pagos do mesmo telefone", () => {
  const spent = new Map<string, number>();
  addRecoverySpend(spent, "5511986747851", "80.50");
  addRecoverySpend(spent, "11986747851", 19.5);
  addRecoverySpend(spent, "5561996250634", "10.00");
  assert.equal(spent.get("5511986747851"), 10000);
  assert.equal(canonicalRecoveryPhone("556196250634"), "5561996250634");
});

test("pedido antigo sem total usa o valor pago ou os produtos", () => {
  assert.equal(recoveryOrderAmount({ total: "0.00", paidAmount: "150,00" }), 150);
  assert.equal(recoveryOrderAmount({
    total: 0,
    products: [{ quantity: 2, price: "40.00", lineDiscount: 10 }],
    shippingCost: "20.00",
    discountAmount: 0,
  }), 90);
});

test("pesquisa reconhece o clique e calcula a porcentagem", () => {
  assert.equal(recoveryAnswerId("preco"), "preco");
  assert.equal(recoveryAnswerId("2"), "objetivo");
  assert.equal(recoveryAnswerId("outro"), null);
  const list = recoveryOptionList();
  assert.equal(list.options.length, 4);
  assert.ok(list.options.every((option) => option.title.length <= 24));
  const stats = recoverySurveyStats(new Map([["preco", 5], ["vendas", 5], ["", 30]]));
  assert.equal(stats.answered, 10);
  assert.equal(stats.unanswered, 30);
  assert.equal(stats.options[0].percent, 50);
});

test("horário salvo libera o envio dentro da faixa", () => {
  const night = new Date("2026-10-23T23:30:00.000Z");
  assert.equal(recoveryQuietHours(night, 10, 19), true);
  assert.equal(recoveryQuietHours(night, 10, 22), false);
  assert.equal(recoveryQuietHours(new Date("2026-10-23T14:30:00.000Z"), 10, 19), false);
});

test("mensagem troca o primeiro nome", () => {
  const text = recoveryMessage("Oi, {nome}.", "Maria Silva");
  assert.equal(text, "Oi, Maria.");
});
