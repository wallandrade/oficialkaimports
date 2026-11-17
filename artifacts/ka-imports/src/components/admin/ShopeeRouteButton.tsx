import { useState } from "react";
import { Loader2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function ShopeeRouteButton({
  orderId,
  packageId,
  items,
  sentAt,
  onSent,
}: {
  orderId: string;
  packageId?: string | null;
  items: Array<{ quantity?: number; name?: string }>;
  sentAt?: string | null;
  onSent: (sentAt: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const lines = items
    .map((item) => {
      const qty = Math.trunc(Number(item.quantity) || 0);
      const name = String(item.name || "").trim();
      if (qty <= 0 || !name) return "";
      return `${qty}x ${name}`;
    })
    .filter(Boolean);
  const alreadySent = Boolean(String(sentAt || "").trim());

  async function send() {
    if (!lines.length) {
      toast.error("Não há produto neste envio para avisar o cliente.");
      return;
    }
    const list = lines.join("\n");
    const question = alreadySent
      ? `Este aviso já foi enviado. Mandar de novo só com:\n${list}`
      : `O cliente recebe no WhatsApp só estes produtos:\n${list}`;
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${encodeURIComponent(orderId)}/shopee-route`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ packageId, confirm: true }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string; shopeeRouteSentAt?: string };
      if (!res.ok) throw new Error(data.message || "Não foi possível avisar o cliente.");
      const next = String(data.shopeeRouteSentAt || new Date().toISOString());
      onSent(next);
      toast.success("Cliente avisado só dos produtos deste pacote.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível avisar o cliente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      title={alreadySent ? "Rota Shopee já avisou este envio" : "Avisar o cliente pela Rota Shopee"}
      disabled={busy}
      onClick={() => { void send(); }}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-orange-400 bg-white text-xs font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingBag className="w-3.5 h-3.5" />}
      Rota Shopee
    </button>
  );
}
