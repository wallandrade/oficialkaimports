import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Truck, FileText, Ban, ExternalLink, X } from "lucide-react";
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

function quoteCarrier(quote: QuoteOption) {
  return String(quote.carrier || quote.shipping_company || "").trim();
}

function quotePrice(quote: QuoteOption) {
  return Number(quote.price ?? quote.freight_cost ?? 0);
}

function quoteDays(quote: QuoteOption) {
  return String(quote.delivery_time ?? quote.delivery_days ?? "");
}

async function readError(res: Response) {
  const data = await res.json().catch(() => ({})) as { message?: string; error?: string };
  return data.message || data.error || "Erro EnvioEcom";
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

  async function quote(carriers = selectedCarriers) {
    setQuoteOpen(true);
    setBusy("quote");
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${order.id}/quote`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify(carriers.length ? { carriers } : {}),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json() as {
        quotes?: QuoteOption[];
        unavailableCarriers?: Array<{ carrier?: string; reason?: string; message?: string }>;
        originZipcode?: string;
        package?: Record<string, unknown>;
      };
      setQuotes(data.quotes || []);
      setUnavailable((data.unavailableCarriers || []).map((row) => ({
        carrier: row.carrier,
        reason: row.reason || row.message,
      })));
      setOriginZipcode(String(data.originZipcode || ""));
      setPackageInfo(data.package || null);
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

  async function generateLabel() {
    if (needsBind) {
      const raw = window.prompt("Informe o ID numérico do envio no painel EnvioEcom (não use o código EC):");
      const shipmentId = Number(String(raw || "").replace(/\D/g, ""));
      if (!Number.isFinite(shipmentId) || shipmentId <= 0) return;
      setBusy("bind");
      try {
        const bindRes = await fetch(`${BASE}/api/admin/envioecom/orders/${order.id}/bind-id`, {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({ shipmentId }),
        });
        if (!bindRes.ok) throw new Error(await readError(bindRes));
        const bindData = await bindRes.json() as { order?: EnvioEcomOrderFields };
        await patchFromResponse(bindData);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Não foi possível salvar o ID.");
        setBusy(null);
        return;
      }
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
      if (!res.ok) throw new Error(await readError(res));
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
      <Button size="sm" variant="outline" className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50" disabled={!!busy} onClick={() => void quote()}>
        {busy === "quote" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
        EnvioEcom
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
        <p className="basis-full text-xs text-emerald-800">
          EnvioEcom: {order.envioecomStatus}
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
    </>
  );
}

export function hasEnvioEcomLabelReady(order: EnvioEcomOrderFields): boolean {
  if (String(order.envioecomLabelUrl || "").trim()) return true;
  const normalized = String(order.envioecomStatus || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.includes("cancelad") || normalized.includes("aguardando pagamento")) return false;
  return [
    "etiqueta emitida",
    "pronto para envio",
    "processando envio",
    "aguardando expedicao",
    "dc-e emitida",
    "dce emitida",
    "em transito",
    "postado",
    "saiu para entrega",
    "entregue",
    "objeto entregue",
  ].some((marker) => normalized.includes(marker));
}
