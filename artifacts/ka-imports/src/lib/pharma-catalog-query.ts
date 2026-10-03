export type PharmaCatalogFilters = {
  q: string;
  categoria: string;
  marca: string;
  promo: boolean;
};

export function readPharmaFilters(search: string): PharmaCatalogFilters {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return {
    q: params.get("q") || "",
    categoria: params.get("categoria") || "",
    marca: params.get("marca") || "",
    promo: params.get("promo") === "1",
  };
}

export function pharmaCatalogHref(homeHref: string, filters: PharmaCatalogFilters): string {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  const categoria = filters.categoria.trim();
  const marca = filters.marca.trim();
  if (q) params.set("q", q);
  if (categoria) params.set("categoria", categoria);
  if (marca) params.set("marca", marca);
  if (filters.promo) params.set("promo", "1");
  const qs = params.toString();
  return qs ? `${homeHref}?${qs}` : homeHref;
}
