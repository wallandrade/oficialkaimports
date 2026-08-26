import { normalizeMotoboyPlaceName } from "./motoboy-neighborhood-normalize";

export type MotoboyCepRangePickInput = {
  city?: string | null;
  cepStart: number;
  cepEnd: number;
  sortOrder?: number | null;
};

function span(item: MotoboyCepRangePickInput): number {
  return item.cepEnd - item.cepStart;
}

/** CEP na faixa já filtra a lista. Ganha a faixa mais estreita; cidade só desempata empate de tamanho. */
export function pickMotoboyCepRange<T extends MotoboyCepRangePickInput>(
  candidates: T[],
  city?: unknown,
): T | null {
  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((left, right) => {
    const spanDelta = span(left) - span(right);
    if (spanDelta !== 0) return spanDelta;
    return (left.sortOrder || 0) - (right.sortOrder || 0);
  });

  const minSpan = span(ranked[0]);
  const tightest = ranked.filter((item) => span(item) === minSpan);
  const wantedCity = normalizeMotoboyPlaceName(city);
  if (wantedCity) {
    const byCity = tightest.find((item) => normalizeMotoboyPlaceName(item.city) === wantedCity);
    if (byCity) return byCity;
  }

  return tightest[0] ?? null;
}
