import { useEffect, useState } from "react";
import { Loader2, ToggleLeft } from "lucide-react";
import { IconLucide } from "@/components/ui/IconLucide";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_MOTOBOY_DISTANCE_CONFIG,
  DEFAULT_MOTOBOY_ORIGIN_CEP,
  MOTOBOY_DISTANCE_SETTING_KEYS,
  parseMotoboyDistanceConfig,
  parseMotoboyDistanceEnabled,
  parseMotoboyOriginCep,
  serializeMotoboyDistanceConfig,
  type MotoboyDistanceBand,
} from "@/lib/motoboy-distance-config";

type Props = {
  settings: Record<string, string>;
  loading: Record<string, boolean>;
  onSave: (key: string, value: string) => void | Promise<void>;
};

function formatCepDisplay(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function MotoboyDistanceCard({ settings, loading, onSave }: Props) {
  const enabled = parseMotoboyDistanceEnabled(settings[MOTOBOY_DISTANCE_SETTING_KEYS.enabled]);
  const savedOrigin = parseMotoboyOriginCep(settings[MOTOBOY_DISTANCE_SETTING_KEYS.originCep]);
  const savedConfig = parseMotoboyDistanceConfig(settings[MOTOBOY_DISTANCE_SETTING_KEYS.config]);

  const [originCep, setOriginCep] = useState(savedOrigin);
  const [centroPrice, setCentroPrice] = useState(String(savedConfig.centroPrice));
  const [consultAfterKm, setConsultAfterKm] = useState(String(savedConfig.consultAfterKm));
  const [bands, setBands] = useState<MotoboyDistanceBand[]>(savedConfig.bands);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setOriginCep(parseMotoboyOriginCep(settings[MOTOBOY_DISTANCE_SETTING_KEYS.originCep]));
    const next = parseMotoboyDistanceConfig(settings[MOTOBOY_DISTANCE_SETTING_KEYS.config]);
    setCentroPrice(String(next.centroPrice));
    setConsultAfterKm(String(next.consultAfterKm));
    setBands(next.bands);
  }, [settings, dirty]);

  const saving =
    !!loading[MOTOBOY_DISTANCE_SETTING_KEYS.originCep] ||
    !!loading[MOTOBOY_DISTANCE_SETTING_KEYS.config];

  const saveAll = async () => {
    const cep = originCep.replace(/\D/g, "");
    if (cep.length !== 8) return;
    const parsedBands = bands
      .map((b) => ({ maxKm: Number(b.maxKm), price: Number(b.price) }))
      .filter((b) => Number.isFinite(b.maxKm) && b.maxKm > 0 && Number.isFinite(b.price) && b.price >= 0)
      .sort((a, b) => a.maxKm - b.maxKm);
    const config = {
      centroPrice: Math.max(0, Number(centroPrice) || 0),
      consultAfterKm: Math.max(1, Number(consultAfterKm) || DEFAULT_MOTOBOY_DISTANCE_CONFIG.consultAfterKm),
      bands: parsedBands.length > 0 ? parsedBands : DEFAULT_MOTOBOY_DISTANCE_CONFIG.bands,
    };
    await onSave(MOTOBOY_DISTANCE_SETTING_KEYS.originCep, cep);
    await onSave(MOTOBOY_DISTANCE_SETTING_KEYS.config, serializeMotoboyDistanceConfig(config));
    setDirty(false);
  };

  const resetDefaults = () => {
    setOriginCep(DEFAULT_MOTOBOY_ORIGIN_CEP);
    setCentroPrice(String(DEFAULT_MOTOBOY_DISTANCE_CONFIG.centroPrice));
    setConsultAfterKm(String(DEFAULT_MOTOBOY_DISTANCE_CONFIG.consultAfterKm));
    setBands([...DEFAULT_MOTOBOY_DISTANCE_CONFIG.bands]);
    setDirty(true);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-border p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <IconLucide name="MapPin" className="w-4 h-4 text-primary" />
          Motoboy por distância (km)
        </h3>
        <button
          type="button"
          onClick={() => onSave(MOTOBOY_DISTANCE_SETTING_KEYS.enabled, enabled ? "0" : "1")}
          disabled={!!loading[MOTOBOY_DISTANCE_SETTING_KEYS.enabled]}
          className="flex-shrink-0"
          aria-label={enabled ? "Desativar Motoboy por km" : "Ativar Motoboy por km"}
        >
          {loading[MOTOBOY_DISTANCE_SETTING_KEYS.enabled]
            ? <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            : enabled
              ? <IconLucide name="ToggleRight" className="w-10 h-10 text-green-500 cursor-pointer hover:text-green-600 transition-colors" />
              : <ToggleLeft className="w-10 h-10 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />}
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Liga o Motoboy por km e o cadastro de bairros sai do checkout (os bairros ficam salvos, só não cotizam).
        Acima do limite o Motoboy some — consultar pessoalmente, sem cair na faixa de CEP.
      </p>

      <div className={`rounded-xl border px-3 py-2 text-xs mb-4 ${enabled ? "border-green-200 bg-green-50 text-green-800" : "border-border bg-muted/40 text-muted-foreground"}`}>
        {enabled
          ? "Ativo: checkout cobra por km (bairro cadastrado ignorado). Faixa de CEP só se o CEP não tiver coordenadas."
          : "Desligado: checkout volta a usar bairro cadastrado e faixa de CEP."}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium mb-1">CEP de partida *</label>
          <input
            value={formatCepDisplay(originCep)}
            onChange={(e) => {
              setOriginCep(e.target.value.replace(/\D/g, "").slice(0, 8));
              setDirty(true);
            }}
            placeholder="01001-000"
            className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm font-mono"
            disabled={!enabled}
          />
          <p className="text-[11px] text-muted-foreground mt-1">Padrão: Sé (01001-000).</p>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Sé e centro (R$)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={centroPrice}
            onChange={(e) => { setCentroPrice(e.target.value); setDirty(true); }}
            className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
            disabled={!enabled}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Consultar acima de (km)</label>
          <input
            type="number"
            min="1"
            step="1"
            value={consultAfterKm}
            onChange={(e) => { setConsultAfterKm(e.target.value); setDirty(true); }}
            className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
            disabled={!enabled}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border mb-4">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-3 py-2">Até (km)</th>
              <th className="text-left font-medium px-3 py-2">Preço (R$)</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((band, idx) => (
              <tr key={`${band.maxKm}-${idx}`} className="border-t border-border">
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={band.maxKm}
                    onChange={(e) => {
                      const next = [...bands];
                      next[idx] = { ...next[idx], maxKm: Number(e.target.value) };
                      setBands(next);
                      setDirty(true);
                    }}
                    className="w-24 h-9 px-2 rounded-lg border border-border outline-none focus:border-primary text-sm"
                    disabled={!enabled}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={band.price}
                    onChange={(e) => {
                      const next = [...bands];
                      next[idx] = { ...next[idx], price: Number(e.target.value) };
                      setBands(next);
                      setDirty(true);
                    }}
                    className="w-28 h-9 px-2 rounded-lg border border-border outline-none focus:border-primary text-sm"
                    disabled={!enabled}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        Sé / centro / República em São Paulo, ou CEP 010xxxxx, cobram o valor de centro — não a faixa “até 10 km”.
      </p>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <Button type="button" size="sm" variant="outline" onClick={resetDefaults} disabled={!enabled || saving}>
          Restaurar padrão
        </Button>
        <Button type="button" size="sm" onClick={() => void saveAll()} disabled={!enabled || saving || originCep.replace(/\D/g, "").length !== 8}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar km e CEP"}
        </Button>
      </div>
    </div>
  );
}
