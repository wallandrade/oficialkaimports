export const SHIPPING_QUEUE_MANUAL_ENABLED_KEY = "shipping_queue_manual_enabled";
export const SHIPPING_QUEUE_MANUAL_HOURS_KEY = "shipping_queue_manual_hours";
export const MAX_MANUAL_HOURS = 999;

export function isManualShippingDeadlineEnabled(value: string | null | undefined): boolean {
  return ["1", "true", "on", "yes"].includes(String(value || "").trim().toLowerCase());
}

export function resolveCheckoutDeadlineHours(
  calculatedHours: number,
  manualEnabledRaw: string | null | undefined,
  manualHoursRaw: string | null | undefined,
): number {
  if (!isManualShippingDeadlineEnabled(manualEnabledRaw)) return calculatedHours;
  const parsed = Number(String(manualHoursRaw || "").trim().replace(",", "."));
  if (!Number.isFinite(parsed)) return calculatedHours;
  const hours = Math.round(parsed);
  if (hours < 1) return calculatedHours;
  return Math.min(MAX_MANUAL_HOURS, hours);
}

export function normalizeShippingQueueManualHours(raw: unknown):
  | { ok: true; value: string }
  | { ok: false; message: string } {
  const parsed = Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: "Informe um prazo entre 1 e 999 horas." };
  }
  const hours = Math.round(parsed);
  if (hours < 1) {
    return { ok: false, message: "Informe um prazo entre 1 e 999 horas." };
  }
  return { ok: true, value: String(Math.min(MAX_MANUAL_HOURS, hours)) };
}
