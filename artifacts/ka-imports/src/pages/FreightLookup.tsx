import { useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ShippingOption = {
  id: string;
  name: string;
  price: number;
};

type LookupState = "idle" | "loading" | "ready" | "unavailable" | "limited";

function formatCep(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function isMotoboyOption(option: ShippingOption): boolean {
  const name = option.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return option.id.startsWith("motoboy_") || name.includes("motoboy");
}

export default function FreightLookup() {
  const [cep, setCep] = useState("");
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [days, setDays] = useState<number | null>(null);
  const [lookup, setLookup] = useState<LookupState>("idle");
  const cepDigits = cep.replace(/\D/g, "");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${BASE}/api/shipping-options`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { options?: ShippingOption[] }) => {
        setOptions((data.options || []).filter((option) => !isMotoboyOption(option)));
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setOptions([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (cepDigits.length !== 8) {
      setDays(null);
      setLookup("idle");
      return () => controller.abort();
    }

    setDays(null);
    setLookup("loading");
    const timer = window.setTimeout(() => {
      fetch(`${BASE}/api/shipping/delivery-estimate?cep=${cepDigits}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (response.status === 429) {
            setLookup("limited");
            setDays(null);
            return;
          }
          if (!response.ok) {
            setLookup("unavailable");
            setDays(null);
            return;
          }
          const data = await response.json() as { deliveryTimeDays?: number | null };
          const next = Number(data.deliveryTimeDays);
          if (Number.isFinite(next) && next >= 1) {
            setDays(Math.trunc(next));
            setLookup("ready");
            return;
          }
          setDays(null);
          setLookup("unavailable");
        })
        .catch((error: Error) => {
          if (error.name === "AbortError") return;
          setDays(null);
          setLookup("unavailable");
        });
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cepDigits]);

  const showResults = cepDigits.length === 8;

  return (
    <AppLayout minimal>
      <div className="max-w-lg mx-auto w-full px-4 py-10">
        <div className="bg-card border border-border/60 rounded-2xl shadow-sm p-6 space-y-5">
          <div className="flex items-start gap-3">
            <Truck className="w-6 h-6 text-primary mt-0.5 shrink-0" />
            <div>
              <h1 className="text-2xl font-bold">Consultar frete</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Informe o CEP para ver o valor e o prazo do frete padrão. Esta página não inicia uma compra.
              </p>
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium">CEP</span>
            <input
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              value={cep}
              onChange={(event) => setCep(formatCep(event.target.value))}
              className="mt-2 w-full h-12 px-4 rounded-xl border-2 border-border bg-background focus:border-primary outline-none text-base"
            />
          </label>

          {showResults && optionsLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando fretes...
            </div>
          )}

          {showResults && !optionsLoading && options.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum frete padrão cadastrado.</p>
          )}

          {showResults && !optionsLoading && options.length > 0 && (
            <div className="space-y-3">
              {options.map((option) => (
                <div key={option.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-bold">{option.name}</p>
                    <p className="font-semibold text-primary">{formatCurrency(Number(option.price))}</p>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    {lookup === "loading" && "Consultando prazo..."}
                    {lookup === "ready" && days != null && `${days} dia(s) úteis`}
                    {lookup === "unavailable" && "Prazo indisponível para este CEP."}
                    {lookup === "limited" && "Muitas consultas. Tente novamente em instantes."}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
