export type FreightDataField = "cpf" | "cep" | "endereco";

const FIELD_LABEL: Record<FreightDataField, string> = {
  cpf: "CPF",
  cep: "CEP",
  endereco: "endereço",
};

/** Códigos que nunca são dado errado do destinatário. */
const IGNORED_CODES = new Set([
  "ORIGIN_CEP_REQUIRED",
  "ORIGIN_CEP",
  "MISSING_ORIGIN_CEP",
  "TOKEN_MISSING",
  "TOKEN_INVALID",
  "ENVIOECOM_NOT_CONFIGURED",
  "NOT_CONFIGURED",
  "INVALID_PHONE",
  "INVALID_EMAIL",
  "UNSUPPORTED_SHIPPING",
  "ORDER_NOT_PAID",
  "SHIPMENT_EXISTS",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "WEBHOOK_FAILED",
  "INTERNAL_ERROR",
  "ACCOUNT_REQUIRED",
]);

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pushField(target: Set<FreightDataField>, field: FreightDataField) {
  target.add(field);
}

function classifyText(raw: string, target: Set<FreightDataField>) {
  const text = fold(raw);
  if (!text) return;
  if (/\bcpf\b|\bcnpj\b|documento/.test(text)) pushField(target, "cpf");
  if (/\bcep\b|postal|codigo postal/.test(text)) pushField(target, "cep");
  if (/endereco|logradouro|\brua\b|bairro|cidade|\buf\b|numero/.test(text)) pushField(target, "endereco");
}

function classifyPath(raw: string, target: Set<FreightDataField>) {
  const path = fold(raw);
  if (!path) return;
  if (/phone|telefone|celular|email|mail/.test(path)) return;
  if (/origin|origem/.test(path)) return;
  if (/document|cpf|cnpj/.test(path)) {
    pushField(target, "cpf");
    return;
  }
  if (/postal|cep|zip/.test(path)) pushField(target, "cep");
  if (/address|logradouro|district|bairro|city|cidade|state|complement|neighborhood|numero/.test(path)) {
    pushField(target, "endereco");
  }
  if (/(^|[._])number($|[._])/.test(path)) pushField(target, "endereco");
}

function walk(value: unknown, path: string, target: Set<FreightDataField>) {
  classifyPath(path, target);
  if (typeof value === "string" || typeof value === "number") {
    classifyText(String(value), target);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, path, target);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walk(child, path ? `${path}.${key}` : key, target);
    }
  }
}

function dropOriginCep(message: string, fields: Set<FreightDataField>) {
  const text = fold(message);
  const talksAboutOrigin = /\borigem\b|\borigin\b/.test(text);
  const talksAboutDestination = /\bdestino\b|\bdestinat/.test(text);
  if (talksAboutOrigin && !talksAboutDestination) fields.delete("cep");
}

/** Quais dados do cliente a transportadora recusou. Vazio = não é erro de CPF/CEP/endereço. */
export function classifyFreightDataError(input: {
  code?: string | null;
  message?: string | null;
  details?: unknown;
}): FreightDataField[] {
  const code = String(input.code || "").trim().toUpperCase();
  if (!code && !String(input.message || "").trim() && input.details == null) return [];
  if (IGNORED_CODES.has(code) || code.startsWith("ORIGIN_CEP")) return [];

  const fields = new Set<FreightDataField>();
  const message = String(input.message || "");
  if (code === "INVALID_DOCUMENT") pushField(fields, "cpf");
  if (code === "INVALID_CEP") pushField(fields, "cep");
  if (code === "INVALID_ADDRESS") {
    const folded = fold(message);
    if (/cep|postal/.test(folded) && !/rua|cidade|bairro|uf|endereco/.test(folded)) {
      pushField(fields, "cep");
    } else if (/cep|postal/.test(folded)) {
      pushField(fields, "cep");
      pushField(fields, "endereco");
    } else {
      pushField(fields, "endereco");
    }
  }
  classifyText(message, fields);
  walk(input.details, "", fields);
  dropOriginCep(message, fields);
  if (code === "INVALID_RECIPIENT") {
    const folded = fold(message);
    const aboutPhone = /telefone|celular|phone/.test(folded);
    const aboutEmail = /e-mail|email/.test(folded);
    if ((aboutPhone || aboutEmail) && !/\bcpf\b|\bcnpj\b|documento/.test(folded)) {
      fields.delete("cpf");
      fields.delete("cep");
      fields.delete("endereco");
    }
  }
  return (["cpf", "cep", "endereco"] as const).filter((field) => fields.has(field));
}

export function freightFieldLabel(fields: FreightDataField[]): string {
  const labels = fields.map((field) => FIELD_LABEL[field]);
  if (labels.length <= 1) return labels[0] || "endereço";
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

export function deliveryCorrectionMessage(input: {
  name: string;
  orderNumber: string;
  fields: FreightDataField[];
  link: string;
}): string {
  const name = String(input.name || "cliente").trim().split(/\s+/)[0] || "cliente";
  const number = String(input.orderNumber || "").trim() || "-";
  return `Olá ${name}! Para enviarmos seu pedido #${number} precisamos que você corrija seu ${freightFieldLabel(input.fields)}. É rapidinho, por este link: ${input.link}`;
}

export function isValidCpf(raw: string): boolean {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index);
    const mod = (sum * 10) % 11;
    return (mod === 10 ? 0 : mod) === Number(digits[length]);
  };
  return check(9) && check(10);
}

export function isValidCnpj(raw: string): boolean {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * weights[index];
    const mod = sum % 11;
    return (mod < 2 ? 0 : 11 - mod) === Number(digits[length]);
  };
  return check(12) && check(13);
}

export function maskDocument(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14) return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/****-**`;
  return "***.***.***-**";
}

export function maskCpf(raw: string): string {
  return maskDocument(raw);
}

export type DeliveryCorrectionWhatsappPayload = {
  event: "corrigir_dados_entrega";
  phone: string;
  name: string;
  orderNumber: string;
  fields: FreightDataField[];
  message: string;
  link: string;
};

export function deliveryCorrectionWhatsappPayload(input: {
  phone: string;
  name: string;
  orderNumber: string;
  fields: FreightDataField[];
  message: string;
  link: string;
}): DeliveryCorrectionWhatsappPayload | null {
  const phone = String(input.phone || "").replace(/\D/g, "");
  const withCountry = phone.startsWith("55") && phone.length >= 12 ? phone : phone ? `55${phone.replace(/^0+/, "")}` : "";
  if (withCountry.length < 12) return null;
  return {
    event: "corrigir_dados_entrega",
    phone: withCountry,
    name: String(input.name || "").trim(),
    orderNumber: String(input.orderNumber || "").trim(),
    fields: input.fields,
    message: input.message,
    link: input.link,
  };
}

export function shouldAutoSendDeliveryCorrection(row: { whatsappAttemptedAt?: Date | string | null } | null): boolean {
  return !row?.whatsappAttemptedAt;
}

export async function postDeliveryCorrectionWhatsapp(input: {
  url: string;
  payload: DeliveryCorrectionWhatsappPayload;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; error?: string }> {
  let url = "";
  try {
    const parsed = new URL(String(input.url || "").trim());
    if (parsed.protocol === "https:") url = parsed.toString();
  } catch {
    url = "";
  }
  if (!url) return { ok: false, error: "WhatsApp não configurado." };
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `n8n respondeu HTTP ${response.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível falar com o n8n." };
  } finally {
    clearTimeout(timeout);
  }
}
