import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatDateOnlyBR } from "@/lib/utils";
import {
  fetchRelatedCpfShipments,
  relatedCpfOrderLabel,
  type RelatedCpfShipment,
  type RelatedCpfShipmentsResult,
  type RelatedCpfWarningLevel,
} from "@/lib/related-cpf-shipments";

function productLine(shipment: RelatedCpfShipment): string {
  return shipment.products
    .slice(0, 3)
    .map((item) => `${item.quantity}× ${item.productName}`)
    .join(" · ");
}

export function RelatedCpfShipmentRows({
  shipments,
  compact = false,
}: {
  shipments: RelatedCpfShipment[];
  compact?: boolean;
}) {
  if (shipments.length === 0) return null;
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2"}>
      {shipments.map((shipment) => (
        <li
          key={`${shipment.orderId}-${shipment.barcode || shipment.envioecomShipmentId || shipment.shippedAt}`}
          className="text-xs leading-snug"
        >
          <p className="font-semibold text-neutral-900">
            {relatedCpfOrderLabel(shipment)}
            <span className="font-normal text-neutral-600">
              {" · "}
              {formatDateOnlyBR(shipment.shippedAt)}
              {shipment.barcode ? ` · ${shipment.barcode}` : " · sem rastreio"}
            </span>
          </p>
          <p className="text-neutral-600">
            {shipment.envioecomStatus || (shipment.enviado ? "Enviado" : "Pedido pago")}
            {shipment.accountName ? ` · ${shipment.accountName}` : ""}
            {shipment.sameProduct ? " · mesmo produto" : ""}
            {shipment.isReshipRelated ? " · reenvio" : ""}
          </p>
          {productLine(shipment) ? <p className="text-neutral-500">{productLine(shipment)}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function relatedCpfWarningTitle(level: RelatedCpfWarningLevel): string {
  if (level === "same_product") return "Este CPF já recebeu o mesmo produto recentemente";
  if (level === "recent") return "Este CPF já teve envio EnvioEcom recente";
  return "Últimos envios deste CPF";
}

export function RelatedCpfWarningBox({
  related,
}: {
  related: RelatedCpfShipmentsResult;
}) {
  if (related.warningLevel === "none" && related.shipments.length === 0) return null;
  const strong = related.warningLevel === "same_product";
  const recent = related.warningLevel === "recent" || strong;
  return (
    <div
      className={`rounded-2xl border px-3 py-3 ${
        strong
          ? "border-red-300 bg-red-50"
          : recent
            ? "border-amber-300 bg-amber-50"
            : "border-neutral-200 bg-neutral-50"
      }`}
    >
      <p className={`text-sm font-bold ${strong ? "text-red-900" : recent ? "text-amber-950" : "text-neutral-900"}`}>
        {relatedCpfWarningTitle(related.warningLevel)}
      </p>
      <p className="text-xs text-neutral-600 mt-1">
        {strong
          ? "Confira o rastreio antes de gerar outra etiqueta. Pode ser o mesmo pedido."
          : recent
            ? `Há envio nos últimos ${related.recentDays} dias. Confira se não é o mesmo cliente/pedido.`
            : "Histórico local da EnvioEcom neste CPF."}
      </p>
      <div className="mt-2">
        <RelatedCpfShipmentRows shipments={related.shipments} compact />
      </div>
    </div>
  );
}

export function RelatedCpfShipments({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [related, setRelated] = useState<RelatedCpfShipmentsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchRelatedCpfShipments(orderId)
      .then((data) => {
        if (cancelled) return;
        setRelated(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setRelated(null);
        setError(err instanceof Error ? err.message : "Não deu para carregar os envios.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  const shipments = related?.shipments || [];
  const countLabel = related
    ? (shipments.length === 1 ? "1 envio" : `${shipments.length} envios`)
    : null;

  return (
    <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/70">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-900">
          Últimos envios deste CPF
          {countLabel ? <span className="font-semibold normal-case tracking-normal text-indigo-800/80"> · {countLabel}</span> : null}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-indigo-800 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="px-3 pb-2">
          {loading ? (
            <p className="text-xs text-indigo-800/80">Carregando envios…</p>
          ) : null}
          {error ? (
            <p className="text-xs text-red-700">{error}</p>
          ) : null}
          {!loading && !error && shipments.length === 0 ? (
            <p className="text-xs text-indigo-800/80">Nenhum outro pedido pago neste CPF.</p>
          ) : null}
          {!loading && !error && shipments.length > 0 ? (
            <RelatedCpfShipmentRows shipments={shipments} compact />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
