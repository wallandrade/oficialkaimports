import { Fragment, useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShippingStatusTimeline } from "@/components/ShippingStatusTimeline";
import { formatDateBR } from "@/lib/utils";
import { lossBlacklistRowView } from "@/components/admin/loss-blacklist-row";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

type LossEvent = {
  status?: string | null;
  description?: string | null;
  location?: string | null;
  at?: string | null;
};

const MANUAL_CARRIERS = [
  "Correios Sedex",
  "Correios Pac",
  "Correios Mini Envios",
  "J&T Express envioEcom",
  "Jadlog envioEcom",
  "Ponto Loggi envioEcom",
  "BUSLOG envioEcom",
];

const INCIDENT_TYPES = [
  { value: "manual", label: "Manual" },
  { value: "extravio", label: "Extravio" },
  { value: "roubo", label: "Roubo" },
  { value: "furto", label: "Furto" },
  { value: "sinistro", label: "Sinistro" },
];

export type LossBlacklistItem = {
  id: string;
  origin?: "store" | "peer" | null;
  orderId?: string | null;
  legacy?: boolean | null;
  orderLabel?: string | null;
  packageId?: string | null;
  orderNumber?: number | null;
  clientName?: string | null;
  carrierName?: string | null;
  cityName?: string | null;
  neighborhoodName?: string | null;
  state?: string | null;
  cep?: string | null;
  incidentType?: string | null;
  source?: string | null;
  rawStatus?: string | null;
  occurredAt?: string | null;
  removedAt?: string | null;
  envioecomStatus?: string | null;
  envioecomBarcode?: string | null;
  events?: LossEvent[];
};

const TYPE_LABEL: Record<string, string> = {
  extravio: "Extravio",
  roubo: "Roubo",
  furto: "Furto",
  sinistro: "Sinistro",
  manual: "Manual",
};

function placeLabel(item: LossBlacklistItem): string {
  const city = [item.cityName, item.state].filter(Boolean).join("/");
  const neighborhood = String(item.neighborhoodName || "").trim();
  return [neighborhood, city].filter(Boolean).join(" · ") || "—";
}

function typeLabel(value: string | null | undefined): string {
  const key = String(value || "").trim().toLowerCase();
  return TYPE_LABEL[key] || (key ? key : "—");
}

