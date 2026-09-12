import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCustomerDocument, parseOptionalCustomerDocument } from "./customer-document";

test("CPF opcional vazio é válido", () => {
  assert.deepEqual(parseOptionalCustomerDocument(""), { ok: true, document: null });
  assert.deepEqual(parseOptionalCustomerDocument("   "), { ok: true, document: null });
  assert.deepEqual(parseOptionalCustomerDocument(undefined), { ok: true, document: null });
});

test("CPF formatado vira só dígitos", () => {
  assert.equal(normalizeCustomerDocument("050.405.766-92"), "05040576692");
  assert.deepEqual(parseOptionalCustomerDocument("050.405.766-92"), { ok: true, document: "05040576692" });
});

test("CPF com tamanho errado é recusado", () => {
  const parsed = parseOptionalCustomerDocument("123");
  assert.equal(parsed.ok, false);
});
