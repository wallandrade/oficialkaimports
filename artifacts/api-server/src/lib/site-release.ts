export const SITE_RELEASE_ENABLED_KEY = "site_release_enabled";
export const SITE_RELEASE_AT_KEY = "site_release_at";
export const SITE_RELEASE_MESSAGE_KEY = "site_release_message";
export const SITE_RELEASE_KEYS = [
  SITE_RELEASE_ENABLED_KEY,
  SITE_RELEASE_AT_KEY,
  SITE_RELEASE_MESSAGE_KEY,
] as const;

export const DEFAULT_SITE_RELEASE_MESSAGE = "Promoção começa em";
export const SITE_RELEASE_TIME_ZONE = "America/Sao_Paulo";
export const SITE_RELEASE_MESSAGE_MAX = 80;

const ENABLED_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

export type SiteReleaseCountdown = {
  message: string;
  releaseAt: string;
  serverNow: string;
};

export type SiteProtectionDecision = {
  site: boolean;
  payment: boolean;
  release: SiteReleaseCountdown | null;
};

export function isSiteReleaseEnabled(value: string | undefined | null): boolean {
  return ENABLED_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function timeZoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
}

/** Wall clock `YYYY-MM-DDTHH:mm` em America/Sao_Paulo. Sem fuso no texto. */
export function parseSaoPauloDateTime(value: string): Date | null {
  const match = WALL_CLOCK.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || "0");
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wallUtc);
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) {
    return null;
  }

  let utc = wallUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = timeZoneOffsetMs(SITE_RELEASE_TIME_ZONE, new Date(utc));
    const next = wallUtc - offset;
    if (next === utc) break;
    utc = next;
  }
  const result = new Date(utc);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function normalizeSiteReleaseAt(value: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, message: "Informe a data e a hora de Brasília." };
  const match = WALL_CLOCK.exec(raw);
  const parsed = match ? parseSaoPauloDateTime(raw) : null;
  if (!match || !parsed) {
    return { ok: false, message: "Data ou hora inválida. Use o horário de Brasília." };
  }
  return { ok: true, value: `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}` };
}

export function normalizeSiteReleaseMessage(value: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length > SITE_RELEASE_MESSAGE_MAX) {
    return { ok: false, message: "A mensagem pode ter no máximo 80 caracteres." };
  }
  return { ok: true, value: text };
}

function hasSecret(value: string | undefined): boolean {
  return String(value || "").length > 0;
}

/**
 * Decide a senha do site com o relógio do servidor.
 * A senha da página de pagamento não entra nessa conta.
 * Cada chamada lê só o mapa daquela loja — filial não herda a principal.
 */
export function decideSiteProtection(
  settings: Record<string, string | undefined>,
  now: Date = new Date(),
): SiteProtectionDecision {
  const payment = hasSecret(settings.payment_password);
  const hasSitePassword = hasSecret(settings.site_password);
  if (!hasSitePassword || !isSiteReleaseEnabled(settings.site_release_enabled)) {
    return { site: hasSitePassword, payment, release: null };
  }

  const releaseDate = parseSaoPauloDateTime(String(settings.site_release_at || ""));
  if (!releaseDate) {
    return { site: true, payment, release: null };
  }
  if (now.getTime() >= releaseDate.getTime()) {
    return { site: false, payment, release: null };
  }

  const custom = normalizeSiteReleaseMessage(settings.site_release_message);
  const message = (custom.ok ? custom.value : "") || DEFAULT_SITE_RELEASE_MESSAGE;
  return {
    site: true,
    payment,
    release: {
      message,
      releaseAt: releaseDate.toISOString(),
      serverNow: now.toISOString(),
    },
  };
}
