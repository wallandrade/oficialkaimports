import assert from "node:assert/strict";
import test from "node:test";

import { parseOfxDate, parseOfxStatement } from "./ofx-bank-statement";
import { nameSimilarity, matchIdentityScore, reconcileBankStatement } from "./bank-statement-reconcile";

test("parseOfxDate converte YYYYMMDD", () => {
  assert.equal(parseOfxDate("20260810"), "2026-08-10");
  assert.equal(parseOfxDate("20260810143000"), "2026-08-10");
});

test("parser OFX ignora debito e pega credito com FITID", () => {
  const ofx = `
<OFX>
<ORG>Banco Inter
<ACCTID>1234560921
<DTSTART>20260801
<DTEND>20260817
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260810
<TRNAMT>-50.00
<FITID>deb1
<NAME>Tarifa
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260812
<TRNAMT>856.30
<FITID>pix-douglas
<NAME>Douglas Bonn
<MEMO>Pix recebido: Douglas Bonn
</STMTTRN>
</BANKTRANLIST>
</OFX>
`;
  const parsed = parseOfxStatement(ofx);
  assert.equal(parsed.debitCount, 1);
  assert.equal(parsed.credits.length, 1);
  assert.equal(parsed.credits[0]?.amountCents, 85630);
  assert.equal(parsed.credits[0]?.fitid, "pix-douglas");
  assert.equal(parsed.meta.acctIdMasked, "****0921");
});

test("nome igual gera score 100%", () => {
  assert.equal(nameSimilarity("Douglas Bonn", "Douglas Bonn"), 1);
  assert.ok(nameSimilarity("Maria da Silva", "Maria Silva") > 0.6);
});

test("match 100% valor exato + nome + janela", () => {
  const report = reconcileBankStatement({
    credits: [{
      fitid: "pix-douglas",
      postedAt: "2026-08-12",
      amount: 856.3,
      amountCents: 85630,
      name: "Douglas Bonn",
      memo: "Pix recebido",
      trnType: "CREDIT",
    }],
    orders: [{
      id: "ord-1",
      orderNumber: 603,
      clientName: "Douglas Bonn",
      totalCents: 85630,
      createdAt: "2026-08-10T15:00:00.000Z",
      status: "paid",
    }],
    dateWindowDays: 5,
  });
  assert.equal(report.matched.length, 1);
  assert.equal(report.matched[0]?.nameScore, 1);
  assert.equal(report.matched[0]?.orderNumber, 603);
});

test("mesmo valor e nomes diferentes vira ambiguo", () => {
  const report = reconcileBankStatement({
    credits: [{
      fitid: "a",
      postedAt: "2026-08-17",
      amount: 2157,
      amountCents: 215700,
      name: "Maria Rosangela Silva Barbosa",
      memo: null,
      trnType: "CREDIT",
    }],
    orders: [
      { id: "1", orderNumber: 1, clientName: "Maria Rosangela Silva Barbosa", totalCents: 215700, createdAt: "2026-08-16T12:00:00.000Z", status: "pending" },
      { id: "2", orderNumber: 2, clientName: "Outro Cliente", totalCents: 215700, createdAt: "2026-08-16T12:00:00.000Z", status: "pending" },
    ],
    dateWindowDays: 5,
  });
  assert.equal(report.matched.length, 1);
  assert.equal(report.matched[0]?.orderId, "1");
});

test("CPF no NAME do OFX gera score 100% mesmo com nome diferente", () => {
  assert.equal(
    matchIdentityScore({
      creditName: "Fulano Silva 05040576692",
      creditMemo: null,
      clientName: "Maria Aparecida",
      clientDocument: "050.405.766-92",
    }),
    1,
  );
  assert.ok(
    matchIdentityScore({
      creditName: "Wellington Rocha",
      creditMemo: null,
      clientName: "Maria Aparecida",
      clientDocument: "050.405.766-92",
    }) < 0.5,
  );
});

test("match 100% por CPF no credito com valor e janela", () => {
  const report = reconcileBankStatement({
    credits: [{
      fitid: "pix-cpf",
      postedAt: "2026-08-12",
      amount: 1768.8,
      amountCents: 176880,
      name: "Wellington Rocha Dos Santos 05040576692",
      memo: "Pix recebido",
      trnType: "CREDIT",
    }],
    orders: [{
      id: "ord-maria",
      orderNumber: 1832,
      clientName: "Maria Aparecida Ferreira Barbosa Santos",
      clientDocument: "050.405.766-92",
      totalCents: 176880,
      createdAt: "2026-08-12T11:53:00.000Z",
      status: "paid",
    }],
    dateWindowDays: 5,
  });
  assert.equal(report.matched.length, 1);
  assert.equal(report.matched[0]?.nameScore, 1);
  assert.equal(report.matched[0]?.orderNumber, 1832);
});
