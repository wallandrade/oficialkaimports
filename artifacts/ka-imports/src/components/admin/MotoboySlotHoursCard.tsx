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
      </p>

      <div className="space-y-3 mb-4">
        {periods.map((period, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="block text-xs font-medium mb-1">das</span>
              <input
                type="number"
                min={0}
                max={23}
                step={1}
                value={period.startHour}
                onChange={(event) => updatePeriod(index, { startHour: Number(event.target.value) })}
                className="w-24 h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-medium mb-1">às</span>
              <input
                type="number"
                min={1}
                max={24}
                step={1}
                value={period.endHour}
                onChange={(event) => updatePeriod(index, { endHour: Number(event.target.value) })}
                className="w-24 h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              />
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
