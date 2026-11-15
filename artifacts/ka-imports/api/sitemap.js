// Páginas públicas do Wouter em src/App.tsx. Checkout, login, admin,
// pagamento e o prefixo /:seller ficam de fora: o seller repete o mesmo
// catálogo em /produto/:id e /categoria/:nome.
export const PUBLIC_SITEMAP_PATHS = Object.freeze([
  "/",
  "/ofertas",
  "/frete",
  "/suporte",
  "/kyc",
  "/rifas",
]);

const DEFAULT_ORIGIN = "https://www.ka-imports.com";
// Mesmo destino do rewrite /api no vercel.json. A função não pede /api/products
// no próprio host: o preview da Vercel exige login e essa chamada voltaria 503.
export const CATALOG_API_ORIGIN = "https://lobster-app-7f8c2.ondigitalocean.app";

function headerValue(headers, key) {
  const value = headers?.[key.toLowerCase()] ?? headers?.[key];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

export function requestOrigin(headers) {
  const rawHost = headerValue(headers, "x-forwarded-host") || headerValue(headers, "host");
  const protoHeader = headerValue(headers, "x-forwarded-proto").split(",")[0].trim().toLowerCase();
  const proto = protoHeader === "http" ? "http" : "https";
  let host = rawHost.split(",")[0].trim().replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  if (!host) return DEFAULT_ORIGIN;
  if (proto === "https") host = host.replace(/:443$/, "");
  if (proto === "http") host = host.replace(/:80$/, "");
  return `${proto}://${host}`;
}

export function categoryPath(category) {
  return `/categoria/${encodeURIComponent(String(category).trim())}`;
}

export function productPath(id) {
  return `/produto/${encodeURIComponent(String(id).trim())}`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function lastmodDay(value) {
  const text = String(value || "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!match || !Number.isFinite(Date.parse(text))) return "";
  return match[1];
}

export function buildSitemapXml(origin, catalog) {
  const base = String(origin || DEFAULT_ORIGIN).replace(/\/+$/, "");
  const entries = [];
  const seen = new Set();
  const add = (path, lastmod = "") => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    entries.push({ path, lastmod });
  };

  for (const path of PUBLIC_SITEMAP_PATHS) add(path);

  const categories = [];
  const listed = Array.isArray(catalog?.categories) ? catalog.categories : [];
  for (const category of listed) {
    const name = String(category || "").trim();
    if (name && !categories.includes(name)) categories.push(name);
  }

  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  for (const product of products) {
    if (!product || product.isActive === false) continue;
    const name = String(product.category || "").trim();
    if (name && !categories.includes(name)) categories.push(name);
  }
  for (const name of categories) add(categoryPath(name));

  for (const product of products) {
    if (!product || product.isActive === false) continue;
    const id = String(product.id ?? "").trim();
    if (!id) continue;
    add(productPath(id), lastmodDay(product.updatedAt || product.createdAt));
  }

  const urls = entries
    .map(({ path, lastmod }) => {
      const loc = xmlEscape(`${base}${path}`);
      const modified = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
      return `  <url>\n    <loc>${loc}</loc>${modified}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function catalogRequest(pageOrigin) {
  const page = new URL(pageOrigin || DEFAULT_ORIGIN);
  return {
    url: `${CATALOG_API_ORIGIN}/api/products`,
    headers: {
      Accept: "application/json",
      "x-forwarded-host": page.host,
      "x-forwarded-proto": page.protocol === "http:" ? "http" : "https",
    },
  };
}

async function fetchCatalog(origin) {
  const request = catalogRequest(origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GET /api/products respondeu ${response.status}`);
    }
    const data = await response.json();
    if (!data || typeof data !== "object" || !Array.isArray(data.products)) {
      throw new Error("GET /api/products não trouxe a lista de produtos");
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  const origin = requestOrigin(req?.headers || {});
  try {
    const catalog = await fetchCatalog(origin);
    const xml = buildSitemapXml(origin, catalog);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(xml);
  } catch (err) {
    const message = err instanceof Error ? err.message : "falha ao montar o sitemap";
    console.error("[sitemap]", message);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(503).send("Sitemap indisponível");
  }
}
