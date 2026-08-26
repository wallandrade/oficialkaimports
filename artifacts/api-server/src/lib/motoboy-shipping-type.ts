export function isMotoboyShippingType(value: unknown): boolean {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .includes("motoboy");
}
