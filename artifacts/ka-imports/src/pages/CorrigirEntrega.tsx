/* global fetch, URLSearchParams */
import { FormEvent, useEffect, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { useSearch } from "wouter";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type CorrectionView = {
  orderNumber?: number | string | null;
  clientName: string;
  fields: string[];
  documentMasked: string;
  address: {
    cep: string;
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
  };
};

function readToken(search: string): string {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("token")?.trim() || "";
}

export default function CorrigirEntrega() {
  const search = useSearch();
  const token = readToken(search);
  const [view, setView] = useState<CorrectionView | null>(null);
  const [error, setError] = useState(token ? "" : "Este link é inválido. Peça um novo para a loja.");
  const [loading, setLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [document, setDocument] = useState("");
  const [cep, setCep] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [stateUf, setStateUf] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/delivery-correction/${encodeURIComponent(token)}`);
        const data = (await res.json().catch(() => ({}))) as CorrectionView & { message?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.message || "Este link é inválido ou expirou.");
          return;
        }
        setView(data);
        setCep(data.address?.cep || "");
        setStreet(data.address?.street || "");
        setNumber(data.address?.number || "");
        setComplement(data.address?.complement || "");
        setNeighborhood(data.address?.neighborhood || "");
        setCity(data.address?.city || "");
        setStateUf(data.address?.state || "");
      } catch {
        if (!cancelled) setError("Não foi possível abrir o link. Tente de novo.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function fillCep(raw: string) {
    const digits = raw.replace(/\D/g, "");
    setCep(digits);
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (!res.ok || data.erro) {
        toast.error("CEP não encontrado.");
        return;
      }
      if (data.logradouro) setStreet(data.logradouro);
      if (data.bairro) setNeighborhood(data.bairro);
      if (data.localidade) setCity(data.localidade);
      if (data.uf) setStateUf(data.uf);
    } catch {
      toast.error("Não foi possível consultar o CEP.");
    } finally {
      setCepLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/delivery-correction/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document,
          cep,
          street,
          number,
          complement,
          neighborhood,
          city,
          state: stateUf,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(data.message || "Não foi possível salvar.");
        return;
      }
      setDone(true);
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 px-4 py-10">
      <div className="mx-auto w-full max-w-lg rounded-3xl border border-border bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <MapPin className="h-5 w-5 text-slate-700" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Corrigir dados da entrega</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {view ? `Pedido #${view.orderNumber ?? "-"} · olá, ${view.clientName}` : "Confira CPF, CEP e endereço."}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-700">{error}</p>
        ) : done ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-relaxed text-emerald-800">
            Dados atualizados. A loja já pode emitir o frete de novo. Pode fechar esta página.
          </p>
        ) : view ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">CPF ou CNPJ</span>
              <input
                value={document}
                onChange={(event) => setDocument(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder={view.documentMasked}
                className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-primary"
              />
              <span className="mt-1 block text-xs text-muted-foreground">Hoje está como {view.documentMasked}. Digite o documento completo.</span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">CEP</span>
              <input
                value={cep}
                onChange={(event) => { void fillCep(event.target.value); }}
                inputMode="numeric"
                className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-primary"
              />
              {cepLoading ? <span className="mt-1 block text-xs text-muted-foreground">Buscando endereço…</span> : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Rua</span>
              <input value={street} onChange={(event) => setStreet(event.target.value)} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-primary" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Número</span>
                <input value={number} onChange={(event) => setNumber(event.target.value)} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-primary" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Complemento</span>
                <input value={complement} onChange={(event) => setComplement(event.target.value)} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-primary" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Bairro</span>
              <input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-primary" />
            </label>
            <div className="grid grid-cols-[1fr_5rem] gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Cidade</span>
                <input value={city} onChange={(event) => setCity(event.target.value)} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-primary" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">UF</span>
                <input value={stateUf} onChange={(event) => setStateUf(event.target.value.toUpperCase().slice(0, 2))} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-primary" />
              </label>
            </div>
            <button type="submit" disabled={saving} className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar correção"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
