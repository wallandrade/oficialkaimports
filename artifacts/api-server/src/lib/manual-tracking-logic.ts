import { hasEnvioEcomLabelReady } from "./envioecom-status";

export class ManualTrackingError extends Error {
  code: "INVALID_INPUT" | "NEED_PACKAGE_ID" | "PACKAGE_NOT_FOUND";

  constructor(code: ManualTrackingError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function normalizeManualTrackingCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

/** Correios (AA123456789BR) ou 8–30 caracteres com letra e número. Vazio não entra aqui. */
export function isManualTrackingCodeValid(value: string): boolean {
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value)) return true;
  if (value.length < 8 || value.length > 30) return false;
  if (!/^[A-Z0-9]+$/.test(value)) return false;
  return /[A-Z]/.test(value) && /\d/.test(value);
}

export function manualTrackingKeepsEnviado(input: {
  envioecomLabelUrl?: string | null;
  envioecomStatus?: string | null;
}): boolean {
  return hasEnvioEcomLabelReady({
    envioecomLabelUrl: input.envioecomLabelUrl,
    envioecomStatus: input.envioecomStatus,
  });
}

export type ManualTrackingDecision = {
  code: string | null;
  enviado: boolean;
  setCorreios: boolean;
};

export function decideManualTrackingUpdate(input: {
  rawCode: unknown;
  currentDeliveryMode?: string | null;
  hasEnvioEcomLabel: boolean;
}): ManualTrackingDecision | { error: string } {
  const code = normalizeManualTrackingCode(input.rawCode);
  if (!code) {
    return {
      code: null,
      enviado: input.hasEnvioEcomLabel,
      setCorreios: false,
    };
  }
  if (!isManualTrackingCodeValid(code)) {
    return {
      error: "Código de rastreio inválido. Use o formato dos Correios (AA123456789BR) ou um código de 8 a 30 caracteres com letra e número.",
    };
  }
  return {
    code,
    enviado: true,
    setCorreios: !String(input.currentDeliveryMode || "").trim(),
  };
}
