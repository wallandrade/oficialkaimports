/**
 * Conciliação: créditos OFX × pedidos (valor exato + janela de data + nome).
 */

import type { OfxCredit } from "./ofx-bank-statement";

export type ReconcileOrderInput = {
  id: string;
  orderNumber: number | null;
  clientName: string;
  /** CPF/CNPJ do pedido — se aparecer no NAME/MEMO do OFX, score → 100%. */
  clientDocument?: string | null;
  totalCents: number;
  createdAt: string; // ISO
  status: string;
  bankDepositMatchStatus?: string | null;
  bankDepositFitid?: string | null;
};

export type MatchKind = "ok" | "ambiguous" | "not_found";

export type ReconcileMatch = {
  kind: "ok";
  orderId: string;
  orderNumber: number | null;
  clientName: string;
  orderTotal: number;
  orderCreatedAt: string;
  orderStatus: string;
  creditFitid: string;
  creditAmount: number;
  creditPostedAt: string;
  creditName: string | null;
  creditMemo: string | null;
  nameScore: number;
  dayDiff: number;
};

export type ReconcileAmbiguous = {
  kind: "ambiguous";
  creditFitid: string;
  creditAmount: number;
  creditPostedAt: string;
  creditName: string | null;
  creditMemo: string | null;
  candidates: Array<{
    orderId: string;
    orderNumber: number | null;
    clientName: string;
    orderTotal: number;
    orderCreatedAt: string;
    nameScore: number;
    dayDiff: number;
  }>;
};

export type ReconcileUnmatchedCredit = {
  kind: "unmatched_credit";
  creditFitid: string;
  creditAmount: number;
  creditPostedAt: string;
  creditName: string | null;
  creditMemo: string | null;
};

export type ReconcileOrderNotFound = {
  kind: "not_found";
  orderId: string;
  orderNumber: number | null;
  clientName: string;
  orderTotal: number;
  orderCreatedAt: string;
  orderStatus: string;
};