export function LossBlacklistBoard({
  onOpenOrder,
}: {
  onOpenOrder?: (item: LossBlacklistItem) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [items, setItems] = useState<LossBlacklistItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [peer, setPeer] = useState<{ enabled: boolean; ok: boolean }>({ enabled: false, ok: false });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: debouncedQ });
        if (includeRemoved) params.set("includeRemoved", "1");
        const res = await fetch(`${BASE}/api/admin/envioecom/loss-blacklist?${params}`, { headers: adminHeaders() });
        if (!res.ok) throw new Error("Falha ao carregar a lista negra.");
        const data = await res.json() as {
          items?: LossBlacklistItem[];
          truncated?: boolean;
          peer?: { enabled?: boolean; ok?: boolean };
        };
        if (cancelled) return;
        setItems(data.items || []);
        setTruncated(!!data.truncated);
        setPeer({ enabled: !!data.peer?.enabled, ok: !!data.peer?.ok });
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Erro ao carregar a lista negra.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, includeRemoved, reloadKey]);

  async function removeFromList(item: LossBlacklistItem) {
    if (!window.confirm("Tirar da lista negra de extravio?")) return;
    setRemovingId(item.id);
    try {
      const params = new URLSearchParams();
      if (item.packageId) params.set("packageId", item.packageId);
      const query = params.toString();
      const legacy = lossBlacklistRowView(item).legacy;
      const res = await fetch(
        legacy
          ? `${BASE}/api/admin/envioecom/loss-blacklist/${item.id}`
          : `${BASE}/api/admin/envioecom/orders/${item.orderId}/loss-blacklist${query ? `?${query}` : ""}`,
        { method: "DELETE", headers: adminHeaders() },
      );
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Falha ao tirar da lista.");
      toast.success("Envio retirado da lista negra.");
      setItems((prev) => (includeRemoved
        ? prev.map((row) => (row.id === item.id ? { ...row, removedAt: new Date().toISOString() } : row))
        : prev.filter((row) => row.id !== item.id)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao tirar da lista.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Buscar pedido, cliente, cidade ou transportadora"
          className="h-11 min-w-[16rem] flex-1 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
        />
        <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={includeRemoved}
            onChange={(event) => setIncludeRemoved(event.target.checked)}
            className="h-4 w-4"
          />
          Mostrar retirados
        </label>
      </div>
      {truncated ? (
        <p className="text-xs text-amber-800">Mostrando os 500 mais recentes.</p>
      ) : null}
      {peer.enabled && !peer.ok ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          A lista da outra loja não respondeu. Mostrando só a nossa.
        </p>
      ) : null}
      <LegacyLossForm onCreated={() => setReloadKey((value) => value + 1)} />
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando lista negra…
        </div>
      ) : (
        <div className="space-y-6">
          <LossBlock
            title="Esta loja"
            hint="Extravios gravados aqui, inclusive pedido antigo sem cadastro. Dá para tirar da lista."
            items={items.filter((item) => item.origin !== "peer")}
            expandedId={expandedId}
            removingId={removingId}
            onToggle={setExpandedId}
            onOpenOrder={onOpenOrder}
            onRemove={(item) => void removeFromList(item)}
          />
          {peer.enabled && peer.ok ? (
            <LossBlock
              title="Outra loja"
              hint="Casos lidos da outra loja. Tirar da lista só vale lá."
              items={items.filter((item) => item.origin === "peer")}
              expandedId={expandedId}
              removingId={removingId}
              onToggle={setExpandedId}
              onOpenOrder={onOpenOrder}
              onRemove={(item) => void removeFromList(item)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function LossBlock({
  title,
  hint,
  items,
  expandedId,
  removingId,
  onToggle,
  onOpenOrder,
  onRemove,
}: {
  title: string;
  hint: string;
  items: LossBlacklistItem[];
  expandedId: string | null;
  removingId: string | null;
  onToggle: (next: string | null) => void;
  onOpenOrder?: (item: LossBlacklistItem) => void;
  onRemove: (item: LossBlacklistItem) => void;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum envio nesta lista.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Pedido</th>
                <th className="px-3 py-2 font-semibold">Cliente</th>
                <th className="px-3 py-2 font-semibold">Transportadora</th>
                <th className="px-3 py-2 font-semibold">Cidade</th>
                <th className="px-3 py-2 font-semibold">Origem</th>
                <th className="px-3 py-2 font-semibold">Tipo</th>
                <th className="px-3 py-2 font-semibold">Data</th>
                <th className="px-3 py-2 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const peerRow = item.origin === "peer";
                const view = lossBlacklistRowView(item);
                const open = expandedId === item.id;
                const removed = !!item.removedAt;
                return (
                  <Fragment key={item.id}>
                    <tr
                      className="border-t border-border/70 cursor-pointer hover:bg-muted/40"
                      onClick={() => onToggle(open ? null : item.id)}
                    >
                      <td className="px-3 py-2 align-top">
                        {peerRow || !view.opensOrder ? (
                          <span className="font-semibold text-foreground">
                            {peerRow ? "Outra loja" : `#${view.label}`}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="font-semibold text-primary hover:underline"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenOrder?.(item);
                            }}
                          >
                            #{view.label}
                          </button>
                        )}
                        {view.legacy ? (
                          <p className="text-xs text-muted-foreground">Pedido antigo</p>
                        ) : null}
                        {!peerRow && item.packageId ? (
                          <p className="text-xs text-muted-foreground">Pacote</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top">{item.clientName || "—"}</td>
                      <td className="px-3 py-2 align-top">
                        <p>{item.carrierName || "—"}</p>
                        <p className="font-mono text-xs text-muted-foreground">{item.envioecomBarcode || ""}</p>
                      </td>
                      <td className="px-3 py-2 align-top">{placeLabel(item)}</td>
                      <td className="px-3 py-2 align-top">
                        {peerRow ? "Outra loja" : (item.source === "manual" ? "KA · Manual" : "KA · Rastreio")}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <p>{typeLabel(item.incidentType)}</p>
                        {item.envioecomStatus ? (
                          <p className="text-xs text-muted-foreground">{item.envioecomStatus}</p>
                        ) : null}
                        {removed ? (
                          <p className="text-xs font-semibold text-amber-800">Retirado</p>
                        ) : null}
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700">
                          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {peerRow
                            ? (open ? "Ocultar" : "Ver detalhe")
                            : (open ? "Ocultar rastreio" : "Ver caminho do envio")}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">
                        {item.occurredAt ? formatDateBR(item.occurredAt) : "—"}
                      </td>
                      <td className="px-3 py-2 align-top" onClick={(event) => event.stopPropagation()}>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {!peerRow && !removed ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-rose-800 border-rose-200 hover:bg-rose-50"
                              disabled={removingId === item.id}
                              onClick={() => onRemove(item)}
                            >
                              {removingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Tirar da lista negra"}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="border-t border-border/40 bg-muted/20">
                        <td colSpan={8} className="px-4 py-3">
                          {peerRow ? (
                            <p className="text-sm text-foreground">Caso da outra loja. Dá para tirar só na lista de lá.</p>
                          ) : (
                            <>
                              {view.legacy ? (
                                <p className="mb-2 text-sm text-foreground">
                                  Pedido antigo, sem cadastro nesta loja.
                                  {item.cep ? ` CEP ${item.cep}.` : ""}
                                </p>
                              ) : null}
                              {item.rawStatus ? (
                                <p className="mb-3 text-xs text-muted-foreground">Registro: {item.rawStatus}</p>
                              ) : null}
                              <ShippingStatusTimeline
                                events={item.events || []}
                                title="Caminho na EnvioEcom"
                                emptyText={view.legacy ? "Sem rastreio. Este caso não tem pedido no sistema." : "Sem histórico EnvioEcom neste envio."}
                              />
                            </>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LegacyLossForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [cep, setCep] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [incidentType, setIncidentType] = useState("manual");
  const [rawStatus, setRawStatus] = useState("");
  const [occurredAt, setOccurredAt] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, string> = {
        carrier,
        city: city.trim(),
        state: state.trim().toUpperCase(),
        cep: cep.replace(/\D/g, ""),
        incidentType,
      };
      if (neighborhood.trim()) body.neighborhood = neighborhood.trim();
      if (orderNumber.trim()) body.orderNumber = orderNumber.trim();
      if (rawStatus.trim()) body.rawStatus = rawStatus.trim();
      if (occurredAt) {
        const parsed = new Date(occurredAt);
        if (Number.isNaN(parsed.getTime())) throw new Error("Data do caso inválida.");
        body.occurredAt = parsed.toISOString();
      }
      const res = await fetch(`${BASE}/api/admin/envioecom/loss-blacklist`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Falha ao gravar o caso antigo.");
      toast.success("Caso antigo gravado na lista negra.");
      setCarrier("");
      setCity("");
      setState("");
      setNeighborhood("");
      setCep("");
      setOrderNumber("");
      setIncidentType("manual");
      setRawStatus("");
      setOccurredAt("");
      setOpen(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gravar o caso antigo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold"
        onClick={() => setOpen((value) => !value)}
      >
        Caso antigo sem pedido
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open ? (
        <form onSubmit={(event) => void submit(event)} className="grid gap-3 border-t border-border px-3 py-3 sm:grid-cols-2">
          <p className="sm:col-span-2 text-sm text-muted-foreground">
            Para extravio de antes, quando o pedido não existe nesta loja. O mesmo número, CEP e transportadora atualiza a linha em vez de criar outra.
          </p>
          <label className="text-sm font-medium">
            Transportadora
            <select
              required
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border-2 border-border bg-white px-3 text-sm outline-none focus:border-primary"
            >
              <option value="">Escolha</option>
              {MANUAL_CARRIERS.map((option) => (
                <option key={option} value={option}>{option.replace(/\s+envioEcom$/i, "")}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Tipo
            <select
              value={incidentType}
              onChange={(event) => setIncidentType(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border-2 border-border bg-white px-3 text-sm outline-none focus:border-primary"
            >
              {INCIDENT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Cidade
            <input
              required
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border-2 border-border bg-white px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="text-sm font-medium">
            UF
            <input
              required
              maxLength={2}
              value={state}
              onChange={(event) => setState(event.target.value.toUpperCase())}
              className="mt-1 h-11 w-full rounded-xl border-2 border-border bg-white px-3 text-sm uppercase outline-none focus:border-primary"
            />
          </label>
          <label className="text-sm font-medium">
            Bairro
            <input
              value={neighborhood}
              onChange={(event) => setNeighborhood(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border-2 border-border bg-white px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="text-sm font-medium">
            CEP
            <input
              required
              inputMode="numeric"
              value={cep}
              onChange={(event) => setCep(event.target.value)}
              placeholder="00000000"
              className="mt-1 h-11 w-full rounded-xl border-2 border-border bg-white px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="text-sm font-medium">
            Número antigo
            <input
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              inputMode="numeric"
              className="mt-1 h-11 w-full rounded-xl border-2 border-border bg-white px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="text-sm font-medium">
            Data
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border-2 border-border bg-white px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="sm:col-span-2 text-sm font-medium">
            Observação
            <input
              value={rawStatus}
              onChange={(event) => setRawStatus(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border-2 border-border bg-white px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Gravar caso antigo"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
