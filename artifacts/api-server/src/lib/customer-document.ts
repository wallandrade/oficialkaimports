export function normalizeCustomerDocument(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function parseOptionalCustomerDocument(
  value: unknown,
): { ok: true; document: string | null } | { ok: false; message: string } {
  const digits = normalizeCustomerDocument(value);
  if (!digits) return { ok: true, document: null };
  if (digits.length !== 11) {
    return { ok: false, message: "Informe um CPF válido (11 dígitos) ou deixe em branco." };
  }
  return { ok: true, document: digits };
}
