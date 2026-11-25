import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type ModerationLog = {
  groupTail: string;
  participantTail: string;
  action: string;
  createdAt: string;
};

type ModerationSnapshot = {
  enabled: boolean;
  dryRun: boolean;
  groupIds: string;
  allowPhones: string;
  storePhone: string;
  envEnabled: "on" | "off" | "unset";
  envDryRun: "on" | "off" | "unset";
  groupIdsFromEnv: boolean;
  allowPhonesFromEnv: boolean;
  storePhoneFromEnv: boolean;
  zapiConfigured: boolean;
  logs: ModerationLog[];
};

const fieldClass = "mt-1 block w-full rounded-xl border-2 border-border px-3 py-2";

const ACTION_LABEL: Record<string, string> = {
  dry_run: "Só registro",
  pending: "Em andamento",
  deleted_and_removed: "Apagou e removeu",
  deleted_remove_failed: "Apagou e não removeu",
  delete_failed_removed: "Removeu e não apagou",
  failed: "Não concluiu",
};

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function WhatsAppGroupModerationCard() {
  const [enabled, setEnabled] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [groupIds, setGroupIds] = useState("");
  const [allowPhones, setAllowPhones] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [snapshot, setSnapshot] = useState<ModerationSnapshot | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/whatsapp/group-moderation", { headers: authHeaders() });
    const data = await res.json() as ModerationSnapshot & { message?: string };
    if (!res.ok) {
      setError(data.message || "Não foi possível carregar a moderação.");
      return;
    }
    setSnapshot(data);
    setEnabled(data.enabled);
    setDryRun(data.dryRun);
    setGroupIds(data.groupIds || "");
    setAllowPhones(data.allowPhones || "");
    setStorePhone(data.storePhone || "");
  }

  useEffect(() => {
    void load().catch(() => setError("Não foi possível carregar a moderação."));
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/admin/whatsapp/group-moderation", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ enabled, dryRun, groupIds, allowPhones, storePhone }),
      });
      const data = await res.json() as { message?: string };
      if (!res.ok) {
        setError(data.message || "Não foi possível salvar.");
        return;
      }
      setSaved(true);
      await load();
    } catch {
      setError("Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  const envOverrides = Boolean(
    snapshot && (
      snapshot.envEnabled !== "unset"
      || snapshot.envDryRun !== "unset"
      || snapshot.groupIdsFromEnv
      || snapshot.allowPhonesFromEnv
      || snapshot.storePhoneFromEnv
    ),
  );

  return (
    <section className="max-w-3xl space-y-4 rounded-2xl border border-border bg-white p-5">
      <div>
        <h2 className="text-lg font-bold">Moderação de convite</h2>
        <p className="text-sm text-muted-foreground">
          Desligada até ligar. Sem identificador na lista, nenhum grupo é mexido. Convite de grupo apaga a mensagem para todos e remove a pessoa. Admin do grupo e o número da loja ficam. Não manda aviso no grupo.
        </p>
      </div>
      {snapshot && !snapshot.zapiConfigured ? (
        <p className="text-sm text-amber-700">Sem as variáveis da Z-API no servidor, nada é apagado nem removido.</p>
      ) : null}
      {envOverrides ? (
        <p className="text-sm text-muted-foreground">Uma variável de ambiente preenchida vale mais que o campo correspondente desta tela.</p>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Ligar a moderação
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
        Só registrar, sem apagar e sem remover
      </label>
      <label className="block text-sm">
        Identificadores dos grupos
        <textarea
          value={groupIds}
          onChange={(event) => setGroupIds(event.target.value)}
          placeholder={"Um por linha, o número do grupo na Z-API\n120363...-group"}
          rows={4}
          className={fieldClass}
        />
      </label>
      <label className="block text-sm">
        Números que também ficam
        <textarea
          value={allowPhones}
          onChange={(event) => setAllowPhones(event.target.value)}
          placeholder="Opcional. Um número por linha."
          rows={3}
          className={fieldClass}
        />
      </label>
      <label className="block text-sm">
        Número da loja
        <input
          value={storePhone}
          onChange={(event) => setStorePhone(event.target.value)}
          placeholder="Vazio usa o número que já manda os avisos"
          className={`${fieldClass} h-10`}
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {saved ? <p className="text-sm text-muted-foreground">Salvo.</p> : null}
      <Button type="button" onClick={() => void save()} disabled={busy}>Salvar moderação</Button>
      <div className="space-y-2">
        <h3 className="text-sm font-bold">Últimas ações</h3>
        {!snapshot || snapshot.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ação registrada.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {snapshot.logs.map((row, index) => (
              <li key={`${row.createdAt}-${row.groupTail}-${index}`} className="flex flex-wrap gap-x-3 gap-y-1">
                <span>{formatWhen(row.createdAt)}</span>
                <span>grupo {row.groupTail || "—"}</span>
                <span>{row.participantTail}</span>
                <span>{ACTION_LABEL[row.action] || row.action}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
