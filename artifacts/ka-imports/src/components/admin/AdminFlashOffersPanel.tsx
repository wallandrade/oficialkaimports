import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  promoPrice?: number | null;
  promoEndsAt?: string | null;
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
  showAfterSeconds: number;
  repeatAfterHours: number;
  activeFromHour: number | null;
  activeUntilHour: number | null;
  items: Array<{ productId: string; name: string; image: string | null; regularPrice: number | null; flashPrice: number; alwaysShow?: boolean }>;
  activeReservations: number;
  usedReservations: number;
  seenCount: number;
  reservations?: Array<{
    id: string;
    name: string;
    productName: string;
    unitPrice: number;
    status: string;
    statusLabel: string;
    expiresAt: string;
    orderId: string | null;
    orderNumber: number | null;
  }>;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function promoStillOn(product: CatalogProduct): boolean {
  if (product.promoPrice == null || !(product.promoPrice < product.price)) return false;
  if (!product.promoEndsAt) return true;
  return new Date() < new Date(product.promoEndsAt);
}

function money(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function remainingLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "";
  const minutes = Math.ceil(ms / 60000);
  return minutes <= 1 ? " · falta menos de 1 min" : ` · faltam ${minutes} min`;
}

function reservationTone(status: string): string {
  if (status === "waiting_checkout" || status === "waiting_payment") return "text-orange-700 bg-orange-50";
  if (status === "paid") return "text-green-700 bg-green-50";
  return "text-neutral-500 bg-neutral-100";
}

const emptyForm = {
  name: "Promoção relâmpago",
  slotLimit: "5",
  drawPercent: "25",
  showAfterSeconds: "8",
  repeatAfterHours: "0",
  activeFromHour: "",
  activeUntilHour: "",
  isActive: true,
};

