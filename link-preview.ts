type HeadersMap = Record<string, string | string[] | undefined>;

type SiteSettings = {
  site_name?: string;
  logo?: string;
};

function getHeader(headers: HeadersMap, key: string): string {
  const value = headers[key.toLowerCase()] ?? headers[key];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function normalizeHost(raw: string): string {
  return String(raw || "")
    .split(",")[0]
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchSiteSettings(apiUrl: string): Promise<SiteSettings | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as SiteSettings;
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: any, res: any) {
  const hostHeader = getHeader(req.headers || {}, "x-forwarded-host") || getHeader(req.headers || {}, "host");
  const protoHeader = getHeader(req.headers || {}, "x-forwarded-proto") || "https";
  const host = normalizeHost(hostHeader);
  const protocol = protoHeader === "http" ? "http" : "https";

  const path = String(req.query?.path || "").trim().replace(/^\/+/, "");
  const pathname = path ? `/${path}` : "/";
  const canonicalUrl = host ? `${protocol}://${host}${pathname}` : pathname;

  const settingsUrl = host
    ? `${protocol}://${host}/api/settings?domain=${encodeURIComponent(host)}`
    : "";

  const settings = settingsUrl ? await fetchSiteSettings(settingsUrl) : null;
  const siteName = String(settings?.site_name || "").trim() || "KA Imports";
  const description = `Confira os produtos da loja ${siteName}.`;
  const logo = String(settings?.logo || "").trim();

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(siteName)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(siteName)}" />
  <meta property="og:site_name" content="${escapeHtml(siteName)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  ${logo ? `<meta property="og:image" content="${escapeHtml(logo)}" />` : ""}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(siteName)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  ${logo ? `<meta name="twitter:image" content="${escapeHtml(logo)}" />` : ""}
  <meta http-equiv="refresh" content="0; url=${escapeHtml(pathname)}" />
</head>
<body>
  <script>window.location.replace(${JSON.stringify(pathname)});</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  res.status(200).send(html);
}
