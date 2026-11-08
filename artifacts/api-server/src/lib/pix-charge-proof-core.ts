import crypto from "crypto";
import { safeTokenEquals } from "./pix-settlement";

/** SHA-256 hex do token devolvido pelo gateway. Não é o segredo global. */
export function hashPixWebhookToken(token: string): string {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function pixTokenHashMatches(storedHash: string, presentedToken: string): boolean {
  const stored = String(storedHash || "").trim();
  const presented = String(presentedToken || "").trim();
  if (!stored || !presented) return false;
  return safeTokenEquals(stored, hashPixWebhookToken(presented));
}

export type PixAuthentication =
  | { ok: true; method: "shared_secret" | "transaction_token" }
  | { ok: false; httpStatus: 403; reason: "untrusted" | "proof_not_stored" | "token_mismatch" };

/**
 * O segredo global (whsec/cabeçalho) continua valendo para cobrança emitida com ele.
 * O token do corpo só vale se já existir o hash gravado na criação da mesma transação.
 * Sem hash, o aviso não cadastra confiança.
 */
export function decidePixAuthentication(input: {
  globalSecretMatches: boolean;
  presentedToken: string;
  storedTokenHash: string | null;
}): PixAuthentication {
  if (input.globalSecretMatches) return { ok: true, method: "shared_secret" };
  const presented = String(input.presentedToken || "").trim();
  if (!presented) return { ok: false, httpStatus: 403, reason: "untrusted" };
  const stored = String(input.storedTokenHash || "").trim();
  if (!stored) return { ok: false, httpStatus: 403, reason: "proof_not_stored" };
  if (!pixTokenHashMatches(stored, presented)) {
    return { ok: false, httpStatus: 403, reason: "token_mismatch" };
  }
  return { ok: true, method: "transaction_token" };
}
