import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

export function ManualTrackingButton({
  orderId,
  packageId,
  trackingCode,
  onSaved,
}: {
  orderId: string;
  packageId?: string | null;
  trackingCode?: string | null;
  onSaved: (order: { id: string; enviado?: boolean }) => void;
}) {
  const current = String(trackingCode || "").trim();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);

  async function save(nextCode: string) {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${orderId}/manual-tracking`, {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({
          trackingCode: nextCode,
          ...(packageId ? { packageId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string; order?: { id: string; enviado?: boolean } };
      if (!res.ok) throw new Error(data?.message || "Não foi possível salvar o rastreio manual.");
      if (data.order) onSaved(data.order);
      toast.success(String(nextCode || "").trim() ? "Rastreio manual salvo." : "Rastreio manual apagado.");
      setOpen(false);
      setDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o rastreio manual.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5 text-sky-800 border-sky-200 hover:bg-sky-50"
        disabled={busy}
        onClick={() => {
          setDraft(current);
          setOpen((value) => !value);
        }}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Rastreio manual
      </Button>
      {current && !open ? (
        <p className="text-[11px] font-mono text-sky-900">Código: {current}</p>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            placeholder="AA123456789BR"
            autoComplete="off"
            className="h-8 w-44 rounded-lg border border-border px-2 text-xs font-mono uppercase"
          />
          <Button type="button" size="sm" className="h-8" disabled={busy} onClick={() => { void save(draft); }}>
            Salvar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy || !current}
            onClick={() => { void save(""); }}
          >
            Limpar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
