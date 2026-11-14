import assert from "node:assert/strict";
import test from "node:test";
import { parseGuestCustomerEmail, pickTenantCustomer, isUnsetCustomerPassword } from "./customer-guest-account-core";

test("id de convidado vira e-mail e lixo não vira", () => {
  assert.equal(parseGuestCustomerEmail("guest:Liliany@Gmail.com"), "liliany@gmail.com");
  assert.equal(parseGuestCustomerEmail("  GUEST:loja@example.test "), "loja@example.test");
  assert.equal(parseGuestCustomerEmail("guest:"), null);
  assert.equal(parseGuestCustomerEmail("cus_123"), null);
  assert.equal(parseGuestCustomerEmail("guest:sem-arroba"), null);
});

test("senha ainda não escolhida só pelo prefixo do salt", () => {
  assert.equal(isUnsetCustomerPassword("nopass:abc"), true);
  assert.equal(isUnsetCustomerPassword("abc"), false);
  assert.equal(isUnsetCustomerPassword(null), false);
});

test("a conta da própria loja ganha da linha legada sem tenant", () => {
  const rows = [
    { id: "legado", tenantId: null },
    { id: "loja", tenantId: "tenant_loja1" },
    { id: "filial", tenantId: "tenant_filial" },
  ];
  assert.equal(pickTenantCustomer(rows, "tenant_loja1")?.id, "loja");
  assert.equal(pickTenantCustomer([{ id: "legado", tenantId: "" }], "tenant_loja1")?.id, "legado");
  assert.equal(pickTenantCustomer(rows, "tenant_filial")?.id, "filial");
});
