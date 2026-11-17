import { useEffect, useState } from "react";
import { Loader2, ShoppingBag, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const DEFAULT_SHOPEE_ROUTE_MESSAGE =
  "Seguimos com o seu pedido e vimos que a rota de envio com menos risco, mais rápida e mais segura, é pela Shopee. Pedimos que você faça a compra deste produto nela para darmos sequência ao seu pedido: {link_shopee}. Quando finalizar a compra, mande aqui o ID da compra para embalarmos o seu pedido. Seu pedido real: {resumo_pedido}. O valor pago na Shopee será devolvido como saldo na sua carteira do nosso site, para usar na próxima compra.";

const REVIEW_LABELS: Record<string, string> = {
  id_invalido: "ID inválido",
  id_ambiguo: "ID ambíguo",
  varios_pedidos: "Vários pedidos",
};

type ShopeeOrderFields = {
  id: string;
  clientName?: string | null;
  total?: number | null;
  paidAmount?: number | null;
  shopeeRouteRequestedAt?: string | null;
  shopeeOrderId?: string | null;
  shopeeRouteReviewReason?: string | null;
  shopeeWalletCreditedAt?: string | null;
};

type ShopeePatch = {
  shopeeRouteRequestedAt?: string | null;
  shopeeOrderId?: string | null;
  shopeeRouteReviewReason?: string | null;
  shopeeWalletCreditedAt?: string | null;
  enviado?: boolean;
};

function adminHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readBody(res: Response): Promise<{ message?: string; error?: string; order?: ShopeePatch; already?: boolean; queued?: boolean }> {
  return res.json().catch(() => ({}));
}

function formatRouteDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export function ShopeeRouteSettingsCard({
  settings,
  loading,
  onSave,
  onDelete,
}: {
  settings: Record<string, string>;
  loading: Record<string, boolean>;
  onSave: (key: string, value: string) => void;
  onDelete: (key: string) => void;
}) {
  const [link, setLink] = useState("");
  const [message, setMessage] = useState(DEFAULT_SHOPEE_ROUTE_MESSAGE);

  useEffect(() => {
    setLink(settings.shopee_route_product_url || "");
    setMessage(settings.shopee_route_message || DEFAULT_SHOPEE_ROUTE_MESSAGE);
  }, [settings.shopee_route_product_url, settings.shopee_route_message]);

  function saveLink() {
    const value = link.trim();
    if (!value) {
      onDelete("shopee_route_product_url");
      return;
    }
    onSave("shopee_route_product_url", value);
  }

  function saveMessage() {
    const value = message.trim();
    if (!value) {
      onDelete("shopee_route_message");
      return;
    }
    onSave("shopee_route_message", value);
  }

  return (
    <div className="max-w-3xl bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-primary" />
          Rota Shopee
        </h2>
        <p className="text-muted-foreground text-sm">
          O botão no pedido manda o cliente comprar este link. A mensagem aceita {"{nome}"}, {"{pedido}"}, {"{resumo_pedido}"}, {"{link_shopee}"} e {"{valor}"}. Em branco, volta o texto padrão. A URL e o segredo do n8n ficam no servidor.
        </p>
      </div>
      <label className="block">
        <span className="block text-xs font-medium mb-1">Link do produto na Shopee</span>
        <span className="flex gap-2">
          <input
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://"
            className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
          />
          <Button size="sm" onClick={saveLink} disabled={!!loading.shopee_route_product_url}>
            Salvar
          </Button>
        </span>
      </label>
      <label className="block">
        <span className="block text-xs font-medium mb-1">Mensagem para o cliente</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={7}
          className="w-full px-3 py-2 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
        />
        <span className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" type="button" onClick={() => setMessage(DEFAULT_SHOPEE_ROUTE_MESSAGE)}>
            Texto padrão
          </Button>
          <Button size="sm" onClick={saveMessage} disabled={!!loading.shopee_route_message}>
            Salvar mensagem
          </Button>
        </span>
      </label>
    </div>
  );
}

export function ShopeeRouteBadge({
  requestedAt,
  shopeeOrderId,
  reviewReason,
}: {
  requestedAt?: string | null;
  shopeeOrderId?: string | null;
  reviewReason?: string | null;
}) {
  const id = String(shopeeOrderId || "").trim();
  const review = String(reviewReason || "").trim();
  if (review) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs font-semibold border border-rose-200">
        Revisão Shopee: {REVIEW_LABELS[review] || "Manual"}
      </span>
    );
  }
  if (requestedAt && !id) {
    const when = formatRouteDate(requestedAt);
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-900 text-xs font-semibold border border-orange-300">
        Aguardando ID Shopee{when ? ` · ${when}` : ""}
      </span>
    );
  }
  return null;
}

