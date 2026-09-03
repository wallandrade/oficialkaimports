export function isObservationVisibleToCustomer(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function observationForCustomerApi(observation: unknown, visible: unknown): string | null {
  if (!isObservationVisibleToCustomer(visible)) return null;
  const text = String(observation || "").trim();
  return text || null;
}
