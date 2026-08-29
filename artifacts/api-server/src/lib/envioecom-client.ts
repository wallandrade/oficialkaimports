export class EnvioEcomApiError extends Error {
  code: string;
  details: unknown;
  httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400, details: unknown = null) {
    super(message);
    this.name = "EnvioEcomApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

type TokenCacheEntry = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();

export function formatEnvioEcomDetails(details: unknown): string {
  if (details == null || details === "") return "";
  if (typeof details === "string" || typeof details === "number" || typeof details === "boolean") {
    return String(details).trim();
  }
  if (Array.isArray(details)) {
    return details.map((item) => formatEnvioEcomDetails(item)).filter(Boolean).join("; ");
  }
  if (typeof details === "object") {
    const row = details as Record<string, unknown>;
    const field = String(row.field || row.path || row.attribute || "").trim();
    const msg = String(row.message || row.reason || row.error || "").trim();
    if (field || msg) {
      const rest = Object.entries(row)
        .filter(([key]) => !["field", "path", "attribute", "message", "reason", "error"].includes(key))
        .map(([key, value]) => {
          const nested = formatEnvioEcomDetails(value);
          return nested ? `${key}: ${nested}` : "";
        })
        .filter(Boolean)
        .join("; ");
      const main = field && msg ? `${field}: ${msg}` : (msg || field);
      return [main, rest].filter(Boolean).join("; ");
    }
    return Object.entries(row)
      .map(([key, value]) => {
        const nested = formatEnvioEcomDetails(value);
        return nested ? `${key}: ${nested}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

function parseErrorPayload(payload: unknown, httpStatus: number): EnvioEcomApiError {
  const body = payload as { error?: { code?: string; message?: string; details?: unknown }; message?: string; code?: string; details?: unknown };
  const code = String(body?.error?.code || body?.code || "INTERNAL_ERROR");
  const details = body?.error?.details ?? body?.details ?? null;
  const base = String(body?.error?.message || body?.message || "").trim();
  const detailText = formatEnvioEcomDetails(details);
  const message = [base, detailText].filter(Boolean).join(" — ") || "Erro na EnvioEcom.";
  return new EnvioEcomApiError(code, message, httpStatus, details);
}

async function readResponseBody(res: Response): Promise<{ json: unknown | null; buffer: Buffer; contentType: string }> {
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (contentType.includes("application/json") || buffer.slice(0, 1).toString() === "{") {
    try {
      return { json: JSON.parse(buffer.toString("utf8")), buffer, contentType };
    } catch {
      return { json: null, buffer, contentType };
    }
  }
  return { json: null, buffer, contentType };
}

export type EnvioEcomClientOptions = {
  tenantId: string;
  accountId?: string;
  baseUrl: string;
  token?: string;
  email?: string;
  password?: string;
  neverExpires?: boolean;
};

function tokenCacheKey(options: EnvioEcomClientOptions): string {
  return `${options.tenantId}:${options.accountId || "default"}`;
}

export function createEnvioEcomClient(options: EnvioEcomClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const cacheKey = tokenCacheKey(options);

  async function generateToken(): Promise<string> {
    if (!options.email || !options.password) {
      throw new EnvioEcomApiError("TOKEN_MISSING", "EnvioEcom não configurado: informe token ou e-mail e senha.", 400);
    }
    const res = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: options.email,
        password: options.password,
        never_expires: options.neverExpires !== false,
      }),
    });
    const body = await readResponseBody(res);
    if (!res.ok) throw parseErrorPayload(body.json, res.status);
    const token = String((body.json as { token?: string } | null)?.token || "").trim();
    if (!token) throw new EnvioEcomApiError("TOKEN_INVALID", "A EnvioEcom não retornou token.", 502);
    const expiresAt = options.neverExpires !== false ? Date.now() + 30 * 24 * 60 * 60 * 1000 : Date.now() + 170 * 24 * 60 * 60 * 1000;
    tokenCache.set(cacheKey, { token, expiresAt });
    return token;
  }

  async function getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && options.token) return options.token;
    const cached = tokenCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    return generateToken();
  }

  async function requestJson<T>(path: string, init: RequestInit & { retryOnExpired?: boolean } = {}): Promise<T> {
    const token = await getToken();
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Partner-Token": token,
        ...(init.headers || {}),
      },
    });
    const body = await readResponseBody(res);
    if ((res.status === 401 || res.status === 403) && init.retryOnExpired !== false && (options.email && options.password)) {
      const code = String((body.json as { error?: { code?: string } } | null)?.error?.code || "");
      if (["TOKEN_EXPIRED", "TOKEN_INVALID", "TOKEN_MISSING", "FORBIDDEN"].includes(code) || res.status === 401) {
        await getToken(true);
        return requestJson<T>(path, { ...init, retryOnExpired: false });
      }
    }
    if (!res.ok) throw parseErrorPayload(body.json, res.status);
    return (body.json || {}) as T;
  }

  async function requestPdf(path: string, payload: unknown): Promise<{ kind: "pdf"; buffer: Buffer } | { kind: "json"; json: unknown }> {
    const token = await getToken();
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Partner-Token": token,
      },
      body: JSON.stringify(payload),
    });
    const body = await readResponseBody(res);
    if (!res.ok) throw parseErrorPayload(body.json, res.status);
    if (body.json) return { kind: "json", json: body.json };
    if (body.contentType.includes("pdf") || body.buffer.slice(0, 4).toString() === "%PDF") {
      return { kind: "pdf", buffer: body.buffer };
    }
    return { kind: "json", json: body.json };
  }

  return {
    quote(payload: unknown) {
      return requestJson<Record<string, unknown>>("/shipping/quote", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    create(payload: unknown) {
      return requestJson<Record<string, unknown>>("/shipping/create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    getById(id: number | string) {
      return requestJson<Record<string, unknown>>(`/shipments/by-id/${encodeURIComponent(String(id))}`);
    },
    getByIdentifier(identifier: string) {
      return requestJson<Record<string, unknown>>(`/shipments/${encodeURIComponent(identifier)}`);
    },
    list(params: Record<string, string | number | undefined>) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value == null || value === "") continue;
        search.set(key, String(value));
      }
      const qs = search.toString();
      return requestJson<Record<string, unknown>>(`/shipments${qs ? `?${qs}` : ""}`);
    },
    cancel(identifier: string, reason?: string) {
      return requestJson<Record<string, unknown>>(`/shipments/${encodeURIComponent(identifier)}/cancel`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      });
    },
    generateLabels(payload: { ids?: number[]; barcodes?: string[] }) {
      return requestPdf("/shipments/generate-labels", payload);
    },
    getWebhook() {
      return requestJson<{ url?: string | null; enabled?: boolean }>("/webhook");
    },
    setWebhook(payload: { url?: string | null; enabled?: boolean }) {
      return requestJson<{ message?: string; url?: string | null; enabled?: boolean }>("/webhook", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
  };
}

export type EnvioEcomClient = ReturnType<typeof createEnvioEcomClient>;
