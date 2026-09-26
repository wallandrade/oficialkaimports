import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  MOTOBOY_SLOT_HOURS_KEY,
  nextDraftPeriod,
  resolveMotoboySlotPeriods,
  serializeMotoboySlotHours,
  validateMotoboySlotHours,
  type MotoboySlotPeriod,
} from "@/lib/motoboy-slot-hours";

type Props = {
  settings: Record<string, string>;
  loading: Record<string, boolean>;
  onSave: (key: string, value: string) => void | Promise<void>;
};

const CLOCK_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const END_HOURS = [...CLOCK_HOURS.slice(1), 0];

function hourOptionLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

export function MotoboySlotHoursCard({ settings, loading, onSave }: Props) {
  const [periods, setPeriods] = useState<MotoboySlotPeriod[]>(() => resolveMotoboySlotPeriods(settings[MOTOBOY_SLOT_HOURS_KEY]));
  const [dirty, setDirty] = useState(false);
  const saving = !!loading[MOTOBOY_SLOT_HOURS_KEY];
  const nextPeriod = nextDraftPeriod(periods);

  useEffect(() => {
    if (dirty) return;
    setPeriods(resolveMotoboySlotPeriods(settings[MOTOBOY_SLOT_HOURS_KEY]));
  }, [settings, dirty]);

  const updatePeriod = (index: number, patch: Partial<MotoboySlotPeriod>) => {
    setPeriods((current) => current.map((period, periodIndex) => (
      periodIndex === index ? { ...period, ...patch } : period
    )));
    setDirty(true);
  };

  const savePeriods = async () => {
    const parsed = validateMotoboySlotHours({ periods });
    if (!parsed.ok) {
      toast.error(parsed.message);
      return;
    }
    await onSave(MOTOBOY_SLOT_HOURS_KEY, serializeMotoboySlotHours(parsed.periods));
    setPeriods(parsed.periods);
    setDirty(false);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-border p-6">
      <h3 className="font-semibold text-base mb-1">Períodos do Motoboy</h3>
      <p className="text-xs text-muted-foreground mb-4">
        O cliente não marca uma hora. Ele escolhe um período em que alguém estará em casa, e o motoboy entrega dentro desse intervalo.
        Sem valor salvo, a loja usa um período só: 10:00 às 20:00. Vale para bairro, faixa de CEP e km.
        No fim, 00 é meia-noite.
      </p>

      <div className="space-y-3 mb-4">
        {periods.map((period, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="block text-xs font-medium mb-1">das</span>
              <select
                aria-label={`Início do período ${index + 1}`}
                value={period.startHour}
                onChange={(event) => updatePeriod(index, { startHour: Number(event.target.value) })}
                className="w-24 h-10 px-3 rounded-xl border-2 border-border bg-white outline-none focus:border-primary text-sm"
              >
                {CLOCK_HOURS.map((hour) => (
                  <option key={hour} value={hour}>{hourOptionLabel(hour)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs font-medium mb-1">às</span>
              <select
                aria-label={`Fim do período ${index + 1}`}
                value={period.endHour === 24 ? 0 : period.endHour}
                onChange={(event) => {
                  const hour = Number(event.target.value);
                  updatePeriod(index, { endHour: hour === 0 ? 24 : hour });
                }}
                className="w-24 h-10 px-3 rounded-xl border-2 border-border bg-white outline-none focus:border-primary text-sm"
              >
                {END_HOURS.map((hour) => (
                  <option key={hour} value={hour}>{hourOptionLabel(hour)}</option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10"
              onClick={() => {
                setPeriods((current) => current.filter((_, periodIndex) => periodIndex !== index));
                setDirty(true);
              }}
              aria-label={`Remover período ${index + 1}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!nextPeriod}
          onClick={() => {
            if (!nextPeriod) return;
            setPeriods((current) => [...current, nextPeriod]);
            setDirty(true);
          }}
        >
          <Plus className="w-4 h-4 mr-1" />
          Adicionar outro período
        </Button>
        <Button type="button" size="sm" onClick={() => void savePeriods()} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar horários"}
        </Button>
      </div>
    </div>
  );
}
