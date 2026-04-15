// ---------------------------------------------------------------------------
// IP Geolocation — ip-api.com (free tier, no key required)
// Docs: https://ip-api.com/docs/api:json
// Rate limit: 45 req/min on free plan
// ---------------------------------------------------------------------------

export interface IpGeoResult {
  city: string | null;
  region: string | null;
  isp: string | null;
  isProxy: boolean;
}

const TIMEOUT_MS = 4000;

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === "IP_NAO_ENCONTRADO") return true;
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "127.0.0.1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("::ffff:")) return true;
  return false;
}

export async function lookupIpGeo(ip: string): Promise<IpGeoResult | null> {
  const cleaned = String(ip || "").trim().replace(/^::ffff:/, "");
  if (!cleaned || isPrivateIp(cleaned)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const url = `http://ip-api.com/json/${encodeURIComponent(cleaned)}?fields=status,city,regionName,isp,proxy,hosting`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;

    const data = await res.json() as {
      status: string;
      city?: string;
      regionName?: string;
      isp?: string;
      proxy?: boolean;
      hosting?: boolean;
    };

    if (data.status !== "success") return null;

    return {
      city:    data.city    ?? null,
      region:  data.regionName ?? null,
      isp:     data.isp     ?? null,
      isProxy: !!(data.proxy || data.hosting),
    };
  } catch {
    return null;
  }
}
