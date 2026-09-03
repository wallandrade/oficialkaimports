import { AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { CheckoutInsuranceSettings, InsurancePlan } from "@/lib/checkout-insurance";

type Offer = {
  plan: "full" | "reduced";
  amount: number;
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
}: {
  enabled: boolean;
  settings?: CheckoutInsuranceSettings;
  selectedPlan: InsurancePlan;
  onSelect: (plan: InsurancePlan) => void;
  fullOffer: Offer | null;
  reducedOffer: Offer | null;
  isLoggedIn: boolean;
}) {
  if (!enabled || (!fullOffer && !reducedOffer)) return null;

  const toggle = (plan: "full" | "reduced") => {
    onSelect(selectedPlan === plan ? "none" : plan);
  };

  return (
    <div className="pt-4 border-t border-border space-y-3">
      <div>
        <p className="font-bold text-foreground">Garantia de envio</p>
        <p className="text-sm text-muted-foreground mt-0.5">Opcional. Escolha uma ou deixe sem.</p>
      </div>

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
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {reducedOffer.label} — {formatCurrency(reducedOffer.amount)}
                </p>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{reducedOffer.description}</p>
                {selectedPlan === "reduced" && (
                  <p className="text-xs text-muted-foreground mt-2">Manda de novo 1 vez. O valor da garantia não volta.</p>
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
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {fullOffer.label} — {formatCurrency(fullOffer.amount)}
                </p>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{fullOffer.description}</p>
                {selectedPlan === "full" && (
                  <div className="text-xs text-muted-foreground mt-2 space-y-1">
                    <p>Se chegar: saldo na carteira. Se der ruim: 1 reenvio ou estorno do subtotal. O seguro não volta.</p>
                    {!isLoggedIn && (
                      <p className="text-amber-800">Sem conta o saldo não cai. Entre para receber o cashback na entrega.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </button>
        )}
      </div>

      {selectedPlan === "none" && (
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
