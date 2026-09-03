import type { InsurancePlan, InsuranceProblem } from "./checkout-insurance";
import { insuranceCoversProblem, parseInsurancePlan } from "./checkout-insurance";

export type InsuranceClaimStatus = "none" | "first_lost" | "reship_sent" | "refund_product";
export type InsuranceClaimChoice = "choose_reship" | "choose_refund";

export class InsuranceClaimError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "InsuranceClaimError";
  }
}

export function parseInsuranceProblem(raw: unknown): InsuranceProblem | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "extravio" || value === "sumiu" || value === "roubo") return "extravio";
  if (value === "apreensao" || value === "apreensão" || value === "receita" || value === "quebrado") return "apreensao";
  if (value === "missing_items" || value === "faltando" || value === "veio_faltando") return "missing_items";
  return null;
}

export function parseInsuranceClaimChoice(raw: unknown): InsuranceClaimChoice | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "choose_reship" || value === "reship" || value === "reenvio") return "choose_reship";
  if (value === "choose_refund" || value === "refund" || value === "estorno") return "choose_refund";
  return null;
}

export function parseInsuranceClaimStatus(raw: unknown): InsuranceClaimStatus {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "first_lost") return "first_lost";
  if (value === "reship_sent") return "reship_sent";
  if (value === "refund_product") return "refund_product";
  return "none";
}

export function orderInsurancePlan(order: {
  includeInsurance?: unknown;
  insurancePlan?: unknown;
}): InsurancePlan {
  return parseInsurancePlan(order.includeInsurance, order.insurancePlan);
}

export function evaluateOpenInsuranceClaim(input: {
  plan: InsurancePlan;
  problem: InsuranceProblem;
  claimStatus: InsuranceClaimStatus;
  reshipCount: number;
  isChildOrder: boolean;
}): { ok: true; nextStatus: InsuranceClaimStatus } | { ok: false; error: string; message: string } {
  if (input.problem === "missing_items") {
    return { ok: true, nextStatus: input.claimStatus };
  }
  if (input.isChildOrder) {
    return { ok: false, error: "CLAIM_ON_CHILD", message: "Sinistro de seguro deve ser aberto no pedido original." };
  }
  if (!insuranceCoversProblem(input.plan, input.problem)) {
    return {
      ok: false,
      error: "NO_COVERAGE",
      message: input.plan === "none"
        ? "Pedido sem garantia: não há reenvio por extravio ou apreensão."
        : "Este plano não cobre este tipo de chamado.",
    };
  }
  if (input.reshipCount >= 1 || input.claimStatus === "reship_sent" || input.claimStatus === "refund_product") {
    return { ok: false, error: "RESHIP_DONE", message: "A garantia já foi usada. Sem 3º envio e sem estorno do produto." };
  }
  return { ok: true, nextStatus: "first_lost" };
}

export function evaluateResolveInsuranceClaim(input: {
  plan: InsurancePlan;
  problem: InsuranceProblem;
  choice: InsuranceClaimChoice;
  claimStatus: InsuranceClaimStatus;
  reshipCount: number;
  isChildOrder: boolean;
}): { ok: true; nextStatus: "reship_sent" | "refund_product"; action: "reship" | "refund" } | { ok: false; error: string; message: string } {
  if (input.problem === "missing_items") {
    return { ok: false, error: "NOT_INSURANCE", message: "Item faltante não usa a política de seguro." };
  }
  if (input.isChildOrder) {
    return { ok: false, error: "CLAIM_ON_CHILD", message: "Sinistro de seguro deve ser resolvido no pedido original." };
  }
  if (!insuranceCoversProblem(input.plan, input.problem)) {
    return { ok: false, error: "NO_COVERAGE", message: "Este plano não cobre este tipo de chamado." };
  }
  if (input.reshipCount >= 1 || input.claimStatus === "reship_sent" || input.claimStatus === "refund_product") {
    return { ok: false, error: "RESHIP_DONE", message: "A garantia já foi usada. Sem 3º envio e sem estorno do produto." };
  }
  if (input.choice === "choose_refund") {
    if (input.plan !== "full") {
      return { ok: false, error: "REDUCED_NO_REFUND", message: "Plano reduzido não devolve o produto. Só 1 reenvio." };
    }
    return { ok: true, nextStatus: "refund_product", action: "refund" };
  }
  return { ok: true, nextStatus: "reship_sent", action: "reship" };
}
