import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Truck, FileText, Ban, ExternalLink, X, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

export type EnvioEcomOrderFields = {
  id: string;
  orderNumber?: number | null;
  clientName?: string;
  shippingType?: string;
  enviado?: boolean;
  trackingCode?: string | null;
  trackingLabelUrl?: string | null;
  envioecomShipmentId?: number | null;
  envioecomBarcode?: string | null;
  envioecomDeliveryMode?: string | null;
  envioecomStatus?: string | null;
  envioecomLabelUrl?: string | null;
  envioecomFreightCost?: number | null;
  envioecomAccountId?: string | null;
  envioecomAccountName?: string | null;
};

type EnvioEcomAccountOption = {
  id: string;
  name: string;
  configured: boolean;
  originCep?: string;
};

const DEFAULT_CARRIER_FILTERS = [
  "Correios Sedex",
  "Correios Pac",
  "Correios Mini Envios",
  "J&T Express envioEcom",
  "Jadlog envioEcom",
  "Ponto Loggi envioEcom",
  "BUSLOG envioEcom",
];

type QuoteOption = {
  carrier?: string;
  price?: string | number;
  freight_cost?: string | number;
  delivery_time?: string | number;
  delivery_days?: string | number;
  [key: string]: unknown;
};

function isMotoboyOrPickup(shippingType?: string) {
  const normalized = String(shippingType || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized.includes("motoboy") || normalized.includes("retirada") || normalized.includes("pickup");
}

function isProvisionalBarcode(value?: string | null) {
  return /^EC\d+/i.test(String(value || "").trim());
}

function parseEnvioEcomLinkRef(raw: unknown): { shipmentId?: number; barcode?: string } {
  const value = String(raw || "").trim();
  if (!value) return {};
  const compact = value.replace(/\s+/g, "");
  const digits = compact.replace(/\D/g, "");
  if (digits.length >= 4 && digits.length <= 10 && digits === compact) {
    return { shipmentId: Number(digits) };
  }
  return { barcode: compact };
}

function prettyAccountName(order: EnvioEcomOrderFields) {
  if (order.envioecomAccountName) return order.envioecomAccountName;
  if (order.envioecomAccountId === "env") return "São Paulo";
  if (order.envioecomAccountId === "tenant") return "Conta da loja";
  return order.envioecomAccountId || "";
}

function quoteCarrier(quote: QuoteOption) {
  return String(quote.carrier || quote.shipping_company || "").trim();
}

function quotePrice(quote: QuoteOption) {
  return Number(quote.price ?? quote.freight_cost ?? 0);
}

function quoteDays(quote: QuoteOption) {
  return String(quote.delivery_time ?? quote.delivery_days ?? "");
}

function formatErrorDetails(details: unknown): string {
  if (details == null || details === "") return "";
  if (typeof details === "string" || typeof details === "number" || typeof details === "boolean") {
    return String(details).trim();
  }
  if (Array.isArray(details)) {
    return details.map((item) => formatErrorDetails(item)).filter(Boolean).join("; ");
  }
  if (typeof details === "object") {
    const row = details as Record<string, unknown>;
    const field = String(row.field || row.path || "").trim();
    const msg = String(row.message || row.reason || row.error || "").trim();
    if (field || msg) return field && msg ? `${field}: ${msg}` : (msg || field);
    return Object.entries(row)
      .map(([key, value]) => {
        const nested = formatErrorDetails(value);
        return nested ? `${key}: ${nested}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

async function readErrorPayload(res: Response) {
  const data = await res.json().catch(() => ({})) as { message?: string; error?: string; details?: unknown };
  const details = formatErrorDetails(data.details);
  return {
    error: String(data.error || "").trim(),
    message: [data.message || data.error, details].filter(Boolean).join(" — ") || "Erro EnvioEcom",
  };
}

async function readError(res: Response) {
  return (await readErrorPayload(res)).message;
}

export function EnvioEcomOrderActions({
  order,
  onPatched,
}: {
  order: EnvioEcomOrderFields;
  onPatched: (patch: Partial<EnvioEcomOrderFields> & { id: string }) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [unavailable, setUnavailable] = useState<Array<{ carrier?: string; reason?: string }>>([]);
  const [originZipcode, setOriginZipcode] = useState("");
  const [packageInfo, setPackageInfo] = useState<Record<string, unknown> | null>(null);
  const [selectedCarriers, setSelectedCarriers] = useState<string[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkRef, setLinkRef] = useState("");
  const [continueToLabel, setContinueToLabel] = useState(false);
  const [quoteAccountId, setQuoteAccountId] = useState(order.envioecomAccountId || "");
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountPickerAction, setAccountPickerAction] = useState<"quote" | "link" | null>(null);
  const [accountOptions, setAccountOptions] = useState<EnvioEcomAccountOption[]>([]);
  const [pendingLinkContinueToLabel, setPendingLinkContinueToLabel] = useState(false);

  const carrierFilters = useMemo(() => {
    const fromResults = [
      ...quotes.map(quoteCarrier),
      ...unavailable.map((row) => String(row.carrier || "").trim()),
    ].filter(Boolean);
    return Array.from(new Set([...DEFAULT_CARRIER_FILTERS, ...fromResults]));
  }, [quotes, unavailable]);

  if (isMotoboyOrPickup(order.shippingType)) return null;

  const barcode = order.envioecomBarcode || order.trackingCode || "";
  const needsBind = isProvisionalBarcode(barcode) && !order.envioecomShipmentId;
  const labelUrl = order.envioecomLabelUrl || order.trackingLabelUrl || "";
  const orderDisplayId = Number.isFinite(Number(order.orderNumber)) && Number(order.orderNumber) > 0
    ? String(Math.trunc(Number(order.orderNumber)))
    : order.id;

  async function patchFromResponse(data: { order?: EnvioEcomOrderFields }) {
    if (data.order) onPatched(data.order);
  }

  function toggleCarrier(carrier: string) {
    setSelectedCarriers((current) => (
      current.includes(carrier)
        ? current.filter((item) => item !== carrier)
        : [...current, carrier]
    ));
  }

  async function loadConfiguredAccounts(): Promise<EnvioEcomAccountOption[]> {
    const res = await fetch(`${BASE}/api/admin/envioecom/accounts`, { headers: adminHeaders() });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json() as { accounts?: EnvioEcomAccountOption[] };
    return (data.accounts || []).filter((account) => account.configured);
  }

  async function resolveAccountId(opts: { skipIfBound?: boolean } = {}): Promise<string | null> {
    if (opts.skipIfBound && order.envioecomAccountId) return order.envioecomAccountId;
    const accounts = await loadConfiguredAccounts();
    setAccountOptions(accounts);
    if (!accounts.length) {
      toast.error("Cadastre uma API EnvioEcom em Configurações.");
      return null;
    }
    if (accounts.length === 1) return accounts[0].id;
    return "PICK";
  }

  async function quote(carriers = selectedCarriers, accountId = quoteAccountId) {
    setQuoteOpen(true);
    setBusy("quote");
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${order.id}/quote`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          ...(carriers.length ? { carriers } : {}),
          ...(accountId ? { accountId } : {}),
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json() as {
        quotes?: QuoteOption[];
        unavailableCarriers?: Array<{ carrier?: string; reason?: string; message?: string }>;
        originZipcode?: string;
        package?: Record<string, unknown>;
        accountId?: string;
      };
      setQuotes(data.quotes || []);
      setUnavailable((data.unavailableCarriers || []).map((row) => ({
        carrier: row.carrier,
        reason: row.reason || row.message,
      })));
      setOriginZipcode(String(data.originZipcode || ""));
      setPackageInfo(data.package || null);
      if (data.accountId) setQuoteAccountId(data.accountId);
      if (!(data.quotes || []).length) toast.error("Nenhuma transportadora disponível para este CEP.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao cotar.");
    } finally {
      setBusy(null);
    }
  }

  async function createShipment(quoteOption: QuoteOption) {
    const shippingCompany = quoteCarrier(quoteOption);
    if (!shippingCompany) {
      toast.error("Cotação sem nome de transportadora.");
      return;
    }
    setBusy("create");
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${order.id}/create`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          shippingCompany,
          freightCost: quotePrice(quoteOption),
          deliveryTime: quoteDays(quoteOption) || "1",
          originCep: originZipcode,
          height: packageInfo?.height,
          width: packageInfo?.width,
          length: packageInfo?.length,
          weight: packageInfo?.weight,
          accountId: quoteAccountId || undefined,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json() as { order?: EnvioEcomOrderFields };
      await patchFromResponse(data);
      setQuoteOpen(false);
      toast.success("Envio criado na EnvioEcom.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar envio.");
    } finally {
      setBusy(null);
    }
  }

  async function startQuote() {
    try {
      const picked = await resolveAccountId();
      if (!picked) return;
      if (picked === "PICK") {
        setAccountPickerAction("quote");
        setAccountPickerOpen(true);
        return;
      }
      setQuoteAccountId(picked);
      await quote(selectedCarriers, picked);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao listar contas EnvioEcom.");
    }
  }

  function openEnvioEcomLinkModal(nextContinueToLabel = false) {
    setContinueToLabel(nextContinueToLabel);
    void startLink(nextContinueToLabel);
  }

  async function startLink(nextContinueToLabel = false) {
    try {
      const picked = await resolveAccountId({ skipIfBound: true });
      if (!picked) return;
      if (picked === "PICK") {
        setPendingLinkContinueToLabel(nextContinueToLabel);
        setAccountPickerAction("link");
        setAccountPickerOpen(true);
        return;
      }
      setQuoteAccountId(picked);
      setContinueToLabel(nextContinueToLabel);
      setLinkOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao listar contas EnvioEcom.");
    }
  }

  async function chooseAccount(accountId: string) {
    setAccountPickerOpen(false);
    setQuoteAccountId(accountId);
    const action = accountPickerAction;
    setAccountPickerAction(null);
    if (action === "quote") {
      await quote(selectedCarriers, accountId);
      return;
    }
    if (action === "link") {
      setContinueToLabel(pendingLinkContinueToLabel);
      setPendingLinkContinueToLabel(false);
      setLinkOpen(true);
    }
  }

  async function linkEnvioEcomShipment() {
    const parsed = parseEnvioEcomLinkRef(linkRef);
    if (!parsed.shipmentId && !parsed.barcode) {
      toast.error("Informe o ID do envio ou o código de rastreio.");
      return;
    }
    setBusy("bind");
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${order.id}/sync`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify(parsed.shipmentId
          ? { shipment_id: parsed.shipmentId, accountId: quoteAccountId || order.envioecomAccountId || undefined }
          : { barcode: parsed.barcode, accountId: quoteAccountId || order.envioecomAccountId || undefined }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json() as { order?: EnvioEcomOrderFields };
      await patchFromResponse(data);
      setLinkOpen(false);
      setLinkRef("");
      toast.success("Envio EnvioEcom vinculado.");
      if (continueToLabel) {
        setContinueToLabel(false);
        await generateLabel({ skipBind: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível vincular o envio.");
    } finally {
      setBusy(null);
    }
  }

  async function generateLabel(opts?: { skipBind?: boolean }) {
    if (needsBind && !opts?.skipBind) {
      openEnvioEcomLinkModal(true);
      return;
    }

    setBusy("label");
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${order.id}/labels`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({}),
      });
      if (res.status === 202) {
        toast.message("Etiqueta ainda em processamento. Tente de novo em instantes.");
        return;
      }
      if (!res.ok) {
        const payload = await readErrorPayload(res);
        if (payload.error === "SHIPMENT_ID_REQUIRED") {
          openEnvioEcomLinkModal(true);
        }
        throw new Error(payload.message);
      }
      const data = await res.json() as { order?: EnvioEcomOrderFields; labelUrl?: string };
      await patchFromResponse(data);
      toast.success("Etiqueta gerada.");
      if (data.labelUrl) window.open(data.labelUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar etiqueta.");
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${order.id}/sync`, {
        method: "POST",
        headers: adminHeaders(),
        body: "{}",
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json() as { order?: EnvioEcomOrderFields };
      await patchFromResponse(data);
      toast.success("Rastreio atualizado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao sincronizar.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelShipment() {
    if (!window.confirm("Cancelar este envio na EnvioEcom?")) return;
    setBusy("cancel");
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${order.id}/cancel`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ reason: "Cancelado pelo admin" }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json() as { order?: EnvioEcomOrderFields; message?: string; autoCancelled?: boolean };
      await patchFromResponse(data);
      toast.success(data.autoCancelled ? "Envio cancelado e saldo estornado." : (data.message || "Solicitação de cancelamento aberta."));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao cancelar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50" disabled={!!busy} onClick={() => void startQuote()}>
        {busy === "quote" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
        EnvioEcom
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-teal-700 border-teal-200 hover:bg-teal-50"
        disabled={!!busy}
        onClick={() => openEnvioEcomLinkModal(false)}
      >
        {busy === "bind" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
        Vincular EE
      </Button>
      {(order.envioecomShipmentId || barcode) && (
        <Button size="sm" variant="outline" className="gap-1.5 text-emerald-800 border-emerald-200 hover:bg-emerald-50" disabled={!!busy} onClick={() => void generateLabel()}>
          {busy === "label" || busy === "bind" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Etiqueta EE
        </Button>
      )}
      {(order.envioecomShipmentId || barcode) && (
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void sync()}>
          {busy === "sync" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Sync EE
        </Button>
      )}
      {(order.envioecomShipmentId || barcode) && (
        <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50" disabled={!!busy} onClick={() => void cancelShipment()}>
          {busy === "cancel" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
          Cancelar EE
        </Button>
      )}
      {labelUrl && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(labelUrl, "_blank", "noopener,noreferrer")}>
          <ExternalLink className="w-3.5 h-3.5" /> Ver PDF
        </Button>
      )}
      {order.envioecomStatus && (
        <p className={`basis-full text-xs ${String(order.envioecomStatus).toLowerCase().includes("cancel") ? "text-rose-700" : "text-emerald-800"}`}>
          EnvioEcom: {order.envioecomStatus}
          {prettyAccountName(order) ? ` · ${prettyAccountName(order)}` : ""}
          {order.envioecomDeliveryMode ? ` · ${order.envioecomDeliveryMode}` : ""}
          {barcode ? ` · ${barcode}` : ""}
          {order.envioecomFreightCost != null ? ` · ${formatCurrency(order.envioecomFreightCost)}` : ""}
        </p>
      )}

      {quoteOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setQuoteOpen(false)}>
          <div className="bg-white rounded-[28px] max-w-md w-full shadow-xl max-h-[88vh] overflow-auto p-5 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-neutral-200">
              <div>
                <h2 className="text-lg font-bold text-neutral-900 leading-tight">Cotação EnvioEcom</h2>
                <p className="text-sm text-neutral-500 mt-1">
                  Pedido #{orderDisplayId}{order.clientName ? ` · ${order.clientName}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="text-neutral-500 hover:text-neutral-800 p-1 -mt-1"
                onClick={() => setQuoteOpen(false)}
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="pt-4 pb-4 border-b border-neutral-200">
              <p className="text-[11px] font-semibold tracking-wide text-neutral-400 uppercase mb-2">
                Filtrar transportadoras (opcional)
              </p>
              <div className="flex flex-wrap gap-2">
                {carrierFilters.map((carrier) => {
                  const selected = selectedCarriers.includes(carrier);
                  return (
                    <button
                      key={carrier}
                      type="button"
                      onClick={() => toggleCarrier(carrier)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        selected
                          ? "border-amber-700 bg-amber-50 text-amber-900"
                          : "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-400"
                      }`}
                    >
                      {carrier}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  disabled={busy === "quote"}
                  onClick={() => void quote(selectedCarriers)}
                  className="px-4 py-1.5 rounded-full text-sm border border-amber-700 text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                >
                  {busy === "quote" ? "Atualizando..." : "Atualizar cotação"}
                </button>
                <button
                  type="button"
                  disabled={busy === "quote"}
                  onClick={() => {
                    setSelectedCarriers([]);
                    void quote([]);
                  }}
                  className="px-4 py-1.5 rounded-full text-sm border border-amber-700 text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                >
                  Limpar filtro
                </button>
              </div>
            </div>

            <div className="pt-4 space-y-3">
              {busy === "quote" && quotes.length === 0 ? (
                <p className="text-sm text-neutral-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Cotando frete...
                </p>
              ) : quotes.length === 0 ? (
                <p className="text-sm text-neutral-500">Nenhuma opção disponível.</p>
              ) : (
                quotes.map((quoteOption, index) => (
                  <button
                    key={`${quoteCarrier(quoteOption)}-${index}`}
                    type="button"
                    className="w-full text-left rounded-2xl border border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50 px-4 py-3 disabled:opacity-60"
                    disabled={!!busy}
                    onClick={() => void createShipment(quoteOption)}
                  >
                    <p className="text-sm font-bold text-neutral-900">{quoteCarrier(quoteOption) || "Transportadora"}</p>
                    <p className="text-sm text-neutral-500 mt-0.5">
                      {formatCurrency(quotePrice(quoteOption))}
                      {quoteDays(quoteOption) ? ` · ${quoteDays(quoteOption)} dia(s)` : ""}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {linkOpen && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setLinkOpen(false)}>
          <div className="bg-white rounded-[28px] max-w-md w-full shadow-xl p-5 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-neutral-200">
              <div>
                <h2 className="text-lg font-bold text-neutral-900 leading-tight">Vincular EnvioEcom</h2>
                <p className="text-sm text-neutral-500 mt-1">
                  Pedido #{orderDisplayId}{order.clientName ? ` · ${order.clientName}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="text-neutral-500 hover:text-neutral-800 p-1 -mt-1"
                onClick={() => setLinkOpen(false)}
                aria-label="Fechar"
                disabled={!!busy}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-600 mt-4">
              Cole o ID do envio no painel EnvioEcom (ex. 726270) ou o código de rastreio. Não cria envio novo — só liga o que já existe.
            </p>
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void linkEnvioEcomShipment();
              }}
            >
              <input
                className="h-11 w-full rounded-xl border border-neutral-300 px-3 text-sm"
                placeholder="ID ou rastreio"
                value={linkRef}
                onChange={(event) => setLinkRef(event.target.value)}
                autoFocus
                disabled={busy === "bind"}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => setLinkOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy === "bind" || !linkRef.trim()}>
                  {busy === "bind" ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Link2 className="w-4 h-4 mr-1.5" />}
                  Vincular
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {accountPickerOpen && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={() => setAccountPickerOpen(false)}>
          <div className="bg-white rounded-[28px] max-w-md w-full shadow-xl p-5 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-neutral-200">
              <div>
                <h2 className="text-lg font-bold text-neutral-900 leading-tight">Escolher API EnvioEcom</h2>
                <p className="text-sm text-neutral-500 mt-1">
                  Pedido #{orderDisplayId}{order.clientName ? ` · ${order.clientName}` : ""}
                </p>
              </div>
              <button type="button" className="text-neutral-500 hover:text-neutral-800 p-1 -mt-1" onClick={() => setAccountPickerOpen(false)} aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-600 mt-4">A cotação e a etiqueta precisam ser da mesma conta.</p>
            <div className="mt-4 space-y-2">
              {accountOptions.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className="w-full text-left rounded-2xl border border-neutral-200 hover:border-emerald-400 hover:bg-emerald-50 px-4 py-3"
                  onClick={() => void chooseAccount(account.id)}
                >
                  <p className="text-sm font-bold text-neutral-900">{account.name}</p>
                  {account.originCep ? <p className="text-xs text-neutral-500 mt-0.5">CEP origem {account.originCep}</p> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function hasEnvioEcomLabelReady(order: EnvioEcomOrderFields): boolean {
  const normalized = String(order.envioecomStatus || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (normalized.includes("cancelad") || normalized.includes("aguardando pagamento")) return false;
  if (String(order.envioecomLabelUrl || "").trim()) return true;
  if (!normalized) return false;
  return [
    "etiqueta emitida",
    "etiqueta gerada",
    "pronto para envio",
    "processando envio",
    "aguardando expedicao",
    "dc-e emitida",
    "dce emitida",
    "coletado",
    "em transito",
    "postado",
    "saiu para entrega",
    "entregue",
    "objeto entregue",
  ].some((marker) => normalized.includes(marker));
}

export function preserveEnvioEcomLabelFields<T extends {
  envioecomLabelUrl?: string | null;
  trackingLabelUrl?: string | null;
  envioecomStatus?: string | null;
}>(incoming: T, previous?: T | null): T {
  if (!previous) return incoming;
  const nextLabel = String(incoming.envioecomLabelUrl || "").trim();
  const prevLabel = String(previous.envioecomLabelUrl || "").trim();
  const nextTracking = String(incoming.trackingLabelUrl || "").trim();
  const prevTracking = String(previous.trackingLabelUrl || "").trim();
  const incomingStatus = String(incoming.envioecomStatus || "").trim();
  const previousStatus = String(previous.envioecomStatus || "").trim();
  const incomingNormalized = incomingStatus
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const incomingBlocked = incomingNormalized.includes("cancelad") || incomingNormalized.includes("aguardando pagamento");
  const keepPreviousStatus = !incomingBlocked
    && !hasEnvioEcomLabelReady({ envioecomStatus: incomingStatus, envioecomLabelUrl: nextLabel })
    && hasEnvioEcomLabelReady({ envioecomStatus: previousStatus, envioecomLabelUrl: prevLabel });
  return {
    ...incoming,
    envioecomLabelUrl: incomingBlocked ? incoming.envioecomLabelUrl : (nextLabel || prevLabel || incoming.envioecomLabelUrl),
    trackingLabelUrl: incomingBlocked ? incoming.trackingLabelUrl : (nextTracking || prevTracking || incoming.trackingLabelUrl),
    envioecomStatus: incomingBlocked
      ? incoming.envioecomStatus
      : (keepPreviousStatus ? previous.envioecomStatus : (incoming.envioecomStatus || previous.envioecomStatus)),
  };
}
