import { useState } from "react";
import { Loader2, RefreshCw, Truck, FileText, Ban, ExternalLink } from "lucide-react";
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

  if (isMotoboyOrPickup(order.shippingType)) return null;

  const barcode = order.envioecomBarcode || order.trackingCode || "";
  const needsBind = isProvisionalBarcode(barcode) && !order.envioecomShipmentId;
  const labelUrl = order.envioecomLabelUrl || order.trackingLabelUrl || "";

  async function patchFromResponse(data: { order?: EnvioEcomOrderFields }) {
    if (data.order) onPatched(data.order);
  }

  async function quote() {
    setBusy("quote");
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${order.id}/quote`, {
        method: "POST",
        headers: adminHeaders(),
        body: "{}",
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
      setQuoteOpen(true);
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
      <div className="flex flex-wrap items-center gap-1.5">
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
      </div>
      {order.envioecomStatus && (
        <p className="text-xs text-emerald-800 mt-1">
          EnvioEcom: {order.envioecomStatus}
          {order.envioecomDeliveryMode ? ` · ${order.envioecomDeliveryMode}` : ""}
          {barcode ? ` · ${barcode}` : ""}
          {order.envioecomFreightCost != null ? ` · ${formatCurrency(order.envioecomFreightCost)}` : ""}
        </p>
      )}

      {quoteOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setQuoteOpen(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-xl max-h-[80vh] overflow-auto" onClick={(event) => event.stopPropagation()}>
            <p className="text-sm font-semibold mb-1">Cotações EnvioEcom</p>
            <p className="text-xs text-muted-foreground mb-3">Escolha a transportadora com o nome exato da cotação.</p>
            {quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma opção disponível.</p>
            ) : (
              <div className="space-y-2">
                {quotes.map((quoteOption, index) => (
                  <button
                    key={`${quoteCarrier(quoteOption)}-${index}`}
                    type="button"
                    className="w-full text-left rounded-xl border border-emerald-200 hover:bg-emerald-50 px-3 py-2"
                    disabled={!!busy}
                    onClick={() => void createShipment(quoteOption)}
                  >
                    <p className="text-sm font-semibold">{quoteCarrier(quoteOption) || "Transportadora"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(quotePrice(quoteOption))}
                      {quoteDays(quoteOption) ? ` · ${quoteDays(quoteOption)} dia(s)` : ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {unavailable.length > 0 && (
              <div className="mt-3 text-xs text-muted-foreground">
                <p className="font-semibold mb-1">Indisponíveis</p>
                {unavailable.map((row, index) => (
                  <p key={`${row.carrier}-${index}`}>{row.carrier}: {row.reason || "sem cotação"}</p>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setQuoteOpen(false)}>Fechar</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function hasEnvioEcomLabelReady(order: EnvioEcomOrderFields): boolean {
  const status = String(order.envioecomStatus || "").toLowerCase();
  if (order.envioecomLabelUrl) return true;
  return ["etiqueta", "pronto para envio", "processando", "expedição", "expedicao", "trânsito", "transito", "postado", "entregue"].some((marker) => status.includes(marker));
}
