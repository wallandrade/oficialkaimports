import { AlertTriangle, Package, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { CheckoutInsuranceSettings, InsurancePlan } from "@/lib/checkout-insurance";

type Offer = {
  plan: "full" | "reduced";
  amount: number;
  cashbackAmount?: number;
  productSubtotal?: number;
  label: string;
  description: string;
};

export function CheckoutInsuranceOffer({
  enabled,
  selectedPlan,
  onSelect,
  fullOffer,
  reducedOffer,
  isLoggedIn,
  hideIntro = false,
  showNoneWarning = true,
}: {
  enabled: boolean;
  settings?: CheckoutInsuranceSettings;
  selectedPlan: InsurancePlan;
  onSelect: (plan: InsurancePlan) => void;
  fullOffer: Offer | null;
  reducedOffer: Offer | null;
  isLoggedIn: boolean;
  hideIntro?: boolean;
  showNoneWarning?: boolean;
}) {
  if (!enabled || (!fullOffer && !reducedOffer)) return null;

  const toggle = (plan: "full" | "reduced") => {
    onSelect(selectedPlan === plan ? "none" : plan);
  };

  const fullCashback = Math.max(0, Number(fullOffer?.cashbackAmount || 0));
  const productSubtotal = Math.max(0, Number(fullOffer?.productSubtotal || 0));

  return (
    <div className={hideIntro ? "space-y-3" : "pt-4 border-t border-border space-y-3"}>
      {!hideIntro && (
        <div>
          <p className="font-bold text-foreground">Garantia de envio</p>
          <p className="text-sm text-muted-foreground mt-0.5">Opcional. Escolha uma ou deixe sem.</p>
        </div>
      )}

      <div className="space-y-2">
        {reducedOffer && (
          <button
            type="button"
            onClick={() => toggle("reduced")}
            className={`w-full text-left rounded-xl border p-4 transition-colors ${
              selectedPlan === "reduced" ? "border-primary bg-primary/5" : "border-border bg-white hover:border-primary/40"
            }`}
          >
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${selectedPlan === "reduced" ? "border-primary bg-primary" : "border-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">
                  {reducedOffer.label} — {formatCurrency(reducedOffer.amount)}
                </p>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{reducedOffer.description}</p>
                {selectedPlan === "reduced" && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-800 flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                      Sumiu ou roubaram
                    </p>
                    <p className="text-xs text-amber-900 mt-1.5 leading-relaxed">
                      A gente <strong>manda de novo</strong>, <strong>1 vez só</strong> (a gente paga o frete). Os {formatCurrency(reducedOffer.amount)} da garantia <strong>não voltam</strong>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </button>
        )}

        {fullOffer && (
          <button
            type="button"
            onClick={() => toggle("full")}
            className={`w-full text-left rounded-xl border p-4 transition-colors ${
              selectedPlan === "full" ? "border-primary bg-primary/5" : "border-border bg-white hover:border-primary/40"
            }`}
          >
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${selectedPlan === "full" ? "border-primary bg-primary" : "border-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">
                  {fullOffer.label} — {formatCurrency(fullOffer.amount)}
                </p>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{fullOffer.description}</p>
                {selectedPlan === "full" && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-foreground leading-relaxed">
                      Se chegar certo: você ganha <strong>{formatCurrency(fullCashback)}</strong> para gastar de novo na loja. Se der ruim: a gente manda outra vez (você não paga o frete) ou devolve os <strong>{formatCurrency(productSubtotal)}</strong> do produto.
                    </p>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-800 flex items-center gap-1.5">
                        <Package className="w-3.5 h-3.5 shrink-0" />
                        Chegou certo
                      </p>
                      <p className="text-xs text-emerald-900 mt-1.5">
                        Você fica com {formatCurrency(fullCashback)} para a próxima compra.
                      </p>
                    </div>
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-amber-800 flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                        Não chegou, apreenderam ou veio quebrado
                      </p>
                      <p className="text-xs text-amber-900 mt-1.5 leading-relaxed">
                        Você escolhe: <strong>manda de novo, 1 vez só</strong> (a gente paga o frete) ou devolve <strong>{formatCurrency(productSubtotal)}</strong> do produto. Os {formatCurrency(fullOffer.amount)} da garantia <strong>não voltam</strong>.
                      </p>
                    </div>
                    {!isLoggedIn && (
                      <p className="text-xs text-amber-800">Sem conta o saldo não cai. Entre para receber o cashback na entrega.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </button>
        )}
      </div>

      {showNoneWarning && selectedPlan === "none" && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-800 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Sem garantia: se perder, apreender ou quebrar, <strong>não mandamos de novo</strong>.</span>
          </p>
        </div>
      )}
    </div>
  );
}
