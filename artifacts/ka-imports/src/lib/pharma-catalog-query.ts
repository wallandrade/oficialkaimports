export type PharmaCatalogSort = "relevancia" | "menor" | "maior" | "nome";

export type PharmaCatalogVitrine = "" | "vendidos" | "lancamentos";

export type PharmaCatalogFilters = {
  q: string;
  categoria: string;
  marca: string;
  promo: boolean;
  ordem: PharmaCatalogSort;
  vitrine: PharmaCatalogVitrine;
};

function readPharmaSort(value: string): PharmaCatalogSort {
  if (value === "menor" || value === "maior" || value === "nome") return value;
  return "relevancia";
}

function readPharmaVitrine(value: string): PharmaCatalogVitrine {
  if (value === "vendidos" || value === "lancamentos") return value;
  return "";
}

export function readPharmaFilters(search: string): PharmaCatalogFilters {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return {
    q: params.get("q") || "",
    categoria: params.get("categoria") || "",
    marca: params.get("marca") || "",
    promo: params.get("promo") === "1",
    ordem: readPharmaSort(params.get("ordem") || ""),
    vitrine: readPharmaVitrine(params.get("vitrine") || ""),
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
  if (filters.ordem && filters.ordem !== "relevancia") params.set("ordem", filters.ordem);
  if (filters.vitrine) params.set("vitrine", filters.vitrine);
  const qs = params.toString();
  return qs ? `${homeHref}?${qs}` : homeHref;
}
