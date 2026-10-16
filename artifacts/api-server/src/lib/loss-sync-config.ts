import { timingSafeEqual } from "crypto";

export const LOSS_SNAPSHOT_SOURCE = "ka-imports";
export const YURY_LOSS_SOURCE = "yury-imports";
export const LOSS_SNAPSHOT_PATH = "/api/integrations/loss-blacklist/snapshot";

/** Senha que a Yury usa para ler a nossa lista. Não é o token de leitura da lista deles. */
export function getLossSyncToken(): string {
  return String(process.env.LOSS_SYNC_TOKEN || "").trim();
}

/** Valor do LOSS_SYNC_TOKEN criado no Railway da Yury. Só serve para ler o snapshot deles. */
export function getYuryLossSyncToken(): string {
  return String(process.env.YURY_LOSS_SYNC_TOKEN || "").trim();
}

export function yuryLossPullBlockReason(): string | null {
  const peer = getYuryLossSyncToken();
  if (!peer) return "YURY_LOSS_SYNC_TOKEN ausente";
  const own = getLossSyncToken();
  if (own && own === peer) return "YURY_LOSS_SYNC_TOKEN igual ao LOSS_SYNC_TOKEN";
  return null;
}

export function isYuryLossPullConfigured(): boolean {
  return yuryLossPullBlockReason() == null;
}

export function readLossSyncCredential(authorization: unknown, apiKey: unknown): string {
  const auth = String(authorization || "");
  const bearer = /^Bearer\s+(\S+)/i.exec(auth);
  if (bearer?.[1]) return bearer[1].trim();
  return String(apiKey || "").trim();
}

export function lossSyncAuthStatus(presented: string, configured: string): 200 | 401 | 503 {
  if (!configured) return 503;
  if (!presented || !safeEqual(presented, configured)) return 401;
  return 200;
}

function safeEqual(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
