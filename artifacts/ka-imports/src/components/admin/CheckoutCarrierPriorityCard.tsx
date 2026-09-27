import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const CHECKOUT_CARRIER_PRIORITY_KEY = "envioecom_checkout_carrier_priority";

const CARRIER_OPTIONS = [
  "Correios Sedex",
  "Correios Pac",
  "Correios Mini Envios",
  "J&T Express envioEcom",
  "Jadlog envioEcom",
  "Ponto Loggi envioEcom",
  "BUSLOG envioEcom",
] as const;

function parseSaved(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const allowed = new Map(CARRIER_OPTIONS.map((name) => [name.toLowerCase(), name]));
    const queue: string[] = [];
    for (const item of parsed) {
      const name = allowed.get(String(item || "").trim().toLowerCase());
      if (!name || queue.includes(name)) continue;
      queue.push(name);
    }
    return queue;
  } catch {
    return [];
  }
}

export function CheckoutCarrierPriorityCard({
  value,
  saving,
  onSave,
}: {
  value: string | undefined;
  saving: boolean;
  onSave: (key: string, value: string) => void | Promise<void>;
}) {
  const [queue, setQueue] = useState<string[]>(() => parseSaved(value));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setQueue(parseSaved(value));
  }, [value, dirty]);

  const available = CARRIER_OPTIONS.filter((name) => !queue.includes(name));

  function update(next: string[]) {
    setDirty(true);
    setQueue(next);
  }

  return (
    <div className="rounded-xl border bg-sky-50/70 border-sky-200 p-5 space-y-4">
      <div>
        <p className="text-xs font-semibold text-sky-800 uppercase tracking-wide">Prazo da transportadora no checkout</p>
        <p className="text-sm text-sky-900/80 mt-1">
          O topo da fila é a 1ª opção. O card do frete padrão troca a descrição pelos dias úteis da EnvioEcom. O nome e o preço continuam os cadastrados em Fretes. Lista vazia desliga a consulta. Motoboy fica de fora.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-sky-200 bg-white p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Fora da fila</p>
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todas as transportadoras já estão na fila.</p>
          ) : available.map((name) => (
            <div key={name} className="flex items-center justify-between gap-2">
              <span className="text-sm">{name}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => update([...queue, name])}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar
              </Button>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-sky-200 bg-white p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Fila do checkout</p>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Vazia: o checkout não consulta a EnvioEcom e mantém o texto do frete.</p>
          ) : queue.map((name, index) => (
            <div key={name} className="flex items-center justify-between gap-2">
              <span className="text-sm">
                <span className="font-semibold text-sky-800 mr-2">{index + 1}ª</span>
                {name}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...queue];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    update(next);
                  }}
                  aria-label={`Subir ${name}`}
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={index === queue.length - 1}
                  onClick={() => {
                    const next = [...queue];
                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                    update(next);
                  }}
                  aria-label={`Descer ${name}`}
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => update(queue.filter((item) => item !== name))}
                  aria-label={`Remover ${name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <Button
        type="button"
        disabled={saving}
        onClick={() => {
          setDirty(false);
          void onSave(CHECKOUT_CARRIER_PRIORITY_KEY, JSON.stringify(queue));
        }}
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Salvar fila
      </Button>
    </div>
  );
}
