import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  image?: string | null;
  isActive?: boolean;
  isSoldOut?: boolean;
};

type DraftItem = {
  productId: string;
  name: string;
  image: string | null;
  regularPrice: number;
  flashPrice: string;
};

type Campaign = {
  id: string;
  name: string;
  isActive: boolean;
  slotLimit: number;
  drawPercent: number;
  activeFromHour: number | null;
  activeUntilHour: number | null;
  items: Array<{ productId: string; name: string; image: string | null; regularPrice: number | null; flashPrice: number }>;
  activeReservations: number;
  usedReservations: number;
  seenCount: number;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function money(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const emptyForm = {
  name: "Promoção relâmpago",
  slotLimit: "5",
  drawPercent: "25",
  activeFromHour: "",
  activeUntilHour: "",
  isActive: true,
};

export function AdminFlashOffersPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");

  const readApiError = async (response: Response, fallback: string) => {
    try {
      const data = await response.json() as { message?: string; error?: string };
      if (data.message) return data.message;
      if (response.status === 404) return "A API ainda não tem a rota de promoções. Publique a API de novo e tente outra vez.";
      return data.error || fallback;
    } catch {
      return `${fallback} (resposta ${response.status})`;
    }
  };

  const load = async () => {
    try {
      const [campaignRes, productRes] = await Promise.all([
        fetch(`${BASE}/api/admin/flash-campaigns`, { headers: authHeaders() }),
        fetch(`${BASE}/api/admin/products`, { headers: authHeaders() }),
      ]);
      if (!campaignRes.ok) {
        setErrorText(await readApiError(campaignRes, "Não foi possível carregar as promoções."));
        return;
      }
      const data = await campaignRes.json() as { campaigns?: Campaign[] };
      setCampaigns(data.campaigns || []);
      setErrorText("");
      if (productRes.ok) {
        const productData = await productRes.json() as { products?: CatalogProduct[] };
        setProducts(productData.products || []);
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Não foi possível carregar as promoções.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (text.length < 2) return [];
    return products
      .filter((product) => product.name.toLowerCase().includes(text) && !items.some((item) => item.productId === product.id))
      .slice(0, 8);
  }, [products, query, items]);

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm);
    setItems([]);
    setQuery("");
  };

  const edit = (campaign: Campaign) => {
    setEditingId(campaign.id);
    setForm({
      name: campaign.name,
      slotLimit: String(campaign.slotLimit),
      drawPercent: String(campaign.drawPercent),
      activeFromHour: campaign.activeFromHour == null ? "" : String(campaign.activeFromHour),
      activeUntilHour: campaign.activeUntilHour == null ? "" : String(campaign.activeUntilHour),
      isActive: campaign.isActive,
    });
    setItems(campaign.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      image: item.image,
      regularPrice: item.regularPrice || 0,
      flashPrice: String(item.flashPrice),
    })));
  };

  const save = async () => {
    const payload = {
      name: form.name,
      slotLimit: Number(form.slotLimit),
      drawPercent: Number(form.drawPercent),
      activeFromHour: form.activeFromHour === "" ? null : Number(form.activeFromHour),
      activeUntilHour: form.activeUntilHour === "" ? null : Number(form.activeUntilHour),
      isActive: form.isActive,
      items: items.map((item) => ({ productId: item.productId, flashPrice: Number(item.flashPrice.replace(",", ".")) })),
    };
    if (payload.items.length === 0 || payload.items.some((item) => !(item.flashPrice > 0))) {
      toast.error("Informe o preço relâmpago de cada produto.");
      return;
    }
    setSaving(true);
    setErrorText("");
    try {
      const response = await fetch(`${BASE}/api/admin/flash-campaigns${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const message = await readApiError(response, "Não foi possível salvar.");
        setErrorText(message);
        toast.error(message);
        return;
      }
      toast.success(editingId ? "Promoção atualizada." : "Promoção criada.");
      reset();
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar.";
      setErrorText(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Apagar esta promoção?")) return;
    const response = await fetch(`${BASE}/api/admin/flash-campaigns/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!response.ok) {
      toast.error("Não foi possível apagar.");
      return;
    }
    if (editingId === id) reset();
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Promoções relâmpago</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          O cliente pode ver a oferta uma vez enquanto navega. Se aceitar, o preço fica reservado por 1 hora no PIX e no WhatsApp. Quem não paga devolve a vaga. Cartão continua no preço normal, e cupom não entra nessa oferta.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-white p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Nome
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 h-11 w-full rounded-xl border-2 border-border px-3" />
          </label>
          <label className="text-sm font-medium">
            Vagas ao mesmo tempo
            <input value={form.slotLimit} onChange={(event) => setForm({ ...form, slotLimit: event.target.value })} inputMode="numeric" className="mt-1 h-11 w-full rounded-xl border-2 border-border px-3" />
          </label>
          <label className="text-sm font-medium">
            Chance de aparecer (%)
            <input value={form.drawPercent} onChange={(event) => setForm({ ...form, drawPercent: event.target.value })} inputMode="numeric" className="mt-1 h-11 w-full rounded-xl border-2 border-border px-3" />
          </label>
          <label className="flex items-end gap-2 text-sm font-medium">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            Campanha ligada
          </label>
          <label className="text-sm font-medium">
            A partir da hora (vazio = o dia todo)
            <input value={form.activeFromHour} onChange={(event) => setForm({ ...form, activeFromHour: event.target.value })} placeholder="18" inputMode="numeric" className="mt-1 h-11 w-full rounded-xl border-2 border-border px-3" />
          </label>
          <label className="text-sm font-medium">
            Até a hora (vazio = fim do dia)
            <input value={form.activeUntilHour} onChange={(event) => setForm({ ...form, activeUntilHour: event.target.value })} placeholder="23" inputMode="numeric" className="mt-1 h-11 w-full rounded-xl border-2 border-border px-3" />
          </label>
        </div>

        <div>
          <label className="text-sm font-medium">
            Produto
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite o nome" className="mt-1 h-11 w-full rounded-xl border-2 border-border px-3" />
          </label>
          {matches.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-xl border border-border">
              {matches.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    setItems((current) => [...current, {
                      productId: product.id,
                      name: product.name,
                      image: product.image || null,
                      regularPrice: product.price,
                      flashPrice: "",
                    }]);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
                >
                  {product.image && <img src={product.image} alt="" className="h-10 w-10 rounded-lg object-cover" />}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</span>
                  <span className="text-sm text-muted-foreground">{money(product.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.productId} className="flex items-center gap-3 rounded-xl border border-border p-2">
              {item.image && <img src={item.image} alt="" className="h-12 w-12 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                <p className="text-xs text-muted-foreground">Preço da loja {money(item.regularPrice)}</p>
              </div>
              <input
                value={item.flashPrice}
                onChange={(event) => setItems((current) => current.map((entry) => entry.productId === item.productId ? { ...entry, flashPrice: event.target.value } : entry))}
                placeholder="Preço"
                inputMode="decimal"
                className="h-10 w-28 rounded-lg border-2 border-border px-2 text-sm"
              />
              <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.productId !== item.productId))} className="text-sm text-red-600">Tirar</button>
            </div>
          ))}
        </div>

        {errorText && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{errorText}</p>
        )}

        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={() => void save()} className="h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60">
            {saving ? "Salvando..." : editingId ? "Atualizar promoção" : "Criar promoção"}
          </button>
          {editingId && <button type="button" onClick={reset} className="h-11 rounded-xl border border-border px-4 text-sm font-semibold">Cancelar edição</button>}
        </div>
      </div>

      <div className="space-y-3">
        {campaigns.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma promoção cadastrada.</p>}
        {campaigns.map((campaign) => (
          <div key={campaign.id} className="rounded-2xl border border-border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold">{campaign.name}</p>
                <p className="text-sm text-muted-foreground">
                  {campaign.isActive ? "Ligada" : "Desligada"} · {campaign.slotLimit} vagas · {campaign.drawPercent}% de chance
                  {campaign.activeFromHour != null ? ` · a partir das ${campaign.activeFromHour}h` : " · o dia todo"}
                </p>
                <p className="text-xs text-muted-foreground">Viram a oferta: {campaign.seenCount} · Reservadas agora: {campaign.activeReservations} · Viraram pedido: {campaign.usedReservations}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => edit(campaign)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold">Editar</button>
                <button type="button" onClick={() => void remove(campaign.id)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600">Apagar</button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {campaign.items.map((item) => (
                <div key={item.productId} className="flex items-center gap-3 text-sm">
                  {item.image && <img src={item.image} alt="" className="h-8 w-8 rounded-md object-cover" />}
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="font-semibold text-orange-600">{money(item.flashPrice)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
