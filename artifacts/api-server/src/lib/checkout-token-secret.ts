export const CHECKOUT_TOKEN_SECRET_MISSING_MESSAGE =
  "[SECURITY] CHECKOUT_TOKEN_SECRET não está definido. Defina essa variável de ambiente antes de iniciar a API. Sem ela o servidor não sobe.";

export function readCheckoutTokenSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = String(env.CHECKOUT_TOKEN_SECRET || "").trim();
  if (!secret) {
    throw new Error(CHECKOUT_TOKEN_SECRET_MISSING_MESSAGE);
  }
  return secret;
}
