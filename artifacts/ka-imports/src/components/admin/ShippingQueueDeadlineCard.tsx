import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export const SHIPPING_QUEUE_MANUAL_ENABLED_KEY = "shipping_queue_manual_enabled";
export const SHIPPING_QUEUE_MANUAL_HOURS_KEY = "shipping_queue_manual_hours";

function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "on", "yes"].includes(String(value || "").trim().toLowerCase());
}

function parseHours(raw: string): string | null {
  const parsed = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  const hours = Math.round(parsed);
  if (hours < 1 || hours > 999) return null;
  return String(hours);
}

type SaveSetting = (
  key: string,
  value: string,
  options?: { quiet?: boolean },
) => boolean | void | Promise<boolean | void>;

export function ShippingQueueDeadlineCard({
  enabledValue,
  hoursValue,
  saving,
  onSave,
}: {
  enabledValue: string | undefined;
  hoursValue: string | undefined;
  saving: boolean;
  onSave: SaveSetting;
}) {
  const [enabled, setEnabled] = useState(() => isEnabled(enabledValue));
  const [hours, setHours] = useState(() => hoursValue || "48");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setEnabled(isEnabled(enabledValue));
    setHours(hoursValue || "48");
  }, [enabledValue, hoursValue, dirty]);

  async function save() {
    if (enabled) {
      const normalized = parseHours(hours);
      if (!normalized) {
        toast.error("Informe um prazo entre 1 e 999 horas.");
        return;
      }
      const hoursSaved = await onSave(SHIPPING_QUEUE_MANUAL_HOURS_KEY, normalized, { quiet: true });
      if (hoursSaved === false) return;
      const enabledSaved = await onSave(SHIPPING_QUEUE_MANUAL_ENABLED_KEY, "1", { quiet: true });
      if (enabledSaved === false) return;
      setHours(normalized);
    } else {
      const enabledSaved = await onSave(SHIPPING_QUEUE_MANUAL_ENABLED_KEY, "0", { quiet: true });
      if (enabledSaved === false) return;
    }
    setDirty(false);
    toast.success("Prazo de postagem salvo.");
  }

  return (
    <div className="rounded-xl border bg-orange-50/70 border-orange-200 p-5 space-y-4">
      <div>
        <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide">Prazo de postagem no checkout</p>
        <p className="text-sm text-orange-950/80 mt-1">
          Troca só o número do aviso “Postagem em até X horas”. As vagas continuam da fila de 20 por dia. O pedido, as cópias 48h/72h/96h e o botão de envio não usam esse número.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-orange-950">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setDirty(true);
            setEnabled(event.target.checked);
          }}
          className="h-4 w-4 rounded border-orange-300"
        />
        Usar prazo manual
      </label>

      <label className="block text-sm max-w-xs">
        <span className="block text-xs font-medium mb-1 text-orange-900">Horas</span>
        <input
          type="number"
          min={1}
          max={999}
          step={1}
          inputMode="numeric"
          disabled={!enabled}
          value={hours}
          onChange={(event) => {
            setDirty(true);
            setHours(event.target.value);
          }}
          className="h-11 w-full px-3 rounded-xl border-2 border-orange-200 bg-white outline-none focus:border-orange-400 text-sm disabled:bg-orange-100/60 disabled:text-muted-foreground"
        />
      </label>

      <Button type="button" disabled={saving} onClick={() => { void save(); }}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Salvar prazo
      </Button>
    </div>
  );
}
