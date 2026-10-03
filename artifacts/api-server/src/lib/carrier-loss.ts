import { historyEventTimeMs } from "./envioecom-status";

export const CARRIER_LOSS_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

export const MANUAL_CARRIER_OPTIONS = [
  "Correios Sedex",
  "Correios Pac",
  "Correios Mini Envios",
  "J&T Express envioEcom",
  "Jadlog envioEcom",
  "Ponto Loggi envioEcom",
  "BUSLOG envioEcom",
] as const;

const LOSS_WORDS = ["extravio", "roubo", "furto", "sinistro"] as const;

export type CarrierLossType = (typeof LOSS_WORDS)[number] | "manual";
export type CarrierLossAlertLevel = "warn" | "danger";

export type CarrierLossPhrase = {
  at?: string | null;
  status?: string | null;
  description?: string | null;
};

export type CarrierLossAlertIncident = {
  carrierKey: string;
  carrierName: string;
  neighborhoodKey: string;
  neighborhoodName: string | null;
  regionKey: string;
  incidentType: string;
  orderNumber: number | null;
  occurredAt: Date;
  cityName: string;
  state: string;
};

const SP_ZONE_LABELS: Record<string, string> = {
  "sp-centro": "Centro",
  "sp-norte": "Norte",
  "sp-leste": "Leste",
  "sp-sul": "Sul",
  "sp-oeste": "Oeste",
  "sp-extremo-leste": "Extremo Leste",
};

const CAPITALS = new Set([
  "rio de janeiro|RJ",
  "belo horizonte|MG",
  "salvador|BA",
  "fortaleza|CE",
  "brasilia|DF",
  "curitiba|PR",
  "recife|PE",
  "porto alegre|RS",
  "manaus|AM",
  "belem|PA",
  "goiania|GO",
  "sao luis|MA",
  "maceio|AL",
  "natal|RN",
  "teresina|PI",
  "campo grande|MS",
  "joao pessoa|PB",
  "aracaju|SE",
  "cuiaba|MT",
  "florianopolis|SC",
  "vitoria|ES",
  "macapa|AP",
  "porto velho|RO",
  "rio branco|AC",
  "boa vista|RR",
  "palmas|TO",
]);

export function foldPlace(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function carrierKey(value: unknown): string {
  return foldPlace(value).replace(/\s+envioecom$/, "").trim();
}

export function carrierDisplayName(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+envioecom$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAllowedManualCarrier(value: unknown): boolean {
  const key = carrierKey(value);
  if (!key) return false;
  return MANUAL_CARRIER_OPTIONS.some((option) => carrierKey(option) === key);
}

export function cepDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function stateCode(value: unknown): string {
  const uf = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(uf) ? uf : "";
}

export function lossRegionKey(city: unknown, state: unknown, cep: unknown): string {
  const cityKey = foldPlace(city);
  const uf = stateCode(state);
  const digits = cepDigits(cep);
  const prefix = Number(digits.slice(0, 3));
  if (cityKey === "sao paulo" && uf === "SP" && digits.length >= 3 && Number.isFinite(prefix)) {
    if (prefix >= 10 && prefix <= 15) return "sp-centro";
    if (prefix >= 20 && prefix <= 29) return "sp-norte";
    if (prefix >= 30 && prefix <= 39) return "sp-leste";
    if (prefix >= 40 && prefix <= 49) return "sp-sul";
    if (prefix >= 50 && prefix <= 58) return "sp-oeste";
    if (prefix >= 80 && prefix <= 84) return "sp-extremo-leste";
    return `sp-cep-${digits.slice(0, 3)}`;
  }
  if (uf && CAPITALS.has(`${cityKey}|${uf}`) && digits.length >= 3) {
    return `${uf.toLowerCase()}-cep-${digits.slice(0, 3)}`;
  }
  return "city";
}

export function classifyLossText(value: unknown): Exclude<CarrierLossType, "manual"> | null {
  const folded = foldPlace(value);
  if (!folded) return null;
  let best: { index: number; type: Exclude<CarrierLossType, "manual"> } | null = null;
  for (const word of LOSS_WORDS) {
    const index = folded.indexOf(word);
    if (index < 0) continue;
    if (!best || index < best.index) best = { index, type: word };
  }
  return best?.type ?? null;
}

export function classifyCarrierLoss(input: {
  status?: string | null;
  description?: string | null;
  history?: CarrierLossPhrase[] | null;
}): { type: Exclude<CarrierLossType, "manual">; raw: string } | null {
  const phrases: string[] = [];
  const status = String(input.status || "").trim();
  const description = String(input.description || "").trim();
  if (status) phrases.push(status);
  if (description) phrases.push(description);
  const history = [...(input.history || [])].sort((a, b) => phraseTime(a.at) - phraseTime(b.at));
  for (const event of history) {
    const eventStatus = String(event.status || "").trim();
    const eventDescription = String(event.description || "").trim();
    if (eventStatus) phrases.push(eventStatus);
    if (eventDescription) phrases.push(eventDescription);
  }
  for (const phrase of phrases) {
    const type = classifyLossText(phrase);
    if (type) return { type, raw: phrase };
  }
  return null;
}

export function nextOccurredAt(
  existing: { removedAt: Date | null; occurredAt: Date } | null,
  now: Date,
): Date {
  if (!existing || existing.removedAt) return now;
  return existing.occurredAt;
}

export function lossAlertForCarrier(
  carrierRaw: unknown,
  destinationNeighborhood: unknown,
  incidents: CarrierLossAlertIncident[],
): { level: CarrierLossAlertLevel; message: string } | null {
  const key = carrierKey(carrierRaw);
  if (!key) return null;
  const matches = incidents.filter((row) => row.carrierKey === key);
  if (!matches.length) return null;
  const neighborhood = foldPlace(destinationNeighborhood);
  const sameNeighborhood = neighborhood
    ? matches.filter((row) => row.neighborhoodKey === neighborhood)
    : [];
  const level: CarrierLossAlertLevel = sameNeighborhood.length > 0 || matches.length >= 2 ? "danger" : "warn";
  const cited = [...(sameNeighborhood.length ? sameNeighborhood : matches)].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  )[0];
  return { level, message: lossAlertMessage(cited) };
}

export function lossAlertMessage(incident: CarrierLossAlertIncident): string {
  const verb = incident.incidentType === "manual" ? "teve um caso" : `teve ${incident.incidentType}`;
  const details = [
    incident.neighborhoodName ? `bairro ${incident.neighborhoodName}` : "",
    formatDayMonth(incident.occurredAt),
    incident.orderNumber != null && incident.orderNumber > 0 ? `pedido #${incident.orderNumber}` : "",
  ].filter(Boolean);
  const tail = details.length ? ` (${details.join(", ")})` : "";
  return `${placePhrase(incident)} ${verb} na ${incident.carrierName}${tail}. Cuidado.`;
}

function placePhrase(incident: CarrierLossAlertIncident): string {
  const zone = SP_ZONE_LABELS[incident.regionKey];
  if (zone) return `Região ${zone} de ${incident.cityName}`;
  const cepMatch = /^[a-z]{2}-cep-(\d{3})$/.exec(incident.regionKey);
  if (cepMatch) return `Região do CEP ${cepMatch[1]} de ${incident.cityName}`;
  return `${incident.cityName}/${incident.state}`;
}

function formatDayMonth(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  }).format(value);
  return parts;
}

function phraseTime(value: unknown): number {
  return historyEventTimeMs(value);
}
