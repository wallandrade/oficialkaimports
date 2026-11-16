import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";

export type ReservationLookupSource = {
  query?: unknown;
  phone?: unknown;
  cpf?: unknown;
  raffleId?: unknown;
};

export type ReservationLookupCriteria = {
  lookupPhone: string;
  lookupCpf: string;
  raffleId: string;
};

export type ReservationLookupRow = {
  id: string;
  raffleId: string;
  numbers: string | null;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientDocument: string | null;
  totalAmount: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  pixCode: string | null;
  pixBase64: string | null;
  pixExpiresAt: Date | null;
  transactionId: string | null;
};

export type ReservationLookupDeps = {
  requireTenant: (req: Request, res: Response) => Promise<string | null>;
  findRows: (tenantId: string, criteria: ReservationLookupCriteria) => Promise<ReservationLookupRow[]>;
  findTitles: (tenantId: string, raffleIds: string[]) => Promise<Record<string, string>>;
};

function asText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => (item == null ? "" : String(item))).join(",");
  return String(value);
}

export function readReservationLookup(source: ReservationLookupSource | null | undefined):
  | { ok: true; criteria: ReservationLookupCriteria }
  | { ok: false; error: "INVALID_INPUT"; message: string } {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const rawQuery = asText(input.query).trim();
  const queryDigits = rawQuery.replace(/\D/g, "");
  const phone = asText(input.phone).replace(/\D/g, "");
  const cpf = asText(input.cpf).replace(/\D/g, "");

  // 11 dígitos sem pontuação continuam telefone. CPF explícito ou com ponto/traço é documento.
  const hasExplicitPhone = phone.length > 0;
  const hasExplicitCpf = cpf.length > 0;
  const queryLooksCpf = /[.-]/.test(rawQuery) && queryDigits.length === 11;

  const lookupPhone = hasExplicitPhone
    ? phone
    : (!hasExplicitCpf && queryDigits.length >= 8 ? queryDigits : "");
  const lookupCpf = hasExplicitCpf
    ? cpf
    : (!hasExplicitPhone && queryLooksCpf ? queryDigits : "");
  const raffleId = asText(input.raffleId).trim();

  if (lookupPhone.length < 8 && lookupCpf.length !== 11) {
    return { ok: false, error: "INVALID_INPUT", message: "Informe um telefone ou CPF válido." };
  }

  return { ok: true, criteria: { lookupPhone, lookupCpf, raffleId } };
}

function parseNumbers(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

export function presentReservationLookup(
  rows: ReservationLookupRow[],
  titles: Record<string, string>,
  now: Date,
) {
  return rows.map((row) => ({
    ...row,
    numbers: parseNumbers(row.numbers),
    raffleTitle: titles[row.raffleId] ?? "Rifa",
    isExpired: row.status === "reserved" && row.expiresAt < now,
    isPixExpired: row.pixExpiresAt ? row.pixExpiresAt < now : true,
  }));
}

function sourceFromRequest(req: Request): ReservationLookupSource {
  if (req.method === "POST") {
    const body = req.body as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) return body as ReservationLookupSource;
    return {};
  }
  return {
    query: req.query.query,
    phone: req.query.phone,
    cpf: req.query.cpf,
    raffleId: req.query.raffleId,
  };
}

export async function handleReservationLookup(req: Request, res: Response, deps: ReservationLookupDeps): Promise<void> {
  const tenantId = await deps.requireTenant(req, res);
  if (!tenantId) return;

  const read = readReservationLookup(sourceFromRequest(req));
  if (!read.ok) {
    res.status(400).json({ error: read.error, message: read.message });
    return;
  }

  const rows = await deps.findRows(tenantId, read.criteria);
  const raffleIds = [...new Set(rows.map((row) => row.raffleId))];
  const titles = raffleIds.length > 0 ? await deps.findTitles(tenantId, raffleIds) : {};
  res.json(presentReservationLookup(rows, titles, new Date()));
}

export function registerReservationLookup(router: IRouter | Router, deps: ReservationLookupDeps): void {
  const handle = (req: Request, res: Response, next: NextFunction) => {
    handleReservationLookup(req, res, deps).catch(next);
  };
  router.get("/raffles/reservations/lookup", handle);
  router.post("/raffles/reservations/lookup", handle);
}
