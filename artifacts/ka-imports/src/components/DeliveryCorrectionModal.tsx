/* global navigator */
import { Copy, ExternalLink, MessageCircle, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

export type DeliveryCorrectionNotice = {
  fields: Array<"cpf" | "cep" | "endereco">;
  fieldLabel: string;
  message: string;
  link: string;
  whatsappSent: boolean;
  whatsappError: string | null;
};

function whatsappHref(phone: string, message: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  const withCountry = digits.startsWith("55") && digits.length >= 12 ? digits : digits ? `55${digits.replace(/^0+/, "")}` : "";
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

export function DeliveryCorrectionModal({
  notice,
  phone,
  busy,
  onClose,
  onResend,
}: {
  notice: DeliveryCorrectionNotice;
  phone: string;
  busy?: boolean;
  onClose: () => void;
  onResend: () => void;
}) {
  const status = notice.whatsappSent
    ? "Mensagem enviada ao cliente pelo WhatsApp"
    : notice.whatsappError || "Mensagem ainda não enviada.";

  return (
    <div className="fixed inset-0 z-[140] bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-white shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-foreground">Corrigir dados da entrega</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Campo com erro: {notice.fieldLabel}</p>
          </div>
          <button type="button" className="p-1.5 rounded-lg hover:bg-muted" onClick={onClose} aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className={`rounded-xl border px-3 py-2 text-sm leading-relaxed ${notice.whatsappSent ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            {status}
          </p>
          <p className="rounded-xl border border-border bg-slate-50 px-3 py-3 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
            {notice.message}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onResend}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
              Reenviar
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(notice.message).then(
                  () => toast.success("Mensagem copiada."),
                  () => toast.error("Não foi possível copiar."),
                );
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold"
            >
              <Copy className="w-4 h-4" />
              Copiar
            </button>
            <a
              href={whatsappHref(phone, notice.message)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold"
            >
              <MessageCircle className="w-4 h-4" />
              Abrir no WhatsApp
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
