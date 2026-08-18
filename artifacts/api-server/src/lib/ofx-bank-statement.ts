/**
 * Parser OFX SGML (ex.: Banco Inter) — extrai lançamentos de crédito (PIX recebido).
 */

export type OfxCredit = {
  fitid: string;
  postedAt: string; // YYYY-MM-DD
  amount: number;
  amountCents: number;
  name: string | null;
  memo: string | null;
  trnType: string;
};

export type OfxStatementMeta = {
  org: string | null;
  bankId: string | null;
  acctIdMasked: string | null;
  currency: string | null;
  dateStart: string | null;
  dateEnd: string | null;
};

export type ParsedOfxStatement = {
  meta: OfxStatementMeta;
  credits: OfxCredit[];
  debitCount: number;
  totalCredits: number;
};

function tagValue(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  const m = block.match(re);
  if (!m) return null;
  return String(m[1] || "").trim() || null;
}

/** YYYYMMDD ou YYYYMMDDHHMMSS → YYYY-MM-DD */
export function parseOfxDate(raw: string | null | undefined): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const y = digits.slice(0, 4);
  const mo = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(mo) || !/^\d{2}$/.test(d)) return null;
  return `${y}-${mo}-${d}`;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function maskAcct(acct: string | null): string | null {
  if (!acct) return null;
  const digits = acct.replace(/\D/g, "");
  if (digits.length <= 4) return `****${digits}`;
  return `****${digits.slice(-4)}`;
}

/**
 * Parseia OFX 1.x SGML (tags sem fechamento em vários bancos BR).
 * Só retorna créditos (TRNAMT > 0).
 */
export function parseOfxStatement(raw: string): ParsedOfxStatement {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  if (!/<OFX>/i.test(text) && !/<STMTTRN>/i.test(text)) {
    throw new Error("Arquivo não parece ser OFX válido.");
  }

  const org = tagValue(text, "ORG");
  const bankId = tagValue(text, "BANKID");
  const acctId = tagValue(text, "ACCTID");
  const currency = tagValue(text, "CURDEF");
  const dateStart = parseOfxDate(tagValue(text, "DTSTART"));
  const dateEnd = parseOfxDate(tagValue(text, "DTEND"));

  const credits: OfxCredit[] = [];
  let debitCount = 0;
  const stmtRe = /<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = stmtRe.exec(text)) !== null) {
    const block = match[1] || "";
    const amountRaw = tagValue(block, "TRNAMT");
    if (!amountRaw) continue;
    const amount = Number(String(amountRaw).replace(",", "."));
    if (!Number.isFinite(amount)) continue;

    if (amount <= 0) {
      debitCount += 1;
      continue;
    }

    const postedAt = parseOfxDate(tagValue(block, "DTPOSTED"));
    if (!postedAt) continue;

    const fitid =
      tagValue(block, "FITID") ||
      `amt-${toCents(amount)}-${postedAt}-${credits.length}`;

    credits.push({
      fitid,
      postedAt,
      amount: Math.round(amount * 100) / 100,
      amountCents: toCents(amount),
      name: tagValue(block, "NAME"),
      memo: tagValue(block, "MEMO"),
      trnType: tagValue(block, "TRNTYPE") || "CREDIT",
    });
  }

  // Dedup por FITID (mantém o primeiro)
  const seen = new Set<string>();
  const uniqueCredits: OfxCredit[] = [];
  for (const c of credits) {
    if (seen.has(c.fitid)) continue;
    seen.add(c.fitid);
    uniqueCredits.push(c);
  }

  return {
    meta: {
      org,
      bankId,
      acctIdMasked: maskAcct(acctId),
      currency,
      dateStart,
      dateEnd,
    },
    credits: uniqueCredits,
    debitCount,
    totalCredits: uniqueCredits.length,
  };
}
