import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_SECONDS = 300;

export function buildYuryMotoboySignatureHeader(secret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyYuryMotoboySignature(secret: string, rawBody: Buffer | string, header: unknown): boolean {
  const expected = buildYuryMotoboySignatureHeader(secret, rawBody);
  const received = String(header || "");
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(received);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

export function isYuryMotoboyTimestampFresh(timestampHeader: unknown, nowMs = Date.now()): boolean {
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const tsSeconds = ts > 1e12 ? ts / 1000 : ts;
  const age = Math.abs(nowMs / 1000 - tsSeconds);
  return age <= MAX_AGE_SECONDS;
}
