import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const FIELDS: Array<{ key: string; label: string; placeholder?: string }> = [
  { key: "n8n_order_paid_webhook_url", label: "Pedido pago", placeholder: "https://" },
  { key: "n8n_order_paid_webhook_url_poly", label: "Pedido pago (segunda instância)", placeholder: "https://" },
  { key: "n8n_filmagem_webhook_url", label: "Filmagem", placeholder: "https://" },
  { key: "n8n_filmagem_webhook_url_poly", label: "Filmagem (segunda instância)", placeholder: "https://" },
  { key: "n8n_tracking_webhook_url", label: "Rastreio", placeholder: "https://" },
  { key: "n8n_tracking_webhook_url_poly", label: "Rastreio (segunda instância)", placeholder: "https://" },
  { key: "n8n_posted_webhook_url", label: "Postado", placeholder: "https://" },
  { key: "n8n_posted_webhook_url_poly", label: "Postado (segunda instância)", placeholder: "https://" },
  { key: "n8n_out_for_delivery_webhook_url", label: "Saiu para entrega", placeholder: "https://" },
  { key: "n8n_out_for_delivery_webhook_url_poly", label: "Saiu para entrega (segunda instância)", placeholder: "https://" },
  { key: "n8n_delivered_webhook_url", label: "Entregue", placeholder: "https://" },
  { key: "n8n_delivered_webhook_url_poly", label: "Entregue (segunda instância)", placeholder: "https://" },
  { key: "n8n_support_webhook_url", label: "Atendimento (texto)", placeholder: "https://" },
  { key: "n8n_support_webhook_url_poly", label: "Atendimento texto (segunda instância)", placeholder: "https://" },
  { key: "n8n_support_menu_webhook_url", label: "Atendimento (lista)", placeholder: "https://" },
  { key: "n8n_support_menu_webhook_url_poly", label: "Atendimento lista (segunda instância)", placeholder: "https://" },
];

export function WhatsappN8nSettings({
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [menuError, setMenuError] = useState("");

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const field of FIELDS) next[field.key] = settings[field.key] ?? "";
    next.n8n_second_instance_seller_slugs = settings.n8n_second_instance_seller_slugs ?? "";
    next.n8n_poly_instance_id = settings.n8n_poly_instance_id ?? "";
    next.n8n_whatsapp_support_token = settings.n8n_whatsapp_support_token ?? "";
    next.n8n_support_attendant_phone = settings.n8n_support_attendant_phone ?? "";
    next.whatsapp_support_menu = settings.whatsapp_support_menu ?? "";
    setDrafts(next);
  }, [settings]);

  function save(key: string, value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      onDelete(key);
      return;
    }
    onSave(key, trimmed);
  }

  function saveInstanceId() {
    const value = String(drafts.n8n_poly_instance_id || "").trim();
    if (value.includes("/token/") || value.includes("http")) {
      setMenuError("O ID da instância é só o ID, sem /token/ e sem URL.");
      return;
    }
    setMenuError("");
    save("n8n_poly_instance_id", value);
  }

  function saveMenu() {
    const value = String(drafts.whatsapp_support_menu || "").trim();
    if (!value) {
      setMenuError("");
      onDelete("whatsapp_support_menu");
      return;
    }
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("lista");
    } catch {
      setMenuError("O menu precisa ser uma lista JSON.");
      return;
    }
    setMenuError("");
    onSave("whatsapp_support_menu", value);
  }

  return (
    <div className="max-w-3xl bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          WhatsApp (n8n)
        </h2>
        <p className="text-muted-foreground text-sm">
          A loja manda telefone e texto para o n8n. Sem URL https, o aviso não sai. A filmagem sem URL não envia. A segunda instância usa a URL com sufixo quando o slug do vendedor está na lista.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className="block text-xs font-medium mb-1">{field.label}</span>
            <span className="flex gap-2">
              <input
                type="url"
                value={drafts[field.key] ?? ""}
                onChange={(event) => setDrafts((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={field.placeholder}
                className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              />
              <Button size="sm" onClick={() => save(field.key, drafts[field.key] || "")} disabled={!!loading[field.key]}>
                Salvar
              </Button>
            </span>
          </label>
        ))}
      </div>

      <label className="block">
        <span className="block text-xs font-medium mb-1">Slugs da segunda instância</span>
        <span className="flex gap-2">
          <input
            value={drafts.n8n_second_instance_seller_slugs ?? ""}
            onChange={(event) => setDrafts((current) => ({ ...current, n8n_second_instance_seller_slugs: event.target.value }))}
            placeholder="poly, 123, bruna"
            className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
          />
          <Button size="sm" onClick={() => save("n8n_second_instance_seller_slugs", drafts.n8n_second_instance_seller_slugs || "")}>
            Salvar
          </Button>
        </span>
      </label>

      <label className="block">
        <span className="block text-xs font-medium mb-1">ID da instância da segunda conta</span>
        <span className="flex gap-2">
          <input
            value={drafts.n8n_poly_instance_id ?? ""}
            onChange={(event) => setDrafts((current) => ({ ...current, n8n_poly_instance_id: event.target.value }))}
            placeholder="só o ID, sem /token/"
            className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
          />
          <Button size="sm" onClick={saveInstanceId}>Salvar</Button>
        </span>
      </label>

      <label className="block">
        <span className="block text-xs font-medium mb-1">Senha do atendimento</span>
        <span className="flex gap-2">
          <input
            type="password"
            value={drafts.n8n_whatsapp_support_token ?? ""}
            onChange={(event) => setDrafts((current) => ({ ...current, n8n_whatsapp_support_token: event.target.value }))}
            placeholder="mínimo 8 caracteres"
            className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
          />
          <Button
            size="sm"
            onClick={() => {
              const value = String(drafts.n8n_whatsapp_support_token || "").trim();
              if (value && value.length < 8) {
                setMenuError("A senha do atendimento precisa de 8 caracteres.");
                return;
              }
              setMenuError("");
              save("n8n_whatsapp_support_token", value);
            }}
          >
            Salvar
          </Button>
        </span>
      </label>

      <label className="block">
        <span className="block text-xs font-medium mb-1">Telefone do atendente (ignorado)</span>
        <span className="flex gap-2">
          <input
            value={drafts.n8n_support_attendant_phone ?? ""}
            onChange={(event) => setDrafts((current) => ({ ...current, n8n_support_attendant_phone: event.target.value }))}
            placeholder="5511999998888"
            className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
          />
          <Button size="sm" onClick={() => save("n8n_support_attendant_phone", drafts.n8n_support_attendant_phone || "")}>
            Salvar
          </Button>
        </span>
      </label>

      <label className="block">
        <span className="block text-xs font-medium mb-1">Menu de atendimento (JSON)</span>
        <textarea
          value={drafts.whatsapp_support_menu ?? ""}
          onChange={(event) => setDrafts((current) => ({ ...current, whatsapp_support_menu: event.target.value }))}
          rows={6}
          placeholder='[{"id":"meu-pedido","title":"Meu pedido","description":"Status, prazo e rastreio"}]'
          className="w-full px-3 py-2 rounded-xl border-2 border-border outline-none focus:border-primary text-sm font-mono"
        />
        <span className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            IDs usados pelo bot: meu-pedido, quero-comprar, problemas, atendente. Vazio usa o menu padrão.
          </span>
          <Button size="sm" onClick={saveMenu}>Salvar menu</Button>
        </span>
      </label>
      {menuError ? <p className="text-xs text-red-600">{menuError}</p> : null}
    </div>
  );
}
