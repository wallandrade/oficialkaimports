import { isReshipmentChildOrder } from "./product-sold-qty";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Valor que entra no Total Pago.
 * Pedido normal: o total.
 * Filho de reenvio: só o que passou do valor já pago no original
 * (`reshipmentCoveredAmount`, gravado na criação). Sem esse teto, entra 0.
 */
export function reshipmentDashboardAmount(order: {
  observation?: unknown;
  parentOrderId?: unknown;
  total?: unknown;
  reshipmentCoveredAmount?: unknown;
}): number {
  const total = Number(order.total ?? 0);
  const safeTotal = Number.isFinite(total) ? total : 0;
  if (!isReshipmentChildOrder(order.observation, order.parentOrderId)) {
    return roundMoney(safeTotal);
  }
  if (order.reshipmentCoveredAmount == null || order.reshipmentCoveredAmount === "") {
    return 0;
  }
  const covered = Number(order.reshipmentCoveredAmount);
  if (!Number.isFinite(covered)) return 0;
  return roundMoney(Math.max(0, safeTotal - covered));
}
