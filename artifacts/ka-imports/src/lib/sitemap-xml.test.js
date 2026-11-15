import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CATALOG_API_ORIGIN,
  PUBLIC_SITEMAP_PATHS,
  buildSitemapXml,
  catalogRequest,
  categoryPath,
  productPath,
  requestOrigin,
} from "../../api/sitemap.js";

const origin = "https://www.ka-imports.com";

test("o host da visita vira a origem do sitemap", () => {
  assert.equal(
    requestOrigin({ "x-forwarded-host": "www.ka-imports.com", "x-forwarded-proto": "https" }),
    origin,
  );
  assert.equal(
    requestOrigin({ host: "localhost:5173", "x-forwarded-proto": "http" }),
    "http://localhost:5173",
  );
  assert.equal(requestOrigin({}), origin);
  assert.equal(
    requestOrigin({ "x-forwarded-host": ["Loja.example:443", "ignored"], "x-forwarded-proto": "https" }),
    "https://loja.example",
  );
});

test("o catálogo sai da API na DigitalOcean, com o host da página", () => {
  const preview = catalogRequest(
    "https://oficialkaimports-api-serv-git-61b9f0-wallaces-projects-fbe0ff99.vercel.app",
  );
  assert.equal(preview.url, `${CATALOG_API_ORIGIN}/api/products`);
  assert.equal(
    preview.headers["x-forwarded-host"],
    "oficialkaimports-api-serv-git-61b9f0-wallaces-projects-fbe0ff99.vercel.app",
  );
  assert.equal(preview.headers["x-forwarded-proto"], "https");

  const local = catalogRequest("http://localhost:5173");
  assert.equal(local.headers["x-forwarded-host"], "localhost:5173");
  assert.equal(local.headers["x-forwarded-proto"], "http");
});

test("categoria e produto usam os paths do router", () => {
  assert.equal(categoryPath("Água"), "/categoria/%C3%81gua");
  assert.equal(categoryPath(" Botox "), "/categoria/Botox");
  assert.equal(productPath("aeed08c49496e9ec"), "/produto/aeed08c49496e9ec");
  assert.equal(productPath("id com espaço"), "/produto/id%20com%20espa%C3%A7o");
});

test("o XML lista páginas públicas, categorias e produtos ativos", () => {
  const xml = buildSitemapXml(origin, {
    categories: ["Tirzepatida", "Água", "Água"],
    products: [
      { id: "ativo", category: "Tirzepatida", isActive: true, createdAt: "2026-04-18T15:54:19.000Z" },
      { id: "esgotado", category: "Botox", isActive: true, isSoldOut: true, createdAt: "2026-05-01T00:00:00.000Z" },
      { id: "inativo", category: "Oculta", isActive: false, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "", category: "Tirzepatida", isActive: true },
    ],
  });

  for (const path of PUBLIC_SITEMAP_PATHS) {
    assert.equal(xml.includes(`<loc>${origin}${path}</loc>`), true, path);
  }
  assert.equal(xml.includes(`${origin}/categoria/Tirzepatida`), true);
  assert.equal(xml.includes(`${origin}/categoria/%C3%81gua`), true);
  assert.equal(xml.includes(`${origin}/categoria/Botox`), true);
  assert.equal(xml.includes(`${origin}/categoria/%C3%81gua`), true);
  assert.equal(xml.split("/categoria/%C3%81gua").length - 1, 1);
  assert.equal(xml.includes(`${origin}/produto/ativo`), true);
  assert.equal(xml.includes("<lastmod>2026-04-18</lastmod>"), true);
  assert.equal(xml.includes(`${origin}/produto/esgotado`), true);
  assert.equal(xml.includes("/produto/inativo"), false);
  assert.equal(xml.includes("Oculta"), false);
  assert.equal(xml.includes("/checkout"), false);
  assert.equal(xml.includes("/admin"), false);
  assert.equal(xml.includes("/login"), false);
  assert.equal(xml.includes("/pagamento"), false);
  assert.equal(xml.includes("/:seller"), false);
  assert.equal(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), true);
  assert.equal(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'), true);
});

test("robots.txt aponta o sitemap e bloqueia admin, checkout, login e pagamento", () => {
  const robots = readFileSync(new URL("../../public/robots.txt", import.meta.url), "utf8");
  const lines = robots.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.equal(lines.includes("Disallow: /"), false);
  for (const line of [
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /checkout",
    "Disallow: /login",
    "Disallow: /pagamento",
    "Disallow: /payment-link",
    "Disallow: /pix/",
    "Disallow: /rifas/pix/",
    "Disallow: /*/checkout",
    "Sitemap: https://www.ka-imports.com/sitemap.xml",
  ]) {
    assert.equal(lines.includes(line), true, line);
  }
});

test("o rewrite do sitemap fica na frente do proxy /api e fora do fallback da SPA", () => {
  const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const rewrites = vercel.rewrites;
  assert.equal(rewrites[0].source, "/sitemap.xml");
  assert.equal(rewrites[0].destination, "/api/sitemap");
  assert.equal(rewrites[1].source, "/api/:path*");
  assert.match(rewrites[1].destination, /^https:\/\/lobster-app-7f8c2\.ondigitalocean\.app\/api\/:path\*$/);
  const spa = rewrites.find((rule) => rule.destination === "/index.html");
  assert.match(spa.source, /robots\.txt/);
  assert.match(spa.source, /sitemap\.xml/);
});
