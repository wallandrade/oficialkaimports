import { Check, Clock, Package } from "lucide-react";
import { formatDateBR } from "@/lib/utils";

export type ShippingTimelineEvent = {
  status?: string | null;
  description?: string | null;
  location?: string | null;
  at?: string | null;
  updated_at?: string | null;
};

function eventAt(event: ShippingTimelineEvent): string {
  return String(event.at || event.updated_at || "").trim();
}

function eventStatusKey(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function usefulLocation(event: ShippingTimelineEvent): string | null {
  const location = String(event.location || "").trim();
  if (!location) return null;
  if (eventStatusKey(location) === eventStatusKey(event.status)) return null;
  return location;
}

function usefulDescription(event: ShippingTimelineEvent): string | null {
  const description = String(event.description || "").trim();
  if (!description) return null;
  const normalized = eventStatusKey(description);
  if (normalized.includes("status atualizado ao consultar") || normalized.includes("consultando rastreio")) return null;
  if (normalized === eventStatusKey(event.status) || normalized === eventStatusKey(event.location)) return null;
  return description;
}

function eventTime(event: ShippingTimelineEvent): number {
  const parsed = Date.parse(eventAt(event));
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst(events: ShippingTimelineEvent[]): ShippingTimelineEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const delta = eventTime(b.event) - eventTime(a.event);
      if (delta !== 0) return delta;
      return b.index - a.index;
    })
    .map(({ event }) => event);
}

export function ShippingStatusTimeline({
  events,
  title = "Status do envio",
  emptyText,
  className,
}: {
  events: ShippingTimelineEvent[];
  title?: string;
  emptyText?: string;
  className?: string;
}) {
  const items = newestFirst(events);
  if (!items.length) {
    return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  }

  return (
    <div className={className ? `space-y-3 ${className}` : "space-y-3"}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">mais recente em cima</p>
      </div>
      <ol className="space-y-0">
        {items.map((event, index) => {
          const status = String(event.status || "").trim() || "Status";
          const normalized = eventStatusKey(status);
          const highlight = normalized.includes("entregue")
            || normalized.includes("dc-e")
            || normalized.includes("dce emitida");
          const newest = index === 0;
          const location = usefulLocation(event);
          const description = usefulDescription(event);
          const at = eventAt(event);
          const meta = [location, description].filter(Boolean).join(" · ");
          return (
            <li key={`${at}-${status}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    highlight
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : newest
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-sky-400 bg-white text-sky-600"
                  }`}
                >
                  {highlight ? <Check className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
                </span>
                {index < items.length - 1 ? <span className="w-px flex-1 min-h-4 bg-slate-200" /> : null}
              </div>
              <div className={index === items.length - 1 ? "" : "pb-4"}>
                <p className="text-sm font-semibold text-foreground">{status}</p>
                {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
                {at ? (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDateBR(at)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