export function AdminFlashOffersPanel({ isPrimary = false }: { isPrimary?: boolean }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [forceFirstVisit, setForceFirstVisit] = useState(false);
  const [savingForce, setSavingForce] = useState(false);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openVisitors, setOpenVisitors] = useState<Record<string, boolean>>({});
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
    const headers = authHeaders();
    try {
      const [campaignRes, productRes] = await Promise.all([
        fetch(`${BASE}/api/admin/flash-campaigns`, { headers }),
        fetch(`${BASE}/api/admin/products`, { headers }),
      ]);
      const notes: string[] = [];
      if (productRes.ok) {
        const productData = await productRes.json() as { products?: CatalogProduct[] };
        setProducts(productData.products || []);
      } else {
        notes.push(await readApiError(productRes, "Não foi possível carregar os produtos."));
      }
      if (campaignRes.ok) {
        const data = await campaignRes.json() as { campaigns?: Campaign[]; forceFirstVisit?: boolean };
        setCampaigns(data.campaigns || []);
        setForceFirstVisit(data.forceFirstVisit === true);
      } else {
        notes.push(await readApiError(campaignRes, "Não foi possível carregar as promoções."));
      }
      setErrorText(notes.join(" "));
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Não foi possível carregar as promoções.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return [];
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
      showAfterSeconds: String(campaign.showAfterSeconds ?? 8),
      repeatAfterHours: String(campaign.repeatAfterHours ?? 0),
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
      showAfterSeconds: Number(form.showAfterSeconds),
      repeatAfterHours: Number(form.repeatAfterHours),
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

  const toggleAlways = async (campaignId: string, productId: string, alwaysShow: boolean) => {
    const response = await fetch(`${BASE}/api/admin/flash-campaigns/${campaignId}/items/${productId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ alwaysShow }),
    });
    const data = await response.json().catch(() => ({})) as { message?: string; alwaysShow?: boolean };
    if (!response.ok) {
      toast.error(data.message || "Não foi possível atualizar o produto.");
      return;
    }
    setCampaigns((current) => current.map((campaign) => campaign.id === campaignId ? {
      ...campaign,
      items: campaign.items.map((item) => item.productId === productId ? { ...item, alwaysShow: data.alwaysShow === true } : item),
    } : campaign));
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

  const toggleForceFirstVisit = async () => {
    if (!isPrimary || savingForce) return;
    const next = !forceFirstVisit;
    setSavingForce(true);
    try {
      const response = await fetch(`${BASE}/api/admin/settings/flash_force_first_visit`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ value: next ? "1" : "0" }),
      });
      if (!response.ok) {
        toast.error(await readApiError(response, "Não foi possível salvar."));
        return;
      }
      setForceFirstVisit(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSavingForce(false);
    }
  };

  return (
    <div className="space-y-6">
      {isPrimary && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-white p-4">
          <div>
            <p className="font-bold">Mostrar na primeira visita</p>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {forceFirstVisit
                ? "Ligado: ignora chance, horário, vaga e repetição. Cada cliente vê as campanhas ligadas uma vez, na primeira entrada."
                : "Desligado: cada promoção segue a própria chance, horário, vaga e repetição."}
            </p>
          </div>
          <button
            type="button"
            disabled={savingForce}
            onClick={() => void toggleForceFirstVisit()}
            className={`h-9 shrink-0 rounded-lg px-4 text-sm font-bold text-white disabled:opacity-60 ${forceFirstVisit ? "bg-green-600" : "bg-neutral-400"}`}
          >
            {forceFirstVisit ? "Ligado" : "Desligado"}
          </button>
        </div>
      )}
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
          <label className="text-sm font-medium">
            Aparece depois de (segundos)
            <input value={form.showAfterSeconds} onChange={(event) => setForm({ ...form, showAfterSeconds: event.target.value })} inputMode="numeric" className="mt-1 h-11 w-full rounded-xl border-2 border-border px-3" />
          </label>
          <label className="text-sm font-medium">
            Mostrar de novo depois de (horas)
            <input value={form.repeatAfterHours} onChange={(event) => setForm({ ...form, repeatAfterHours: event.target.value })} inputMode="numeric" placeholder="0 = não mostra de novo" className="mt-1 h-11 w-full rounded-xl border-2 border-border px-3" />
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

        <div className="relative">
          <label className="text-sm font-medium">
            Produto
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite o nome do produto" className="mt-1 h-11 w-full rounded-xl border-2 border-border px-3" />
          </label>
          {query.trim() && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-white shadow-lg">
              {matches.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum produto encontrado</p>
              ) : matches.map((product) => {
                const onPromo = promoStillOn(product);
                return (
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
                    className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-muted"
                  >
                    {product.image ? (
                      <img src={product.image} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-border object-cover" />
                    ) : (
                      <div className="h-10 w-10 shrink-0 rounded-lg border border-border bg-muted" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{product.name}</span>
                      <span className="mt-0.5 block text-xs">
                        {onPromo ? (
                          <>
                            <span className="text-muted-foreground line-through">{money(product.price)}</span>{" "}
                            <span className="font-semibold text-amber-600">{money(product.promoPrice || 0)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{money(product.price)}</span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
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
                  {campaign.isActive ? "Ligada" : "Desligada"} · {campaign.slotLimit} vagas · {campaign.drawPercent}% de chance · depois de {campaign.showAfterSeconds ?? 8}s
                  {(campaign.repeatAfterHours ?? 0) > 0 ? ` · de novo em ${campaign.repeatAfterHours}h` : " · não repete"}
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
                  <button
                    type="button"
                    onClick={() => void toggleAlways(campaign.id, item.productId, item.alwaysShow !== true)}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${item.alwaysShow ? "bg-green-600 text-white" : "bg-neutral-200 text-neutral-700"}`}
                  >
                    {item.alwaysShow ? "Desabilitar" : "Habilitar"}
                  </button>
                </div>
              ))}
            </div>
            {(campaign.reservations || []).length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setOpenVisitors((current) => ({ ...current, [campaign.id]: !current[campaign.id] }))}
                  className="text-sm font-semibold text-amber-700"
                >
                  {openVisitors[campaign.id] ? "▾" : "▸"} Ver visitantes ({campaign.reservations?.length || 0})
                </button>
                {openVisitors[campaign.id] && (
                  <div className="mt-3 space-y-2">
                    {(campaign.reservations || []).map((row) => (
                      <div key={row.id} className="flex items-center gap-3 text-sm">
                        <span className="w-36 shrink-0 truncate font-medium" title={row.name}>{row.name}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.productName}</span>
                        <span className="shrink-0 font-semibold text-orange-600">{money(row.unitPrice)}</span>
                        {row.orderNumber != null && <span className="shrink-0 text-muted-foreground">#{row.orderNumber}</span>}
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${reservationTone(row.status)}`}>
                          {row.statusLabel}{row.status === "waiting_checkout" ? remainingLabel(row.expiresAt) : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
