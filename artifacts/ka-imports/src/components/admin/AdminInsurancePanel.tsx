import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/utils";
import {
  parseInsuranceSettingsFromMap,
  resolveCheckoutInsurance,
  type CheckoutInsuranceSettings,
} from "@/lib/checkout-insurance";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ProductOption = { id: string; name: string };

function settingOn(value: string | undefined, fallback = true) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "off", "no", "disabled"].includes(String(value).trim().toLowerCase());
}

export function AdminInsurancePanel({
  settings,
  loading,
  products,
  onSave,
  authHeaders,
}: {
  settings: Record<string, string>;
  loading: Record<string, boolean>;
  products: ProductOption[];
  onSave: (key: string, value: string) => Promise<void> | void;
  authHeaders: () => Record<string, string>;
}) {
  const parsed = parseInsuranceSettingsFromMap(settings);
  const [enabled, setEnabled] = useState(settingOn(settings.checkout_insurance_enabled, true));
  const [fullEnabled, setFullEnabled] = useState(settingOn(settings.checkout_insurance_full_enabled, true));
  const [reducedEnabled, setReducedEnabled] = useState(settingOn(settings.checkout_insurance_reduced_enabled, true));
  const [fullPercent, setFullPercent] = useState(String(parsed.fullPercent));
  const [reducedPercent, setReducedPercent] = useState(String(parsed.reducedPercent));
  const [keepPercent, setKeepPercent] = useState(String(parsed.keepPercent));
  const [specialPercent, setSpecialPercent] = useState(settings.checkout_insurance_product_percent || "");
  const [specialIds, setSpecialIds] = useState<string[]>(parsed.specialProductIds);
  const [fullLabel, setFullLabel] = useState(settings.checkout_insurance_full_label || parsed.fullLabel);
  const [fullDescription, setFullDescription] = useState(settings.checkout_insurance_full_description || parsed.fullDescription);
  const [reducedLabel, setReducedLabel] = useState(settings.checkout_insurance_reduced_label || parsed.reducedLabel);
  const [reducedDescription, setReducedDescription] = useState(settings.checkout_insurance_reduced_description || parsed.reducedDescription);

  useEffect(() => {
    const next = parseInsuranceSettingsFromMap(settings);
    setEnabled(settingOn(settings.checkout_insurance_enabled, true));
    setFullEnabled(settingOn(settings.checkout_insurance_full_enabled, true));
    setReducedEnabled(settingOn(settings.checkout_insurance_reduced_enabled, true));
    setFullPercent(String(next.fullPercent));
    setReducedPercent(String(next.reducedPercent));
    setKeepPercent(String(next.keepPercent));
    setSpecialPercent(settings.checkout_insurance_product_percent || "");
    setSpecialIds(next.specialProductIds);
    setFullLabel(settings.checkout_insurance_full_label || next.fullLabel);
    setFullDescription(settings.checkout_insurance_full_description || next.fullDescription);
    setReducedLabel(settings.checkout_insurance_reduced_label || next.reducedLabel);
    setReducedDescription(settings.checkout_insurance_reduced_description || next.reducedDescription);
  }, [settings]);
  const [saving, setSaving] = useState(false);
  const [walletUserId, setWalletUserId] = useState("");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletReason, setWalletReason] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletInfo, setWalletInfo] = useState<string>("Nenhum saldo ainda");

  const previewSettings: CheckoutInsuranceSettings = {
    enabled,
    fullEnabled,
    reducedEnabled,
    fullPercent: Number(fullPercent) || 0,
    reducedPercent: Number(reducedPercent) || 0,
    keepPercent: Number(keepPercent) || 0,
    specialPercent: specialPercent.trim() === "" ? null : Number(specialPercent),
    specialProductIds: specialIds,
    fullLabel,
    fullDescription,
    reducedLabel,
    reducedDescription,
  };

  const preview = resolveCheckoutInsurance({
    insurancePlan: "full",
    includeInsurance: true,
    subtotal: 733,
    shippingCost: 0,
    settings: previewSettings,
  });
  const previewReduced = resolveCheckoutInsurance({
    insurancePlan: "reduced",
    includeInsurance: true,
    subtotal: 733,
    shippingCost: 0,
    settings: previewSettings,
  });

  const saveAll = async () => {
    setSaving(true);
    try {
      await onSave("checkout_insurance_enabled", enabled ? "1" : "0");
      await onSave("checkout_insurance_full_enabled", fullEnabled ? "1" : "0");
      await onSave("checkout_insurance_reduced_enabled", reducedEnabled ? "1" : "0");
      await onSave("checkout_insurance_percent", String(Number(fullPercent) || 10));
      await onSave("checkout_insurance_reduced_percent", String(Number(reducedPercent) || 10));
      await onSave("checkout_insurance_keep_percent", String(Number(keepPercent) || 10));
      await onSave("checkout_insurance_product_percent", specialPercent.trim());
      await onSave("checkout_insurance_product_ids", JSON.stringify(specialIds));
      await onSave("checkout_insurance_full_label", fullLabel);
      await onSave("checkout_insurance_full_description", fullDescription);
      await onSave("checkout_insurance_reduced_label", reducedLabel);
      await onSave("checkout_insurance_reduced_description", reducedDescription);
      toast.success("Seguro salvo.");
    } finally {
      setSaving(false);
    }
  };

  const toggleProduct = (id: string) => {
    setSpecialIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const adjustWallet = async () => {
    const amount = Number(String(walletAmount).replace(",", "."));
    if (!walletUserId.trim() || !Number.isFinite(amount) || amount === 0 || !walletReason.trim()) {
      toast.error("Preencha ID, valor e motivo.");
      return;
    }
    setWalletBusy(true);
    try {
      const res = await fetch(`${BASE}/api/admin/wallet/adjust`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          customerUserId: walletUserId.trim(),
          amount,
          reason: walletReason.trim(),
        }),
      });
      const data = await res.json() as { message?: string; availableCredit?: number };
      if (!res.ok) {
        toast.error(data.message || "Erro ao ajustar saldo.");
        return;
      }
      setWalletInfo(`Saldo atual: ${formatCurrency(Number(data.availableCredit || 0))}`);
      toast.success("Saldo ajustado.");
    } catch {
      toast.error("Erro ao ajustar saldo.");
    } finally {
      setWalletBusy(false);
    }
  };

  const statusText = useMemo(() => {
    if (!enabled) return "Desligado";
    return `Ativo — ${previewSettings.fullPercent}% na loja${specialIds.length ? ` e ${previewSettings.specialPercent || 0}% nos ${specialIds.length} produto(s) especial(is).` : "."}`;
  }, [enabled, previewSettings.fullPercent, previewSettings.specialPercent, specialIds.length]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
      <div className="rounded-2xl border border-border bg-white p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Seguro de envio</h2>
            <p className="text-sm text-muted-foreground mt-1">O que o cliente vê no checkout tem que ser o que o pedido grava.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className={`rounded-lg px-3 py-2 text-sm ${enabled ? "bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
          {statusText}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Seguro reduzido (só extravio/roubo)</p>
              <Switch checked={reducedEnabled} onCheckedChange={setReducedEnabled} />
            </div>
            <Input value={reducedLabel} onChange={(e) => setReducedLabel(e.target.value)} placeholder="Título" />
            <textarea
              value={reducedDescription}
              onChange={(e) => setReducedDescription(e.target.value)}
              className="w-full min-h-28 rounded-md border border-input px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Seguro completo</p>
              <Switch checked={fullEnabled} onCheckedChange={setFullEnabled} />
            </div>
            <Input value={fullLabel} onChange={(e) => setFullLabel(e.target.value)} placeholder="Título" />
            <textarea
              value={fullDescription}
              onChange={(e) => setFullDescription(e.target.value)}
              className="w-full min-h-28 rounded-md border border-input px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">% do seguro completo
            <Input className="mt-1" value={fullPercent} onChange={(e) => setFullPercent(e.target.value)} />
          </label>
          <label className="text-sm">% do seguro reduzido
            <Input className="mt-1" value={reducedPercent} onChange={(e) => setReducedPercent(e.target.value)} />
          </label>
          <label className="text-sm">% que a loja fica (se entregar)
            <Input className="mt-1" value={keepPercent} onChange={(e) => setKeepPercent(e.target.value)} />
          </label>
          <label className="text-sm">% especial dos produtos
            <Input className="mt-1" value={specialPercent} onChange={(e) => setSpecialPercent(e.target.value)} />
          </label>
        </div>

        <div>
          <p className="text-sm font-semibold mb-2">Produtos com % especial (só completo)</p>
          <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
            {products.map((product) => (
              <label key={product.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={specialIds.includes(product.id)} onChange={() => toggleProduct(product.id)} />
                <span>{product.name}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{specialIds.length} produto(s) com % especial. Os demais usam o % padrão.</p>
        </div>

        <div className="rounded-xl border border-border p-3 text-sm space-y-2">
          <p className="font-semibold">Prévia no checkout</p>
          <p className="whitespace-pre-line">{fullLabel}</p>
          <p className="text-muted-foreground whitespace-pre-line">{fullDescription}</p>
          <p className="whitespace-pre-line">{reducedLabel}</p>
          <p className="text-muted-foreground whitespace-pre-line">{reducedDescription}</p>
          <p className="text-xs text-muted-foreground">
            Completo cobra {previewSettings.fullPercent}%{specialIds.length ? ` / ${previewSettings.specialPercent || 0}%` : ""} · reduzido cobra {previewSettings.reducedPercent}%
          </p>
          <p className="text-xs">
            Exemplo produto R$ 733,00 → cobra {formatCurrency(preview.insuranceAmount)} · loja fica {formatCurrency(preview.keepAmount)} · saldo {formatCurrency(preview.cashbackAmount)}
            {previewReduced.includeInsurance ? ` · reduzido ${formatCurrency(previewReduced.insuranceAmount)}` : ""}
          </p>
        </div>

        <Button className="w-full" onClick={() => void saveAll()} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar seguro"}
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-white p-5 space-y-3 h-fit">
        <h3 className="text-lg font-bold">Saldo dos clientes</h3>
        <p className="text-sm text-muted-foreground">Ajuste manual da carteira de seguro (não é crédito de afiliado).</p>
        <Input placeholder="ID do cliente" value={walletUserId} onChange={(e) => setWalletUserId(e.target.value)} />
        <Input placeholder="Valor (+ ou -)" value={walletAmount} onChange={(e) => setWalletAmount(e.target.value)} />
        <Input placeholder="Motivo" value={walletReason} onChange={(e) => setWalletReason(e.target.value)} />
        <Button className="w-full" onClick={() => void adjustWallet()} disabled={walletBusy}>
          {walletBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Ajustar saldo"}
        </Button>
        <p className="text-xs text-muted-foreground">{walletInfo}</p>
      </div>
    </div>
  );
}
