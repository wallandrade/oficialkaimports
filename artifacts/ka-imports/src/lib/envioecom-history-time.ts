/** Unix (s ou ms), ISO e dd/mm/aaaa hh:mm:ss. Igual a historyEventTimeMs da API. */
export function historyEventTimeMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return 0;
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = br;
    const parsed = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
