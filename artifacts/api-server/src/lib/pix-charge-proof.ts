import { db, pixChargeProofsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decidePixAuthentication, hashPixWebhookToken, type PixAuthentication } from "./pix-charge-proof-core";

function isDuplicateEntry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY") return true;
  return "cause" in error && isDuplicateEntry((error as { cause?: unknown }).cause);
}

/**
 * Grava o hash uma vez, na criação. Repetir a mesma transação não troca o hash.
 * O aviso de pagamento não chama esta função.
 */
export async function rememberGatewayChargeProof(input: {
  transactionId?: string | null;
  tenantId?: string | null;
  webhookToken?: string | null;
}): Promise<boolean> {
  const transactionId = String(input.transactionId || "").trim();
  const webhookToken = String(input.webhookToken || "").trim();
  if (!transactionId || !webhookToken) return false;
  try {
    await db.insert(pixChargeProofsTable).values({
      transactionId,
      tenantId: String(input.tenantId || "").trim() || null,
      tokenHash: hashPixWebhookToken(webhookToken),
    });
    return true;
  } catch (error) {
    if (isDuplicateEntry(error)) return false;
    throw error;
  }
}

export async function findGatewayChargeProofHash(transactionId: string): Promise<string | null> {
  const id = String(transactionId || "").trim();
  if (!id) return null;
  const [row] = await db
    .select({ tokenHash: pixChargeProofsTable.tokenHash })
    .from(pixChargeProofsTable)
    .where(eq(pixChargeProofsTable.transactionId, id))
    .limit(1);
  return row?.tokenHash || null;
}

export async function authenticatePixNotice(input: {
  globalSecretMatches: boolean;
  bodyToken: string;
  transactionId?: string;
}): Promise<PixAuthentication> {
  if (input.globalSecretMatches) return { ok: true, method: "shared_secret" };
  const storedTokenHash = input.transactionId
    ? await findGatewayChargeProofHash(input.transactionId)
    : null;
  return decidePixAuthentication({
    globalSecretMatches: false,
    presentedToken: input.bodyToken,
    storedTokenHash,
  });
}
