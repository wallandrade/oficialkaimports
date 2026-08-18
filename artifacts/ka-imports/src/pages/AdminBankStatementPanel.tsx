import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  FileSearch,
  Loader2,
  Upload,
  AlertTriangle,
  XCircle,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDateBR } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Props = {
  authHeaders: () => HeadersInit;
  onUnauthorized: () => void;
  onGoToOrder?: (orderId: string, orderCreatedAt?: string | null) => void;
};

type ReportMatch = {
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

type ReportAmbiguous = {
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

type ReportUnmatchedCredit = {
  kind: "unmatched_credit";
  creditFitid: string;
  creditAmount: number;
  creditPostedAt: string;
  creditName: string | null;
  creditMemo: string | null;
};

type ReportNotFound = {
  kind: "not_found";
  orderId: string;
  orderNumber: number | null;
  clientName: string;
  orderTotal: number;
  orderCreatedAt: string;
  orderStatus: string;
};

type AnalyzeResponse = {
  ok?: boolean;
  meta?: {
    org?: string | null;
    bankId?: string | null;
    acctIdMasked?: string | null;
    currency?: string | null;
    dateStart?: string | null;
    dateEnd?: string | null;
  };
  debitCount?: number;
  skippedDuplicateCredits?: number;
  ordersInRange?: number;
  ordersManualOnly?: number;
  creditsTotal?: number;
  creditsNew?: number;
  report?: {
    matched: ReportMatch[];
    ambiguous: ReportAmbiguous[];
    unmatchedCredits: ReportUnmatchedCredit[];
    ordersNotFound: ReportNotFound[];
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
  message?: string;
};

function formatYmd(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

export default function AdminBankStatementPanel({ authHeaders, onUnauthorized, onGoToOrder }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [ofxText, setOfxText] = useState("");
  const [dateWindowDays, setDateWindowDays] = useState(5);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyingFitid, setApplyingFitid] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedNotFound, setSelectedNotFound] = useState<Record<string, boolean>>({});
  const [manualAmbiguous, setManualAmbiguous] = useState<Record<string, string>>({});

  const report = result?.report;

  const selectedNotFoundIds = useMemo(
    () => Object.entries(selectedNotFound).filter(([, v]) => v).map(([id]) => id),
    [selectedNotFound],
  );

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      setOfxText(text);
      setResult(null);
      toast.success(`Arquivo carregado: ${file.name}`);
    } catch {
      toast.error("Não foi possível ler o arquivo OFX.");
    }
  };

  const analyze = async () => {
    if (!ofxText.trim()) {
      toast.error("Selecione um arquivo OFX do Inter.");
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch(`${BASE}/api/admin/bank-statement/analyze`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ofxText, dateWindowDays }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = (await res.json()) as AnalyzeResponse;
      if (!res.ok) {
        toast.error(data.message || "Falha ao analisar extrato.");
        return;
      }
      setResult(data);
      const nf: Record<string, boolean> = {};
      for (const row of data.report?.ordersNotFound || []) {
        // pré-seleciona pending/awaiting para marcar "não encontrado"
        if (row.orderStatus === "pending" || row.orderStatus === "awaiting_payment") {
          nf[row.orderId] = true;
        }
      }
      setSelectedNotFound(nf);
      setManualAmbiguous({});
      toast.success(
        `Análise pronta: ${data.report?.summary.matched ?? 0} OK · ${data.report?.summary.ambiguous ?? 0} ambíguos`,
      );
    } catch {
      toast.error("Erro ao analisar extrato.");
    } finally {
      setAnalyzing(false);
    }
  };

  const matched100 = useMemo(
    () => (report?.matched || []).filter((m) => m.nameScore >= 0.999),
    [report],
  );
  const matchedOther = useMemo(
    () => (report?.matched || []).filter((m) => m.nameScore < 0.999),
    [report],
  );

  const buildMatchPayload = (rows: ReportMatch[], matchStatus?: "ok" | "confirmed_100") =>
    rows.map((m) => ({
      orderId: m.orderId,
      creditFitid: m.creditFitid,
      creditAmount: m.creditAmount,
      creditPostedAt: m.creditPostedAt,
      creditName: m.creditName,
      nameScore: m.nameScore,
      ...(matchStatus ? { matchStatus } : {}),
    }));

  const applyOne = async (m: ReportMatch, matchStatus: "ok" | "confirmed_100") => {
    setApplyingFitid(m.creditFitid);
    try {
      const res = await fetch(`${BASE}/api/admin/bank-statement/apply`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          matches: buildMatchPayload([m], matchStatus),
          notFoundOrderIds: [],
          onlyConfirmed100: matchStatus === "confirmed_100",
        }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        appliedOk?: number;
        appliedConfirmed100?: number;
        errors?: Array<{ orderId?: string; message: string }>;
        message?: string;
      };
      if (!res.ok) {
        toast.error(data.message || "Falha ao aplicar este depósito.");
        return;
      }
      if (data.errors?.length) {
        toast.error(data.errors[0]?.message || "Não foi possível aplicar.");
        return;
      }
      toast.success(
        matchStatus === "confirmed_100"
          ? `Pedido #${m.orderNumber ?? "—"}: depósito 100% salvo`
          : `Pedido #${m.orderNumber ?? "—"}: depósito OK salvo`,
      );
      await analyze();
    } catch {
      toast.error("Erro ao aplicar este depósito.");
    } finally {
      setApplyingFitid(null);
    }
  };

  const apply = async (mode: "confirmed_100" | "all_ok") => {
    if (!report) return;

    const matches =
      mode === "confirmed_100"
        ? buildMatchPayload(matched100, "confirmed_100")
        : [
            ...buildMatchPayload(matched100, "confirmed_100"),
            ...buildMatchPayload(matchedOther, "ok"),
          ];

    if (mode === "all_ok") {
      for (const amb of report.ambiguous) {
        const chosen = manualAmbiguous[amb.creditFitid];
        if (!chosen) continue;
        matches.push({
          orderId: chosen,
          creditFitid: amb.creditFitid,
          creditAmount: amb.creditAmount,
          creditPostedAt: amb.creditPostedAt,
          creditName: amb.creditName,
          nameScore: 0,
          matchStatus: "ok",
        });
      }
    }

    const notFoundOrderIds = mode === "all_ok" ? selectedNotFoundIds : [];

    if (!matches.length && !notFoundOrderIds.length) {
      toast.error(
        mode === "confirmed_100"
          ? "Nenhum match com score 100% para aplicar."
          : "Nada para aplicar. Rode a análise e selecione itens.",
      );
      return;
    }

    setApplying(true);
    try {
      const res = await fetch(`${BASE}/api/admin/bank-statement/apply`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          matches,
          notFoundOrderIds,
          onlyConfirmed100: mode === "confirmed_100",
        }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        appliedOk?: number;
        appliedConfirmed100?: number;
        appliedNotFound?: number;
        errors?: Array<{ orderId?: string; message: string }>;
        message?: string;
      };
      if (!res.ok) {
        toast.error(data.message || "Falha ao aplicar.");
        return;
      }
      toast.success(
        mode === "confirmed_100"
          ? `Salvos: ${data.appliedConfirmed100 ?? 0} depósito confirmado 100%`
          : `Aplicado: ${data.appliedConfirmed100 ?? 0} × 100% · ${data.appliedOk ?? 0} OK · ${data.appliedNotFound ?? 0} não encontrado`,
      );
      if (data.errors?.length) {
        toast.message(`${data.errors.length} item(ns) com aviso — veja o console`);
        console.warn("[bank-statement apply]", data.errors);
      }
      await analyze();
    } catch {
      toast.error("Erro ao aplicar conciliação.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Landmark className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Extrato bancário (OFX)</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Só depósitos manuais Inter (exclui PIX gateway CNPay). O resultado some no F5; o histórico fica na aba{" "}
              <strong>Depósitos</strong>. FITID já salvo é ignorado no próximo OFX. Score 100% = nome igual —
              use “Aplicar só 100%”.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] items-end">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arquivo .ofx</span>
            <div className="mt-1.5 flex items-center gap-2">
              <label className="flex-1 cursor-pointer rounded-xl border-2 border-dashed border-border hover:border-emerald-400 bg-muted/20 px-4 py-3 flex items-center gap-2 text-sm">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">{fileName || "Selecionar Extrato-….ofx"}</span>
                <input
                  type="file"
                  accept=".ofx,application/x-ofx,text/plain"
                  className="hidden"
                  onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Janela (dias)</span>
            <input
              type="number"
              min={1}
              max={30}
              value={dateWindowDays}
              onChange={(e) => setDateWindowDays(Math.max(1, Math.min(30, Number(e.target.value) || 5)))}
              className="mt-1.5 w-24 rounded-xl border border-border bg-white px-3 py-2.5 text-sm"
            />
          </label>

          <Button
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={analyzing || !ofxText}
            onClick={() => void analyze()}
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
            Analisar
          </Button>
        </div>

        {result?.meta && (
          <p className="text-xs text-muted-foreground mt-3">
            {result.meta.org || "Banco"} · conta {result.meta.acctIdMasked || "****"} ·{" "}
            {formatYmd(result.meta.dateStart)} → {formatYmd(result.meta.dateEnd)} ·{" "}
            {result.creditsNew ?? report?.summary.credits ?? 0} créditos novos
            {typeof result.skippedDuplicateCredits === "number" && result.skippedDuplicateCredits > 0
              ? ` · ${result.skippedDuplicateCredits} já registrados (ignorados)`
              : ""}{" "}
            · {result.debitCount ?? 0} débitos · pedidos manuais {result.ordersManualOnly ?? "—"}/
            {result.ordersInRange ?? "—"}
          </p>
        )}
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard label="Confirmado 100%" value={matched100.length} tone="ok" />
            <SummaryCard label="Valor bateu, nome diferente" value={matchedOther.length} tone="muted" />
            <SummaryCard label="Ambíguos" value={report.summary.ambiguous} tone="warn" />
            <SummaryCard label="PIX sem pedido" value={report.summary.unmatchedCredits} tone="muted" />
            <SummaryCard label="Pedido sem depósito" value={report.summary.ordersNotFound} tone="bad" />
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Button
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={applying || matched100.length === 0}
              onClick={() => void apply("confirmed_100")}
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Aplicar só 100% ({matched100.length})
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled={applying}
              onClick={() => void apply("all_ok")}
            >
              Aplicar todos + não encontrados
            </Button>
            <p className="text-xs text-muted-foreground">
              “Só 100%” grava <strong>Depósito confirmado 100%</strong> no pedido. Não altera status de pagamento.
            </p>
          </div>

          <Section
            title={`Depósito confirmado 100% (${matched100.length})`}
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            hint="Nome no extrato igual ao cliente (ou CPF/CNPJ bate). Pode aplicar com confiança."
          >
            {matched100.length === 0 ? (
              <Empty />
            ) : (
              <MatchTable
                rows={matched100}
                onGoToOrder={onGoToOrder}
                highlight
                applyingFitid={applyingFitid}
                applyBusy={applying}
                onApplyOne={(m) => void applyOne(m, "confirmed_100")}
                applyLabel="Aplicar 100%"
              />
            )}
          </Section>

          <Section
            title={`Valor bateu, nome diferente (${matchedOther.length})`}
            icon={<AlertTriangle className="w-4 h-4 text-slate-500" />}
            hint="PIX do extrato com o mesmo valor e data perto do pedido, mas o nome no banco não bate 100% com o cliente. Revise e use Aplicar este só se for o pagamento certo."
          >
            {matchedOther.length === 0 ? (
              <Empty />
            ) : (
              <MatchTable
                rows={matchedOther}
                onGoToOrder={onGoToOrder}
                applyingFitid={applyingFitid}
                applyBusy={applying}
                onApplyOne={(m) => void applyOne(m, "ok")}
                applyLabel="Aplicar este"
              />
            )}
          </Section>

          <Section
            title={`Ambíguos (${report.ambiguous.length})`}
            icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}
            hint="Vários pedidos com o mesmo valor na janela. Escolha o pedido certo e aplique."
          >
            {report.ambiguous.length === 0 ? (
              <Empty />
            ) : (
              <div className="space-y-4">
                {report.ambiguous.map((amb) => (
                  <div key={amb.creditFitid} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                    <p className="text-sm font-semibold">
                      {formatCurrency(amb.creditAmount)} · {formatYmd(amb.creditPostedAt)} · {amb.creditName || "sem nome"}
                    </p>
                    <p className="text-xs text-muted-foreground mb-2">{amb.creditMemo}</p>
                    <div className="space-y-1.5">
                      {amb.candidates.map((c) => (
                        <label key={c.orderId} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name={`amb-${amb.creditFitid}`}
                            checked={manualAmbiguous[amb.creditFitid] === c.orderId}
                            onChange={() =>
                              setManualAmbiguous((prev) => ({ ...prev, [amb.creditFitid]: c.orderId }))
                            }
                          />
                          <span>
                            #{c.orderNumber ?? "—"} {c.clientName} · score {Math.round(c.nameScore * 100)}% · Δ{c.dayDiff}d
                          </span>
                        </label>
                      ))}
                    </div>
                    {manualAmbiguous[amb.creditFitid] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 gap-1.5"
                        disabled={!!applyingFitid || applying}
                        onClick={() => {
                          const orderId = manualAmbiguous[amb.creditFitid];
                          const cand = amb.candidates.find((c) => c.orderId === orderId);
                          if (!orderId || !cand) return;
                          void applyOne(
                            {
                              kind: "ok",
                              orderId,
                              orderNumber: cand.orderNumber,
                              clientName: cand.clientName,
                              orderTotal: cand.orderTotal,
                              orderCreatedAt: cand.orderCreatedAt,
                              orderStatus: "",
                              creditFitid: amb.creditFitid,
                              creditAmount: amb.creditAmount,
                              creditPostedAt: amb.creditPostedAt,
                              creditName: amb.creditName,
                              creditMemo: amb.creditMemo,
                              nameScore: cand.nameScore,
                              dayDiff: cand.dayDiff,
                            },
                            "ok",
                          );
                        }}
                      >
                        {applyingFitid === amb.creditFitid ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                        Aplicar este ambíguo
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={`Pedido sem depósito no extrato (${report.ordersNotFound.length})`}
            icon={<XCircle className="w-4 h-4 text-red-600" />}
          >
            {report.ordersNotFound.length === 0 ? (
              <Empty />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 pr-3">Marcar</th>
                      <th className="py-2 pr-3">Pedido</th>
                      <th className="py-2 pr-3">Cliente</th>
                      <th className="py-2 pr-3">Valor</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.ordersNotFound.map((o) => (
                      <tr key={o.orderId} className="border-b border-border/50">
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={!!selectedNotFound[o.orderId]}
                            onChange={(e) =>
                              setSelectedNotFound((prev) => ({ ...prev, [o.orderId]: e.target.checked }))
                            }
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            className="text-primary font-semibold hover:underline"
                            onClick={() => onGoToOrder?.(o.orderId, o.orderCreatedAt)}
                          >
                            #{o.orderNumber ?? o.orderId.slice(0, 8)}
                          </button>
                          <div className="text-[11px] text-muted-foreground">{formatDateBR(o.orderCreatedAt)}</div>
                        </td>
                        <td className="py-2 pr-3">{o.clientName}</td>
                        <td className="py-2 pr-3 font-semibold">{formatCurrency(o.orderTotal)}</td>
                        <td className="py-2">{o.orderStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            title={`PIX no extrato sem pedido (${report.unmatchedCredits.length})`}
            icon={<AlertTriangle className="w-4 h-4 text-slate-500" />}
          >
            {report.unmatchedCredits.length === 0 ? (
              <Empty />
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1.5 text-sm">
                {report.unmatchedCredits.slice(0, 80).map((c) => (
                  <div key={c.creditFitid} className="flex justify-between gap-3 border-b border-border/40 py-1.5">
                    <span>
                      {formatYmd(c.creditPostedAt)} · {c.creditName || "—"}
                    </span>
                    <span className="font-semibold">{formatCurrency(c.creditAmount)}</span>
                  </div>
                ))}
                {report.unmatchedCredits.length > 80 && (
                  <p className="text-xs text-muted-foreground">+{report.unmatchedCredits.length - 80} omitidos</p>
                )}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function MatchTable({
  rows,
  onGoToOrder,
  highlight,
  onApplyOne,
  applyLabel,
  applyingFitid,
  applyBusy,
}: {
  rows: ReportMatch[];
  onGoToOrder?: (orderId: string, orderCreatedAt?: string | null) => void;
  highlight?: boolean;
  onApplyOne?: (m: ReportMatch) => void;
  applyLabel?: string;
  applyingFitid?: string | null;
  applyBusy?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b">
            <th className="py-2 pr-3">Pedido</th>
            <th className="py-2 pr-3">Cliente</th>
            <th className="py-2 pr-3">Valor</th>
            <th className="py-2 pr-3">Pagou em</th>
            <th className="py-2 pr-3">Nome no extrato</th>
            <th className="py-2 pr-3">Score</th>
            {onApplyOne && <th className="py-2">Ação</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.creditFitid}
              className={`border-b border-border/50 ${highlight ? "bg-emerald-50/40" : ""}`}
            >
              <td className="py-2 pr-3">
                <button
                  type="button"
                  className="text-primary font-semibold hover:underline"
                  onClick={() => onGoToOrder?.(m.orderId, m.orderCreatedAt)}
                >
                  #{m.orderNumber ?? m.orderId.slice(0, 8)}
                </button>
                <div className="text-[11px] text-muted-foreground">{formatDateBR(m.orderCreatedAt)}</div>
              </td>
              <td className="py-2 pr-3">{m.clientName}</td>
              <td className="py-2 pr-3 font-semibold">{formatCurrency(m.creditAmount)}</td>
              <td className="py-2 pr-3">
                {formatYmd(m.creditPostedAt)}{" "}
                <span className="text-muted-foreground">(+{m.dayDiff}d)</span>
              </td>
              <td className="py-2 pr-3">{m.creditName || "—"}</td>
              <td className="py-2 pr-3 font-semibold">{Math.round(m.nameScore * 100)}%</td>
              {onApplyOne && (
                <td className="py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5 whitespace-nowrap"
                    disabled={!!applyBusy || !!applyingFitid}
                    onClick={() => onApplyOne(m)}
                  >
                    {applyingFitid === m.creditFitid ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    {applyLabel || "Aplicar este"}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad" | "muted";
}) {
  const toneClass =
    tone === "ok"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : tone === "warn"
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : tone === "bad"
          ? "bg-red-50 border-red-200 text-red-900"
          : "bg-slate-50 border-slate-200 text-slate-800";
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}</p>
    </div>
  );
}

function Section({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="font-bold text-foreground">{title}</h3>
      </div>
      {hint ? <p className="text-xs text-muted-foreground mb-3 max-w-3xl">{hint}</p> : <div className="mb-3" />}
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground">Nenhum item nesta lista.</p>;
}