export function ShopeeRouteOrderControls({
  order,
  canCredit,
  hideSend,
  onPatched,
}: {
  order: ShopeeOrderFields;
  canCredit: boolean;
  hideSend?: boolean;
  onPatched: (patch: ShopeePatch) => void;
}) {
  const [busy, setBusy] = useState<"send" | "id" | "credit" | null>(null);
  const [draftId, setDraftId] = useState(order.shopeeOrderId || "");
  const savedId = String(order.shopeeOrderId || "").trim();
  const showFields = Boolean(order.shopeeRouteRequestedAt || savedId || order.shopeeRouteReviewReason || order.shopeeWalletCreditedAt);

  useEffect(() => {
    setDraftId(order.shopeeOrderId || "");
  }, [order.shopeeOrderId]);

  async function sendRoute() {
    const needsConfirm = Boolean(order.shopeeRouteRequestedAt || savedId);
    if (needsConfirm && !window.confirm("Este pedido já entrou na Rota Shopee. Enviar de novo para o cliente?")) return;
    setBusy("send");
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${order.id}/shopee-route`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ confirm: needsConfirm }),
      });
      const data = await readBody(res);
      if (!res.ok) {
        toast.error(data.message || "Não foi possível enviar a Rota Shopee.");
        return;
      }
      if (data.order) onPatched(data.order);
      toast.success(data.queued
        ? "A Rota Shopee entrou na fila. O cliente recebe no ritmo de 1 mensagem a cada 10 minutos."
        : "Rota Shopee enviada. O pedido está aguardando o ID.");
    } catch {
      toast.error("Não foi possível enviar a Rota Shopee.");
    } finally {
      setBusy(null);
    }
  }

  async function saveId() {
    setBusy("id");
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${order.id}/shopee-order-id`, {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({ shopeeOrderId: draftId.trim() }),
      });
      const data = await readBody(res);
      if (!res.ok) {
        toast.error(data.message || "Não foi possível salvar o ID.");
        return;
      }
      if (data.order) onPatched(data.order);
      toast.success(draftId.trim() ? "ID da Shopee salvo." : "ID da Shopee apagado.");
    } catch {
      toast.error("Não foi possível salvar o ID.");
    } finally {
      setBusy(null);
    }
  }

  async function creditWallet() {
    const total = Number(order.total) || 0;
    const amount = total > 0 ? total : Number(order.paidAmount) || 0;
    if (amount <= 0) {
      toast.error("Este pedido não tem valor para creditar.");
      return;
    }
    const name = String(order.clientName || "o cliente").trim();
    if (!window.confirm(`Lançar ${formatCurrency(amount)} na carteira de ${name}? O crédito entra uma vez neste pedido.`)) return;
    setBusy("credit");
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${order.id}/shopee-wallet-credit`, {
        method: "POST",
        headers: adminHeaders(),
      });
      const data = await readBody(res);
      if (!res.ok) {
        toast.error(data.message || "Não foi possível lançar o crédito.");
        return;
      }
      if (data.order) onPatched(data.order);
      toast.success(data.already ? "Este pedido já tinha o crédito na carteira." : "Crédito lançado na carteira.");
    } catch {
      toast.error("Não foi possível lançar o crédito.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {hideSend ? null : (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-orange-800 border-orange-300 hover:bg-orange-50"
        disabled={busy !== null}
        onClick={() => { void sendRoute(); }}
      >
        {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
        Rota Shopee
      </Button>
      )}
      {showFields ? (
        <div className="w-full flex flex-wrap items-center gap-2 pt-1">
          <label className="text-xs font-semibold text-muted-foreground" htmlFor={`shopee-id-${order.id}`}>ID Shopee</label>
          <input
            id={`shopee-id-${order.id}`}
            value={draftId}
            onChange={(event) => setDraftId(event.target.value)}
            placeholder="Código da compra"
            className="h-8 w-44 px-2 rounded-lg border border-border text-sm"
          />
          <Button size="sm" variant="outline" className="h-8" disabled={busy !== null} onClick={() => { void saveId(); }}>
            {busy === "id" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar ID"}
          </Button>
          {canCredit ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-emerald-800 border-emerald-300 hover:bg-emerald-50"
              disabled={busy !== null || Boolean(order.shopeeWalletCreditedAt)}
              onClick={() => { void creditWallet(); }}
            >
              {busy === "credit" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
              {order.shopeeWalletCreditedAt ? "Crédito lançado" : "Lançar crédito na carteira"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