export type ReconcileReport = {
  matched: ReconcileMatch[];
  ambiguous: ReconcileAmbiguous[];
  unmatchedCredits: ReconcileUnmatchedCredit[];
  ordersNotFound: ReconcileOrderNotFound[];
  summary: {
    credits: number;
    ordersConsidered: number;
    matched: number;
    ambiguous: number;
    unmatchedCredits: number;
    ordersNotFound: number;
    dateWindowDays: number;
  };
};

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizePersonName(raw: string | null | undefined): string {
  return stripDiacritics(String(raw || "").toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Score 0–1: sobreposição de tokens (nomes BR). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return 0;

  const stop = new Set(["de", "da", "do", "das", "dos", "e"]);
  const tokensA = na.split(" ").filter((t) => t.length > 1 && !stop.has(t));
  const tokensB = nb.split(" ").filter((t) => t.length > 1 && !stop.has(t));
  if (!tokensA.length || !tokensB.length) return 0;

  const setB = new Set(tokensB);
  let hit = 0;
  for (const t of tokensA) {
    if (setB.has(t)) hit += 1;
  }
  const denom = Math.max(tokensA.length, tokensB.length);
  return hit / denom;
}

export function normalizeDocumentDigits(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

/** CPF (11) ou CNPJ (14) do pedido aparece no NAME/MEMO do crédito OFX. */
export function creditContainsClientDocument(
  creditName: string | null | undefined,
  creditMemo: string | null | undefined,
  clientDocument: string | null | undefined,
): boolean {
  const doc = normalizeDocumentDigits(clientDocument);
  if (doc.length !== 11 && doc.length !== 14) return false;
  const hay = normalizeDocumentDigits(`${creditName || ""} ${creditMemo || ""}`);
  return hay.includes(doc);
}

/** Nome + boost CPF/CNPJ → 1.0 se documento bater. */
export function matchIdentityScore(params: {
  creditName: string | null | undefined;
  creditMemo: string | null | undefined;
  clientName: string | null | undefined;
  clientDocument?: string | null | undefined;
}): number {
  if (creditContainsClientDocument(params.creditName, params.creditMemo, params.clientDocument)) {
    return 1;
  }
  return nameSimilarity(params.creditName, params.clientName);
}

function parseDay(isoOrYmd: string): number | null {
  const s = String(isoOrYmd || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const dt = new Date(t);
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) / 86_400_000;
}

function dayDiffAbs(a: string, b: string): number | null {
  const da = parseDay(a);
  const db = parseDay(b);
  if (da == null || db == null) return null;
  return Math.abs(da - db);
}

/**
 * Crédito pode ser no mesmo dia do pedido ou até `dateWindowDays` depois
 * (cliente compra e paga depois). Também aceita crédito até 1 dia antes.
 */
function withinWindow(orderCreatedAt: string, creditPostedAt: string, dateWindowDays: number): boolean {
  const orderDay = parseDay(orderCreatedAt);
  const creditDay = parseDay(creditPostedAt);
  if (orderDay == null || creditDay == null) return false;
  const diff = creditDay - orderDay; // positivo = pagou depois
  return diff >= -1 && diff <= dateWindowDays;
}

export function reconcileBankStatement(params: {
  credits: OfxCredit[];
  orders: ReconcileOrderInput[];
  dateWindowDays?: number;
  /** Já usados em outros pedidos — não rematch. */
  usedFitids?: Set<string>;
}): ReconcileReport {
  const dateWindowDays = Math.max(1, Math.min(30, Number(params.dateWindowDays) || 5));
  const usedFitids = params.usedFitids || new Set<string>();

  const candidateOrders = params.orders.filter((o) => {
    const st = String(o.status || "").toLowerCase();
    if (st === "cancelled") return false;
    // Já conciliado OK / 100% com FITID → não reprocessar como candidato
    if (
      (o.bankDepositMatchStatus === "ok" || o.bankDepositMatchStatus === "confirmed_100") &&
      o.bankDepositFitid
    ) {
      return false;
    }
    return true;
  });

  type Cand = {
    order: ReconcileOrderInput;
    nameScore: number;
    dayDiff: number;
  };

  const matched: ReconcileMatch[] = [];
  const ambiguous: ReconcileAmbiguous[] = [];
  const unmatchedCredits: ReconcileUnmatchedCredit[] = [];
  const assignedOrderIds = new Set<string>();
  const assignedFitids = new Set<string>(usedFitids);

  // Processar créditos com menos candidatos primeiro (valores únicos)
  const creditsSorted = [...params.credits].sort((a, b) => {
    const ca = candidateOrders.filter((o) => o.totalCents === a.amountCents).length;
    const cb = candidateOrders.filter((o) => o.totalCents === b.amountCents).length;
    return ca - cb;
  });

  for (const credit of creditsSorted) {
    if (assignedFitids.has(credit.fitid)) continue;

    const cands: Cand[] = [];
    for (const order of candidateOrders) {
      if (assignedOrderIds.has(order.id)) continue;
      if (order.totalCents !== credit.amountCents) continue;
      if (!withinWindow(order.createdAt, credit.postedAt, dateWindowDays)) continue;
      const diff = dayDiffAbs(order.createdAt, credit.postedAt);
      if (diff == null) continue;
      cands.push({
        order,
        nameScore: matchIdentityScore({
          creditName: credit.name,
          creditMemo: credit.memo,
          clientName: order.clientName,
          clientDocument: order.clientDocument,
        }),
        dayDiff: diff,
      });
    }

    if (cands.length === 0) {
      unmatchedCredits.push({
        kind: "unmatched_credit",
        creditFitid: credit.fitid,
        creditAmount: credit.amount,
        creditPostedAt: credit.postedAt,
        creditName: credit.name,
        creditMemo: credit.memo,
      });
      continue;
    }

    cands.sort((a, b) => {
      if (b.nameScore !== a.nameScore) return b.nameScore - a.nameScore;
      return a.dayDiff - b.dayDiff;
    });

    const best = cands[0]!;
    const second = cands[1];
    const clearlyBest =
      cands.length === 1 ||
      (best.nameScore >= 0.4 && (!second || best.nameScore - second.nameScore >= 0.15)) ||
      (best.nameScore >= 0.55 && best.dayDiff <= (second?.dayDiff ?? 99));

    // Sem nome no crédito: se só 1 candidato na janela → OK; senão ambíguo
    const okWithoutName = !credit.name && cands.length === 1;
    const okWithName = clearlyBest && (best.nameScore > 0 || cands.length === 1);

    if (okWithoutName || okWithName) {
      assignedOrderIds.add(best.order.id);
      assignedFitids.add(credit.fitid);
      matched.push({
        kind: "ok",
        orderId: best.order.id,
        orderNumber: best.order.orderNumber,
        clientName: best.order.clientName,
        orderTotal: best.order.totalCents / 100,
        orderCreatedAt: best.order.createdAt,
        orderStatus: best.order.status,
        creditFitid: credit.fitid,
        creditAmount: credit.amount,
        creditPostedAt: credit.postedAt,
        creditName: credit.name,
        creditMemo: credit.memo,
        nameScore: Math.round(best.nameScore * 100) / 100,
        dayDiff: best.dayDiff,
      });
      continue;
    }

    ambiguous.push({
      kind: "ambiguous",
      creditFitid: credit.fitid,
      creditAmount: credit.amount,
      creditPostedAt: credit.postedAt,
      creditName: credit.name,
      creditMemo: credit.memo,
      candidates: cands.slice(0, 8).map((c) => ({
        orderId: c.order.id,
        orderNumber: c.order.orderNumber,
        clientName: c.order.clientName,
        orderTotal: c.order.totalCents / 100,
        orderCreatedAt: c.order.createdAt,
        nameScore: Math.round(c.nameScore * 100) / 100,
        dayDiff: c.dayDiff,
      })),
    });
  }

  const ordersNotFound: ReconcileOrderNotFound[] = candidateOrders
    .filter((o) => !assignedOrderIds.has(o.id))
    .filter((o) => {
      const st = String(o.status || "").toLowerCase();
      // Só reporta "não encontrado" para quem ainda precisa de confirmação
      return st === "pending" || st === "awaiting_payment" || st === "paid";
    })
    .map((o) => ({
      kind: "not_found" as const,
      orderId: o.id,
      orderNumber: o.orderNumber,
      clientName: o.clientName,
      orderTotal: o.totalCents / 100,
      orderCreatedAt: o.createdAt,
      orderStatus: o.status,
    }));

  return {
    matched,
    ambiguous,
    unmatchedCredits,
    ordersNotFound,
    summary: {
      credits: params.credits.length,
      ordersConsidered: candidateOrders.length,
      matched: matched.length,
      ambiguous: ambiguous.length,
      unmatchedCredits: unmatchedCredits.length,
      ordersNotFound: ordersNotFound.length,
      dateWindowDays,
    },
  };
}
