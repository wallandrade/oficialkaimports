import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "mysql://unit:test@127.0.0.1:3306/unused";
}

const {
  DEFAULT_TENANT_ID,
  isDefaultTenantFallbackHost,
  resolveExplicitDomainTenant,
  resolvePublicTenantId,
} = await import("./tenant-context");

type Row = { id: string; domain: string | null };

function fakeReq(headers: Record<string, string>): Request {
  return {
    get(name: string) {
      return headers[name.toLowerCase()] ?? headers[name];
    },
  } as Request;
}

function lookup(rows: Row[]) {
  return async () => rows;
}

test("host da loja principal cai em tenant_loja1", async () => {
  const tenantId = await resolvePublicTenantId(
    fakeReq({ host: "ka-imports.com" }),
    lookup([]),
  );
  assert.equal(tenantId, DEFAULT_TENANT_ID);

  const www = await resolvePublicTenantId(
    fakeReq({ "x-forwarded-host": "www.ka-imports.com", host: "lobster-app.ondigitalocean.app" }),
    lookup([]),
  );
  assert.equal(www, DEFAULT_TENANT_ID);
});

test("domínio de filial cadastrado resolve o tenant dela", async () => {
  const rows = [{ id: "tenant_fh", domain: "fh-imports.site" }];
  const tenantId = await resolvePublicTenantId(
    fakeReq({
      "x-forwarded-host": "www.fh-imports.site",
      host: "lobster-app-7f8c2.ondigitalocean.app",
      origin: "https://www.fh-imports.site",
    }),
    lookup(rows),
  );
  assert.equal(tenantId, "tenant_fh");
});

test("domínio desconhecido não cai na loja principal", async () => {
  const tenantId = await resolvePublicTenantId(
    fakeReq({
      "x-forwarded-host": "www.fh-imports.site",
      host: "lobster-app-7f8c2.ondigitalocean.app",
      origin: "https://www.fh-imports.site",
    }),
    lookup([]),
  );
  assert.equal(tenantId, null);

  const byQuery = await resolveExplicitDomainTenant("www.fh-imports.site", lookup([]));
  assert.equal(byQuery, null);
});

test("sem host e host só da API continuam na loja principal", async () => {
  const noHost = await resolvePublicTenantId(fakeReq({}), lookup([]));
  assert.equal(noHost, DEFAULT_TENANT_ID);

  const appHost = await resolvePublicTenantId(
    fakeReq({ host: "lobster-app-7f8c2.ondigitalocean.app" }),
    lookup([]),
  );
  assert.equal(appHost, DEFAULT_TENANT_ID);
});

test("localhost, preview e domínio explícito da loja principal caem na loja 1", async () => {
  assert.equal(isDefaultTenantFallbackHost("localhost"), true);
  assert.equal(isDefaultTenantFallbackHost("127.0.0.1"), true);
  assert.equal(isDefaultTenantFallbackHost("preview-abc.vercel.app"), true);
  assert.equal(isDefaultTenantFallbackHost("www.fh-imports.site"), false);

  const local = await resolvePublicTenantId(fakeReq({ host: "localhost:5173" }), lookup([]));
  assert.equal(local, DEFAULT_TENANT_ID);

  const explicit = await resolveExplicitDomainTenant("https://www.ka-imports.com/loja", lookup([]));
  assert.equal(explicit, DEFAULT_TENANT_ID);
});

test("referer externo não tira a loja principal; origin de filial sem cadastro bloqueia", async () => {
  const fromSearch = await resolvePublicTenantId(
    fakeReq({
      host: "ka-imports.com",
      referer: "https://www.fh-imports.site/produto/1",
    }),
    lookup([]),
  );
  assert.equal(fromSearch, DEFAULT_TENANT_ID);

  const directApi = await resolvePublicTenantId(
    fakeReq({
      host: "lobster-app-7f8c2.ondigitalocean.app",
      origin: "https://www.fh-imports.site",
    }),
    lookup([]),
  );
  assert.equal(directApi, null);
});

test("MAIN_STORE_DOMAINS acrescenta host da loja principal", async () => {
  const previous = process.env.MAIN_STORE_DOMAINS;
  process.env.MAIN_STORE_DOMAINS = "ka-imports.com,loja.example";
  try {
    assert.equal(isDefaultTenantFallbackHost("loja.example"), true);
    assert.equal(isDefaultTenantFallbackHost("www.loja.example"), true);
    const tenantId = await resolvePublicTenantId(fakeReq({ host: "loja.example" }), lookup([]));
    assert.equal(tenantId, DEFAULT_TENANT_ID);
  } finally {
    if (previous == null) delete process.env.MAIN_STORE_DOMAINS;
    else process.env.MAIN_STORE_DOMAINS = previous;
  }
});
