import { enqueueFilialOrderPurchaseRequest } from "../lib/filial-purchase-queue";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, pool, ordersTable, customChargesTable, sellersTable, productsTable, siteSettingsTable, tenantSettingsTable, reshipmentsTable, couponsTable, motoboyDeliveryReservationsTable, orderLogisticsAllocationsTable } from "@workspace/db";
import { desc, and, gte, lte, eq, inArray, isNull, or, sql } from "drizzle-orm";
import crypto from "crypto";
import { getAdminScope, requireAdminAuth, verifyCurrentAdminPassword } from "./admin-auth";
import { broadcastNotification } from "./notifications";
import { evaluateCouponForProducts, incrementCouponUse } from "./coupons";
import {
  createPixChargeWithProvider,
  buildCallbackUrl,
  genIdentifier,
  normalizePixGatewayProvider,
  PIX_DURATION_MS,
} from "../gateway";
import { getCustomerSession, requireCustomerAuth } from "../middlewares/customer-auth";
import {
  ensureOrderCommission,
  normalizeAffiliateCode,
  registerAffiliateLead,
  resolveAffiliateByCode,
} from "../lib/affiliates";
import { createOrRefreshReshipment, getReshipmentByOrderIds, registerInventoryEntry } from "../lib/reshipments";
import { lookupIpGeo } from "../lib/ip-geo";
import { getR2MissingConfig, isR2Configured, uploadOrderTrackingLabelToR2 } from "../lib/r2";
import { sendOutboundWebhook } from "../lib/outbound-webhook";
import { parseFreeShippingMinSubtotalSetting, pickFreeShippingMinSubtotal, resolveShippingCostWithFreeThreshold } from "../lib/free-shipping";
import { DEFAULT_TENANT_ID, resolvePublicTenantId } from "../lib/tenant-context";
import { reserveNextOrderNumber } from "../lib/order-number";
import { MotoboyScheduleError, reserveMotoboySchedule } from "../lib/motoboy-delivery-schedule";
import { allocateOrderLogistics, releaseOrderLogistics } from "../lib/order-logistics";
import { isMotoboyShippingType } from "../lib/motoboy-shipping-type";
import { ensureOrderMarkedEnviado, OrderEnviadoError, debitOrderInventoryPool } from "../lib/order-enviado";
import {
  parseKaInventoryExitPool,
  parseKaInventoryExitedPools,
  resolveYuryInventoryExitPool,
  serializeKaInventoryExitedPools,
} from "../lib/yury-inventory";
import { cartProductIdsFromItems, isCartEligibleForMotoboy } from "../lib/motoboy-eligible-products";
import {
  insuranceLinesFromProducts,
  insuranceSnapshotColumns,
  loadCheckoutInsuranceSettings,
  resolveCheckoutInsurance,
} from "../lib/checkout-insurance";
import { applyStoreCreditToOrder } from "../lib/customer-wallet";

const router: IRouter = Router();

let priorityColumnCache: { checkedAt: number; available: boolean } = { checkedAt: 0, available: false };
let searchingProductColumnCache: { checkedAt: number; available: boolean } = { checkedAt: 0, available: false };
const SLA_PRIORITY_BUSINESS_MS = 48 * 60 * 60 * 1000;
const SAO_PAULO_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;
const holidayCacheByYear = new Map<number, Set<string>>();

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function addDaysFrom(year: number, month: number, day: number, deltaDays: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

function getBrazilHolidayKeys(year: number): Set<string> {
  const cached = holidayCacheByYear.get(year);
  if (cached) return cached;

  const holidays = new Set<string>([
    toDateKey(year, 1, 1),
    toDateKey(year, 4, 21),
    toDateKey(year, 5, 1),
    toDateKey(year, 9, 7),
    toDateKey(year, 10, 12),
    toDateKey(year, 11, 2),
    toDateKey(year, 11, 15),
    toDateKey(year, 11, 20),
    toDateKey(year, 12, 25),
  ]);

  const easter = getEasterSunday(year);
  const carnivalMonday = addDaysFrom(year, easter.month, easter.day, -48);
  const carnivalTuesday = addDaysFrom(year, easter.month, easter.day, -47);
  const goodFriday = addDaysFrom(year, easter.month, easter.day, -2);
  const corpusChristi = addDaysFrom(year, easter.month, easter.day, 60);

  holidays.add(toDateKey(carnivalMonday.year, carnivalMonday.month, carnivalMonday.day));
  holidays.add(toDateKey(carnivalTuesday.year, carnivalTuesday.month, carnivalTuesday.day));
  holidays.add(toDateKey(goodFriday.year, goodFriday.month, goodFriday.day));
  holidays.add(toDateKey(year, easter.month, easter.day));
  holidays.add(toDateKey(corpusChristi.year, corpusChristi.month, corpusChristi.day));

  holidayCacheByYear.set(year, holidays);
  return holidays;
}

function getSaoPauloDateParts(utcMs: number): { year: number; month: number; day: number; weekDay: number } {
  const shifted = new Date(utcMs + SAO_PAULO_UTC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekDay: shifted.getUTCDay(),
  };
}

function isBusinessWeekdayInSaoPaulo(utcMs: number): boolean {
  const parts = getSaoPauloDateParts(utcMs);
  if (parts.weekDay < 1 || parts.weekDay > 5) return false;
  const dateKey = toDateKey(parts.year, parts.month, parts.day);
  return !getBrazilHolidayKeys(parts.year).has(dateKey);
}

function nextSaoPauloMidnightUtcMs(utcMs: number): number {
  const shifted = new Date(utcMs + SAO_PAULO_UTC_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const nextMidnightShiftedUtc = Date.UTC(y, m, d + 1, 0, 0, 0, 0);
  return nextMidnightShiftedUtc - SAO_PAULO_UTC_OFFSET_MS;
}

function elapsedBusinessMsSince(createdAt: Date | null | undefined, now: Date = new Date()): number {
  if (!createdAt) return 0;
  const start = createdAt.getTime();
  const end = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  let cursor = start;
  let businessMs = 0;
  while (cursor < end) {
    const segmentEnd = Math.min(end, nextSaoPauloMidnightUtcMs(cursor));
    if (isBusinessWeekdayInSaoPaulo(cursor)) {
      businessMs += Math.max(0, segmentEnd - cursor);
    }
    cursor = segmentEnd;
  }
  return businessMs;
}

function shouldAutoPrioritizeOrder(order: { status?: string | null; enviado?: boolean | null; createdAt?: Date | null }): boolean {
  if (!order.createdAt) return false;
  if (order.enviado) return false;

  const normalizedStatus = String(order.status || "").trim().toLowerCase();
  if (!normalizedStatus || normalizedStatus === "cancelled") return false;
  if (normalizedStatus !== "paid" && normalizedStatus !== "completed") return false;

  return elapsedBusinessMsSince(order.createdAt) >= SLA_PRIORITY_BUSINESS_MS;
}

async function isOrderPriorityColumnAvailable(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - priorityColumnCache.checkedAt < 60_000) {
    return priorityColumnCache.available;
  }

  try {
    const [rows] = await pool.query(
      `
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'orders'
          AND COLUMN_NAME = 'is_prioridade'
        LIMIT 1
      `,
    );
    const available = Array.isArray(rows) && rows.length > 0;
    priorityColumnCache = { checkedAt: now, available };
    return available;
  } catch {
    priorityColumnCache = { checkedAt: now, available: false };
    return false;
  }
}

async function loadOrderPriorityMap(orderIds: string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (orderIds.length === 0) return map;

  const available = await isOrderPriorityColumnAvailable();
  if (!available) return map;

  try {
    const placeholders = orderIds.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT id, is_prioridade FROM orders WHERE id IN (${placeholders})`,
      orderIds,
    );

    if (Array.isArray(rows)) {
      for (const row of rows as Array<{ id?: string; is_prioridade?: number | boolean | null }>) {
        const id = String(row?.id || "").trim();
        if (!id) continue;
        map.set(id, !!row?.is_prioridade);
      }
    }
  } catch (err) {
    const message = String((err as { message?: string })?.message || "").toLowerCase();
    if (message.includes("unknown column") || message.includes("is_prioridade")) {
      priorityColumnCache = { checkedAt: Date.now(), available: false };
      return map;
    }
    throw err;
  }

  return map;
}

async function isOrderSearchingProductColumnAvailable(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - searchingProductColumnCache.checkedAt < 60_000) {
    return searchingProductColumnCache.available;
  }

  try {
    const [rows] = await pool.query(
      `
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'orders'
          AND COLUMN_NAME = 'is_procurando_produto'
        LIMIT 1
      `,
    );
    const available = Array.isArray(rows) && rows.length > 0;
    searchingProductColumnCache = { checkedAt: now, available };
    return available;
  } catch {
    searchingProductColumnCache = { checkedAt: now, available: false };
    return false;
  }
}

async function loadOrderSearchingProductMap(orderIds: string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (orderIds.length === 0) return map;

  const available = await isOrderSearchingProductColumnAvailable();
  if (!available) return map;

  try {
    const placeholders = orderIds.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT id, is_procurando_produto FROM orders WHERE id IN (${placeholders})`,
      orderIds,
    );

    if (Array.isArray(rows)) {
      for (const row of rows as Array<{ id?: string; is_procurando_produto?: number | boolean | null }>) {
        const id = String(row?.id || "").trim();
        if (!id) continue;
        map.set(id, !!row?.is_procurando_produto);
      }
    }
  } catch (err) {
    const message = String((err as { message?: string })?.message || "").toLowerCase();
    if (message.includes("unknown column") || message.includes("is_procurando_produto")) {
      searchingProductColumnCache = { checkedAt: Date.now(), available: false };
      return map;
    }
    throw err;
  }

  return map;
}

async function getSettingValue(key: string, tenantId: string): Promise<string | null> {
  const tenantRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, key)))
    .limit(1);

  if (tenantRows[0]?.value != null) return tenantRows[0].value;

  const legacyRows = tenantId === DEFAULT_TENANT_ID
    ? await db
      .select({ value: siteSettingsTable.value })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.key, key))
      .limit(1)
    : [];

  return legacyRows[0]?.value ?? null;
}

async function getActivePixGateway(tenantId: string): Promise<"appcnpay" | "dentpeg"> {
  const value = await getSettingValue("checkout_pix_gateway", tenantId);
  return normalizePixGatewayProvider(value ?? null);
}

async function getFreeShippingMinSubtotal(
  tenantId: string,
  shippingType?: unknown,
  neighborhoodId?: unknown,
): Promise<number | null> {
  const [standardRaw, motoboyRaw] = await Promise.all([
    getSettingValue("checkout_free_shipping_min_subtotal", tenantId),
    getSettingValue("checkout_free_shipping_min_motoboy", tenantId),
  ]);
  return pickFreeShippingMinSubtotal({
    shippingType,
    neighborhoodId,
    standardMin: parseFreeShippingMinSubtotalSetting(standardRaw ?? ""),
    motoboyMin: parseFreeShippingMinSubtotalSetting(motoboyRaw ?? ""),
  });
}

type BulkDiscountTierInput = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
};

type OrderProductInput = {
  id: string;
  name?: string;
  quantity: number;
  price: number;
  isBump?: boolean;
  selectedVariants?: Array<{ groupName?: string; option?: string }>;
  variantLabel?: string;
};

function normalizeOrderItemVariants(raw: unknown): Array<{ groupName: string; option: string }> {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const value = item as Record<string, unknown>;
      const groupName = String(value.groupName ?? "").trim();
      const option = String(value.option ?? "").trim();
      if (!groupName || !option) return null;
      return { groupName, option };
    })
    .filter((item): item is { groupName: string; option: string } => Boolean(item));
}

function buildVariantLabel(variants: Array<{ groupName: string; option: string }>): string {
  return variants.map((item) => `${item.groupName}: ${item.option}`).join(" / ");
}

type TrackingParseResult = {
  rawText: string;
  trackingCode: string | null;
  detectedName: string | null;
  detectedAddress: string | null;
  detectedCep: string | null;
};

type TrackingVisionResult = TrackingParseResult & {
  confidence: number | null;
  source: "ocr" | "openai" | "manual";
};

type TrackingMatchCandidateInput = {
  id: string;
  clientName?: string | null;
  clientPhone?: string | null;
  clientDocument?: string | null;
  addressCep?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  addressNeighborhood?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  status?: string | null;
  enviado?: boolean;
};

function extractTrackingCode(text: string): string | null {
  const upper = String(text || "").toUpperCase();
  if (!upper) return null;

  const patterns = [
    /\b([A-Z]{2}\d{9}[A-Z]{2})\b/g,
    /\b(BR[0-9A-Z]{8,24})\b/g,
    /(?:RASTREIO|TRACK(?:ING)?|OBJETO|CODIGO)\s*[:#-]?\s*([A-Z0-9-]{8,30})/g,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(upper);
    if (match?.[1]) {
      return match[1].replace(/\s+/g, "").trim() || null;
    }
  }

  const candidates = upper.match(/\b[A-Z0-9]{10,25}\b/g) || [];
  const mixed = candidates.find((value) => /[A-Z]/.test(value) && /\d/.test(value));
  return mixed || null;
}

function extractNameAndAddress(text: string): { detectedName: string | null; detectedAddress: string | null; detectedCep: string | null } {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const full = lines.join("\n");
  const cepMatch = full.match(/\b(\d{5})[-\s]?(\d{3})\b/);
  const detectedCep = cepMatch ? `${cepMatch[1]}-${cepMatch[2]}` : null;

  let detectedName: string | null = null;
  const nameLabelIdx = lines.findIndex((line) => /DESTINATARIO|RECEBEDOR|NOME/i.test(line));
  if (nameLabelIdx >= 0 && lines[nameLabelIdx + 1]) {
    detectedName = lines[nameLabelIdx + 1] || null;
  }
  if (!detectedName) {
    detectedName =
      lines.find((line) => {
        const plain = line.replace(/[^A-Za-zÀ-ÿ\s]/g, " ").trim();
        const words = plain.split(/\s+/).filter(Boolean);
        return words.length >= 2 && plain.length >= 8 && plain.length <= 80;
      }) || null;
  }

  const addressLine = lines.find((line) => /\b(RUA|AV\.?|AVENIDA|TRAVESSA|ALAMEDA|LOGRADOURO|N[ÚU]MERO|BAIRRO|CEP)\b/i.test(line));
  const detectedAddress = addressLine || (detectedCep ? lines.find((line) => line.includes(detectedCep.replace("-", "")) || line.includes(detectedCep)) || null : null);

  return {
    detectedName: detectedName ? detectedName.slice(0, 255) : null,
    detectedAddress: detectedAddress ? detectedAddress.slice(0, 500) : null,
    detectedCep,
  };
}

function parseTrackingText(rawText: string): TrackingParseResult {
  const limitedText = String(rawText || "").slice(0, 20000);
  const trackingCode = extractTrackingCode(limitedText);
  const { detectedName, detectedAddress, detectedCep } = extractNameAndAddress(limitedText);
  return { rawText: limitedText, trackingCode, detectedName, detectedAddress, detectedCep };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function normalizeConfidence(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function parseVisionTrackingPayload(rawText: string): TrackingVisionResult {
  const fallback: TrackingVisionResult = {
    rawText: String(rawText || "").slice(0, 20000),
    trackingCode: null,
    detectedName: null,
    detectedAddress: null,
    detectedCep: null,
    confidence: null,
    source: "manual",
  };

  const obj = extractJsonObject(rawText);
  if (!obj) return fallback;

  const trackingCode = normalizeTrackingCode(obj.trackingCode ?? obj.tracking ?? obj.codigoRastreio ?? obj.codigo ?? "");
  const detectedName = String(obj.detectedName ?? obj.name ?? obj.destinatario ?? obj.nome ?? "").trim() || null;
  const detectedAddress = String(obj.detectedAddress ?? obj.address ?? obj.endereco ?? obj.addressLine ?? "").trim() || null;
  const detectedCep = String(obj.detectedCep ?? obj.cep ?? "").trim() || null;
  const confidence = normalizeConfidence(obj.confidence ?? obj.score ?? obj.trust);

  return {
    rawText: fallback.rawText,
    trackingCode: trackingCode || null,
    detectedName: detectedName ? detectedName.slice(0, 255) : null,
    detectedAddress: detectedAddress ? detectedAddress.slice(0, 500) : null,
    detectedCep: detectedCep ? detectedCep.slice(0, 32) : null,
    confidence,
    source: "openai",
  };
}

function normalizeForMatching(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildCandidateAddress(candidate: TrackingMatchCandidateInput): string {
  const cityState = [candidate.addressCity || "", candidate.addressState || ""].filter(Boolean).join("/");
  return [
    candidate.addressStreet,
    candidate.addressNumber,
    candidate.addressComplement,
    candidate.addressNeighborhood,
    cityState,
    candidate.addressCep ? `CEP ${candidate.addressCep}` : "",
  ].filter(Boolean).join(", ");
}

function scoreTrackingCandidateMatch(parsed: TrackingVisionResult, candidate: TrackingMatchCandidateInput): number {
  let score = 0;
  const parsedName = normalizeForMatching(parsed.detectedName);
  const parsedAddress = normalizeForMatching(parsed.detectedAddress);
  const parsedCep = normalizeTrackingCode(parsed.detectedCep || "").replace(/\D/g, "");

  const candidateName = normalizeForMatching(candidate.clientName);
  const candidateAddress = normalizeForMatching(buildCandidateAddress(candidate));
  const candidateCep = normalizeTrackingCode(candidate.addressCep || "").replace(/\D/g, "");

  if (parsedCep && candidateCep) {
    if (parsedCep === candidateCep) score += 200;
    else if (parsedCep.slice(0, 5) === candidateCep.slice(0, 5)) score += 80;
    else if (parsedCep.slice(0, 3) === candidateCep.slice(0, 3)) score += 30;
  }

  if (parsedName && candidateName) {
    const parsedTokens = parsedName.split(" ").filter(Boolean);
    if (parsedTokens.length > 0) {
      const exactMatch = parsedTokens.some((token) => token.length >= 3 && candidateName.includes(token));
      if (exactMatch) score += 120;

      const partialTokens = parsedTokens.filter((token) => token.length >= 2 && candidateName.includes(token));
      score += Math.min(60, partialTokens.length * 15);
    }
  }

  if (parsedAddress && candidateAddress) {
    const parsedTokens = parsedAddress.split(" ").filter(Boolean);
    const hitCount = parsedTokens.filter((token) => token.length >= 3 && candidateAddress.includes(token)).length;
    score += Math.min(45, hitCount * 9);
  }

  if (candidate.enviado) score -= 200;
  if (String(candidate.status || "").toLowerCase() === "cancelled") score -= 300;

  return score;
}

function rankTrackingCandidates(parsed: TrackingVisionResult, candidates: TrackingMatchCandidateInput[]): TrackingMatchCandidateInput[] {
  const scored = candidates.map((candidate) => {
    const score = scoreTrackingCandidateMatch(parsed, candidate);
    return { candidate, score };
  });

  return scored.sort((a, b) => b.score - a.score).map((row) => row.candidate);
}

async function runOpenAIMatchTrackingOrderOnImageDataUrl(params: {
  imageData: string;
  parsed: TrackingVisionResult;
  candidates: TrackingMatchCandidateInput[];
}): Promise<{ matchedOrderId: string | null; confidence: number | null; reason: string | null } | null> {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;

  const model = String(process.env.OPENAI_VISION_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const rankedCandidates = rankTrackingCandidates(params.parsed, params.candidates).slice(0, 20);
  if (rankedCandidates.length === 0) return null;

  const candidateList = rankedCandidates.map((candidate, index) => {
    return [
      `${index + 1}. id=${candidate.id}`,
      `nome=${candidate.clientName || "-"}`,
      `endereco=${buildCandidateAddress(candidate) || "-"}`,
      `cep=${candidate.addressCep || "-"}`,
      `telefone=${candidate.clientPhone || "-"}`,
      `documento=${candidate.clientDocument || "-"}`,
      `status=${candidate.status || "-"}`,
      `enviado=${candidate.enviado ? "sim" : "nao"}`,
    ].join(" | ");
  }).join("\n");

  const prompt = [
    "A imagem mostra uma etiqueta de envio. Compare a etiqueta com a lista de pedidos em aberto e escolha o pedido mais provável.",
    "Retorne SOMENTE JSON válido neste formato:",
    '{"matchedOrderId":"string|null","confidence":0.0,"reason":"string|null"}',
    "Use apenas os pedidos listados abaixo. Se nenhum parecer compatível, retorne matchedOrderId null.",
    `Dados extraídos da etiqueta: ${JSON.stringify({
      trackingCode: params.parsed.trackingCode,
      detectedName: params.parsed.detectedName,
      detectedAddress: params.parsed.detectedAddress,
      detectedCep: params.parsed.detectedCep,
      confidence: params.parsed.confidence,
      source: params.parsed.source,
    })}`,
    "Pedidos candidatos:",
    candidateList,
  ].join(" ");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Você é um assistente que compara etiquetas de envio com pedidos em aberto e escolhe o pedido correto com base em nome, endereço, CEP e rastreio.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: params.imageData, detail: "high" } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!content) return null;

    const obj = extractJsonObject(content);
    if (!obj) return null;

    const matchedOrderId = String(obj.matchedOrderId ?? obj.orderId ?? obj.id ?? "").trim() || null;
    const allowedIds = new Set(rankedCandidates.map((candidate) => candidate.id));
    const confidence = normalizeConfidence(obj.confidence ?? obj.score);
    const reason = String(obj.reason ?? obj.explanation ?? "").trim() || null;

    return {
      matchedOrderId: matchedOrderId && allowedIds.has(matchedOrderId) ? matchedOrderId : null,
      confidence,
      reason,
    };
  } catch {
    return null;
  }
}

function normalizeTrackingCode(raw: unknown): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

function isTrackingCodeValid(value: string): boolean {
  if (!value) return false;
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value)) return true;
  if (/^BR[0-9A-Z]{8,24}$/.test(value)) return true;
  if (/^[A-Z0-9-]{8,30}$/.test(value) && /\d/.test(value)) return true;
  return false;
}

async function runOcrOnImageDataUrl(imageData: string): Promise<string> {
  const apiKey = String(process.env.OCR_SPACE_API_KEY || "").trim();
  if (!apiKey) return "";

  try {
    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        base64Image: imageData,
        language: "por",
        detectOrientation: true,
        scale: true,
        isOverlayRequired: false,
      }),
    });

    if (!response.ok) return "";

    const payload = (await response.json().catch(() => ({}))) as {
      ParsedResults?: Array<{ ParsedText?: string | null }>;
      IsErroredOnProcessing?: boolean;
    };

    if (payload.IsErroredOnProcessing) return "";

    return (payload.ParsedResults || [])
      .map((entry) => String(entry?.ParsedText || ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

async function runOpenAIVisionOnImageDataUrl(imageData: string): Promise<TrackingVisionResult | null> {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;

  const model = String(process.env.OPENAI_VISION_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";

  const prompt = [
    "Analise a etiqueta de envio na imagem.",
    "Extraia apenas dados que estiverem visíveis com alta confiança.",
    "Retorne SOMENTE JSON válido, sem texto adicional, no formato:",
    '{"trackingCode":"string|null","detectedName":"string|null","detectedAddress":"string|null","detectedCep":"string|null","confidence":0.0}',
    "O trackingCode normalmente fica abaixo do código de barras/QR e pode começar com BR.",
    "Se não tiver certeza, use null.",
  ].join(" ");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Você é um extrator de dados de etiquetas de envio. Responda apenas em JSON válido.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData, detail: "high" } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = await response.json().catch(() => ({})) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const content = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!content) return null;

    const parsed = parseVisionTrackingPayload(content);
    const normalizedTracking = parsed.trackingCode ? normalizeTrackingCode(parsed.trackingCode) : "";
    return {
      ...parsed,
      trackingCode: isTrackingCodeValid(normalizedTracking) ? normalizedTracking : null,
      source: "openai",
    };
  } catch {
    return null;
  }
}

function parseBulkDiscountTiers(raw: unknown): BulkDiscountTierInput[] {
  if (!raw) return [];

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];

    const tiers = parsed
      .map((tier) => {
        const item = tier as Record<string, unknown>;
        const minQty = Number(item.minQty);
        const maxQtyRaw = item.maxQty;
        const maxQty = maxQtyRaw == null ? null : Number(maxQtyRaw);
        const unitPrice = Number(item.unitPrice);

        if (!Number.isFinite(minQty) || minQty < 1) return null;
        if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) return null;
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

        return { minQty, maxQty, unitPrice };
      })
      .filter((tier): tier is BulkDiscountTierInput => Boolean(tier));

    return tiers.sort((a, b) => a.minQty - b.minQty);
  } catch {
    return [];
  }
}

function isProductUnavailable(product: {
  isActive: boolean;
  isSoldOut: boolean;
  stock: number | null;
}): boolean {
  if (product.isActive === false) return true;
  return false;
}

function resolveBaseUnitPrice(product: {
  price: string;
  promoPrice: string | null;
  promoEndsAt: Date | null;
}): number {
  const regularPrice = Number(product.price || 0);
  const promoPrice = product.promoPrice == null ? null : Number(product.promoPrice);
  if (!Number.isFinite(promoPrice) || promoPrice == null || promoPrice <= 0) return regularPrice;
  if (product.promoEndsAt && new Date() > product.promoEndsAt) return regularPrice;
  return promoPrice;
}

function resolveUnitPriceForQuantity(product: {
  price: string;
  promoPrice: string | null;
  promoEndsAt: Date | null;
  bulkDiscountEnabled: boolean;
  bulkDiscountTiers: string | null;
}, quantity: number): number {
  const base = resolveBaseUnitPrice(product);
  if (!product.bulkDiscountEnabled) return base;
  const tiers = parseBulkDiscountTiers(product.bulkDiscountTiers);
  if (tiers.length === 0) return base;
  const tier = tiers.find((item) => quantity >= item.minQty && (item.maxQty == null || quantity <= item.maxQty));
  return tier?.unitPrice ?? base;
}

function parseEnabledSetting(value?: string | null): boolean {
  if (value == null || value === "") return true;
  const normalized = String(value).trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

async function isPaymentMethodEnabled(key: "checkout_enable_pix" | "checkout_enable_card" | "checkout_enable_whatsapp", tenantId: string): Promise<boolean> {
  const value = await getSettingValue(key, tenantId);
  return parseEnabledSetting(value ?? null);
}

function buildGuestAccessToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function getHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = String(item || "").trim();
      if (text) return text;
    }
    return "";
  }
  return String(value || "").trim();
}

function pickFirstForwardedIp(value: unknown): string {
  const raw = getHeaderValue(value);
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || "";
}

function getPurchaseIp(req: { ip?: string; headers?: Record<string, unknown> }): string | null {
  const headers = req.headers || {};
  const candidates = [
    pickFirstForwardedIp(headers["cf-connecting-ip"]),
    pickFirstForwardedIp(headers["x-real-ip"]),
    pickFirstForwardedIp(headers["x-forwarded-for"]),
    pickFirstForwardedIp(headers["x-client-ip"]),
    pickFirstForwardedIp(headers["x-original-forwarded-for"]),
    pickFirstForwardedIp(headers["fastly-client-ip"]),
    String(req.ip || "").trim(),
  ];

  const ip = candidates.find((candidate) => candidate && candidate.toLowerCase() !== "unknown") || "";
  return ip ? normalizeIp(ip) : null;
}

function normalizeIp(raw?: string | null): string {
  const normalized = String(raw || "")
    .trim()
    .replace(/^::ffff:/, "")
    .replace(/^\[|\]$/g, "");

  const lowered = normalized.toLowerCase();
  if (!normalized || lowered === "ip_nao_encontrado" || lowered === "unknown") {
    return "";
  }

  return normalized;
}

function ensureSellerScopeOnOrderQuery(
  req: Request,
  res: Response,
): { hasGlobalAccess: boolean; sellerCode: string | null; tenantId: string } | null {
  const scope = getAdminScope(req);
  if (!scope) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return null;
  }
  if (!scope.hasGlobalAccess && !scope.sellerCode) {
    res.status(403).json({ error: "FORBIDDEN", message: "Usuário sem seller vinculado." });
    return null;
  }
  return { hasGlobalAccess: scope.hasGlobalAccess, sellerCode: scope.sellerCode, tenantId: scope.tenantId || DEFAULT_TENANT_ID };
}

function buildOrderTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    // Keep Loja 1 backward compatible while legacy rows are normalized.
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }

  return eq(ordersTable.tenantId, tenantId);
}

function buildAdminOrderWhere(orderId: string, scope: { hasGlobalAccess: boolean; sellerCode: string | null; tenantId: string }) {
  if (scope.hasGlobalAccess) return and(eq(ordersTable.id, orderId), buildOrderTenantWhere(scope.tenantId));
  return and(eq(ordersTable.id, orderId), buildOrderTenantWhere(scope.tenantId), eq(ordersTable.sellerCode, scope.sellerCode!));
}

function buildOpenTrackingCandidatesWhere(scope: { hasGlobalAccess: boolean; sellerCode: string | null; tenantId: string }) {
  if (scope.hasGlobalAccess) {
    return and(
      buildOrderTenantWhere(scope.tenantId),
      inArray(ordersTable.status, ["paid", "completed"]),
      eq(ordersTable.enviado, false),
    );
  }
  return and(
    buildOrderTenantWhere(scope.tenantId),
    eq(ordersTable.sellerCode, scope.sellerCode!),
    inArray(ordersTable.status, ["paid", "completed"]),
    eq(ordersTable.enviado, false),
  );
}

async function fetchOpenTrackingCandidates(scope: { hasGlobalAccess: boolean; sellerCode: string | null; tenantId: string }): Promise<TrackingMatchCandidateInput[]> {
  const dbCandidates = await db
    .select({
      id: ordersTable.id,
      clientName: ordersTable.clientName,
      clientPhone: ordersTable.clientPhone,
      clientDocument: ordersTable.clientDocument,
      addressCep: ordersTable.addressCep,
      addressStreet: ordersTable.addressStreet,
      addressNumber: ordersTable.addressNumber,
      addressComplement: ordersTable.addressComplement,
      addressNeighborhood: ordersTable.addressNeighborhood,
      addressCity: ordersTable.addressCity,
      addressState: ordersTable.addressState,
      status: ordersTable.status,
      enviado: ordersTable.enviado,
    })
    .from(ordersTable)
    .where(buildOpenTrackingCandidatesWhere(scope))
    .orderBy(desc(ordersTable.createdAt))
    .limit(2000);

  return dbCandidates
    .map((row) => ({
      id: row.id,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      clientDocument: row.clientDocument,
      addressCep: row.addressCep,
      addressStreet: row.addressStreet,
      addressNumber: row.addressNumber,
      addressComplement: row.addressComplement,
      addressNeighborhood: row.addressNeighborhood,
      addressCity: row.addressCity,
      addressState: row.addressState,
      status: row.status,
      enviado: !!row.enviado,
    }))
    .filter((candidate) => candidate && typeof candidate.id === "string")
    .filter((candidate) => candidate.enviado !== true)
    .filter((candidate) => String(candidate.status || "").toLowerCase() !== "cancelled");
}

function pickDeterministicTrackingMatch(
  parsed: TrackingVisionResult,
  candidates: TrackingMatchCandidateInput[],
): { matchedOrderId: string | null; confidence: number | null; reason: string | null } | null {
  if (!candidates.length) return null;

  const ranked = rankTrackingCandidates(parsed, candidates).slice(0, 2);
  const best = ranked[0];
  if (!best) return null;

  const bestScore = scoreTrackingCandidateMatch(parsed, best);
  const secondBestScore = ranked[1] ? scoreTrackingCandidateMatch(parsed, ranked[1]) : null;

  const parsedName = normalizeForMatching(parsed.detectedName);
  const parsedAddress = normalizeForMatching(parsed.detectedAddress);
  const parsedCep = normalizeTrackingCode(parsed.detectedCep || "").replace(/\D/g, "");
  const bestName = normalizeForMatching(best.clientName);
  const bestAddress = normalizeForMatching(buildCandidateAddress(best));
  const bestCep = normalizeTrackingCode(best.addressCep || "").replace(/\D/g, "");

  const exactCepMatch = parsedCep && bestCep && parsedCep === bestCep;
  const strongNameMatch = parsedName && bestName && parsedName.split(" ").some((token) => token.length >= 3 && bestName.includes(token));
  const strongAddressMatch = parsedAddress && bestAddress && parsedAddress.split(" ").some((token) => token.length >= 4 && bestAddress.includes(token));
  const clearGap = secondBestScore == null || bestScore >= secondBestScore + 50;

  if (bestScore >= 200 && clearGap) {
    return {
      matchedOrderId: best.id,
      confidence: Math.min(0.99, bestScore / 250),
      reason: exactCepMatch
        ? "Match determinístico por CEP"
        : strongNameMatch
          ? "Match determinístico por nome do destinatário"
          : strongAddressMatch
            ? "Match determinístico por endereço"
            : "Match determinístico por heurística",
    };
  }

  return null;
}

function parseOrderItemsForInventory(raw: unknown): Array<{ productId: string | null; productName: string; quantity: number }> {
  const parsed = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const value = JSON.parse(raw);
            return Array.isArray(value) ? value : [];
          } catch {
            return [];
          }
        })()
      : [];

  const items = parsed
    .map((item) => {
      const row = item as { id?: unknown; name?: unknown; quantity?: unknown };
      return {
        productId: String(row?.id || "").trim() || null,
        productName: String(row?.name || "Produto").trim() || "Produto",
        quantity: Number(row?.quantity || 0),
      };
    })
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);

  const grouped = new Map<string, { productId: string | null; productName: string; quantity: number }>();
  for (const item of items) {
    const key = item.productId ? `id:${item.productId}` : `name:${item.productName.toLowerCase()}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      productId: prev?.productId || item.productId,
      productName: prev?.productName || item.productName,
      quantity: (prev?.quantity || 0) + item.quantity,
    });
  }

  return [...grouped.values()];
}

async function attachLegacyGuestOrdersToCustomer(userId: string, email: string, tenantId: string): Promise<void> {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!userId || !normalizedEmail || !tenantId) return;

  await db
    .update(ordersTable)
    .set({ userId })
    .where(
      and(
        buildOrderTenantWhere(tenantId),
        isNull(ordersTable.userId),
        sql`lower(trim(${ordersTable.clientEmail})) = ${normalizedEmail}`,
      ),
    );
}

// ---------------------------------------------------------------------------
// CSV field escaper — wraps in quotes, escapes internal quotes, strips newlines
// ---------------------------------------------------------------------------
function csvField(value: unknown): string {
  const str = String(value ?? "")
    .replace(/\r?\n/g, " ")   // no newlines inside a field
    .replace(/\r/g, " ");
  // Always wrap in quotes and double any internal quotes
  return `"${str.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// POST /api/orders  — create a new order
// ---------------------------------------------------------------------------
router.post("/orders", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req as any);
    const purchaseIp = getPurchaseIp(req) || "IP_NAO_ENCONTRADO";
    const customerSession = getCustomerSession(req);
    const guestAccessToken = customerSession ? null : buildGuestAccessToken();

    const {
      client, address, products, shippingType, includeInsurance,
      insurancePlan,
      shippingCost,
      paymentMethod, cardInstallments, sellerCode,
      useStoreCredit,
    } = req.body;

    const normalizedAffiliateCode = normalizeAffiliateCode(req.body?.affiliateCode);
    const affiliate = normalizedAffiliateCode
      ? await resolveAffiliateByCode(normalizedAffiliateCode, tenantId)
      : null;
    const affiliateUserId = affiliate?.userId && affiliate.userId !== customerSession?.userId
      ? affiliate.userId
      : null;

    let sellerCommissionRateSnapshot = 0;
    if (sellerCode) {
      const slug = String(sellerCode).toLowerCase();
      const [seller] = await db
        .select({
          hasCommission: sellersTable.hasCommission,
          commissionRate: sellersTable.commissionRate,
        })
        .from(sellersTable)
        .where(and(eq(sellersTable.tenantId, tenantId), eq(sellersTable.slug, slug)));
      if (seller?.hasCommission) {
        sellerCommissionRateSnapshot = Number(seller.commissionRate ?? 0);
      }
    }

    if (!client || !products || !shippingType) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Campos obrigatórios ausentes." });
      return;
    }

    const id     = crypto.randomBytes(8).toString("hex");
    const method = paymentMethod || "pix";

    if (method === "pix") {
      const pixEnabled = await isPaymentMethodEnabled("checkout_enable_pix", tenantId);
      if (!pixEnabled) {
        res.status(403).json({
          error: "PAYMENT_METHOD_DISABLED",
          message: "Pagamento via PIX está temporariamente indisponível.",
        });
        return;
      }
    }

    if (method === "card_simulation") {
      const cardEnabled = await isPaymentMethodEnabled("checkout_enable_card", tenantId);
      if (!cardEnabled) {
        res.status(403).json({
          error: "PAYMENT_METHOD_DISABLED",
          message: "Pagamento via cartão está temporariamente indisponível.",
        });
        return;
      }
    }

    if (method === "whatsapp_pix") {
      const whatsappEnabled = await isPaymentMethodEnabled("checkout_enable_whatsapp", tenantId);
      if (!whatsappEnabled) {
        res.status(403).json({
          error: "PAYMENT_METHOD_DISABLED",
          message: "Pagamento via WhatsApp está temporariamente indisponível.",
        });
        return;
      }
    }

    const productItems = Array.isArray(products) ? (products as OrderProductInput[]) : [];
    if (productItems.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Carrinho vazio." });
      return;
    }

    const productIds = Array.from(new Set(productItems.map((p: { id?: string }) => String(p?.id || "")).filter(Boolean)));
    let productRows = new Map<string, typeof productsTable.$inferSelect>();
    if (productIds.length > 0) {
      const rows = await db
        .select()
        .from(productsTable)
        .where(and(eq(productsTable.tenantId, tenantId), inArray(productsTable.id, productIds)));
      productRows = new Map(rows.map((row) => [row.id, row]));
    }

    const unavailableProducts: string[] = [];
    const priceChanges: Array<{ id: string; name: string; sentPrice: number; currentPrice: number }> = [];
    const orderProducts = productItems
      .map((item) => {
        const productId = String(item.id || "").trim();
        const quantity = Number(item.quantity) || 0;
        if (!productId || quantity <= 0) return null;

        const current = productRows.get(productId);
        if (!current || isProductUnavailable(current)) {
          unavailableProducts.push(productId);
          return null;
        }

        const sentUnitPrice = Number(item.price) || 0;
        const isBump = item.isBump === true;
        const serverUnitPrice = isBump ? sentUnitPrice : resolveUnitPriceForQuantity(current, quantity);
        const selectedVariants = normalizeOrderItemVariants(item.selectedVariants);
        const variantLabel = String(item.variantLabel || "").trim() || buildVariantLabel(selectedVariants);
        const rawName = String(item.name || current.name || "Produto");
        const productName = variantLabel && !rawName.includes(variantLabel)
          ? `${rawName} - ${variantLabel}`
          : rawName;

        if (!isBump && Math.abs(sentUnitPrice - serverUnitPrice) > 0.001) {
          priceChanges.push({
            id: productId,
            name: current.name,
            sentPrice: sentUnitPrice,
            currentPrice: serverUnitPrice,
          });
        }

        return {
          id: productId,
          name: productName,
          quantity,
          price: serverUnitPrice,
          costPrice: Number(current.costPrice || 0),
          selectedVariants: selectedVariants.length > 0 ? selectedVariants : undefined,
          variantLabel: variantLabel || undefined,
        };
      })
      .filter((item): item is {
        id: string;
        name: string;
        quantity: number;
        price: number;
        costPrice: number;
        selectedVariants?: Array<{ groupName: string; option: string }>;
        variantLabel?: string;
      } => Boolean(item));

    if (unavailableProducts.length > 0) {
      res.status(400).json({
        error: "UNAVAILABLE_PRODUCT",
        message: "Um ou mais produtos não estão mais disponíveis.",
      });
      return;
    }

    if (priceChanges.length > 0) {
      res.status(409).json({
        error: "PRICE_CHANGED",
        message: "Os preços do carrinho foram atualizados. Revise e tente novamente.",
        items: priceChanges,
      });
      return;
    }

    if (isMotoboyShippingType(shippingType)) {
      const eligibleRaw = await getSettingValue("motoboy_eligible_product_ids", tenantId);
      if (!isCartEligibleForMotoboy(cartProductIdsFromItems(orderProducts), eligibleRaw)) {
        res.status(400).json({
          error: "MOTOBOY_NOT_ELIGIBLE",
          message: "Este carrinho não é elegível para entrega por motoboy.",
        });
        return;
      }
    }

    const computedSubtotal = orderProducts.reduce((acc: number, p: { quantity?: number; price?: number }) => {
      const qty = Number(p.quantity) || 0;
      const price = Number(p.price) || 0;
      return acc + qty * price;
    }, 0);
    const shippingBaseCost = Math.max(0, Number(shippingCost) || 0);
    const freeShippingMinSubtotal = await getFreeShippingMinSubtotal(
      tenantId,
      shippingType,
      req.body?.motoboySchedule?.neighborhoodId,
    );
    const computedShippingCost = resolveShippingCostWithFreeThreshold({
      subtotal: computedSubtotal,
      shippingBaseCost,
      freeShippingMinSubtotal,
    });
    const couponOrderValue = computedSubtotal + computedShippingCost;

    let normalizedCouponCode: string | null = null;
    let computedDiscountAmount = 0;
    const rawCouponCode = req.body.couponCode ? String(req.body.couponCode).trim().toUpperCase() : "";
    if (rawCouponCode) {
      const [coupon] = await db
        .select()
        .from(couponsTable)
        .where(and(eq(couponsTable.tenantId, tenantId), eq(couponsTable.code, rawCouponCode)));
      if (!coupon) {
        res.status(400).json({ error: "INVALID_COUPON", message: "Cupom não encontrado." });
        return;
      }
      const evaluation = evaluateCouponForProducts(coupon, orderProducts, couponOrderValue);
      if (!evaluation.valid) {
        res.status(400).json({
          error: evaluation.error || "INVALID_COUPON",
          message: evaluation.message || "Cupom inválido para este carrinho.",
        });
        return;
      }
      normalizedCouponCode = rawCouponCode;
      computedDiscountAmount = evaluation.discountAmount;
    }

    const insuranceSettings = await loadCheckoutInsuranceSettings((key) => getSettingValue(key, tenantId));
    const insurance = resolveCheckoutInsurance({
      includeInsurance,
      insurancePlan,
      subtotal: computedSubtotal,
      shippingCost: computedShippingCost,
      discountAmount: computedDiscountAmount,
      lines: insuranceLinesFromProducts(orderProducts),
      settings: insuranceSettings,
    });
    const computedInsuranceAmount = insurance.insuranceAmount;
    const computedTotal = insurance.total;
    if (!computedTotal || computedTotal <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor inválido. Deve ser maior que zero." });
      return;
    }

    let assignedOrderNumber = 0;
    await db.transaction(async (tx) => {
      assignedOrderNumber = await reserveNextOrderNumber(tx, tenantId);
      const motoboySchedule = isMotoboyShippingType(shippingType)
        ? await reserveMotoboySchedule(tx, tenantId, id, req.body?.motoboySchedule || {})
        : null;

      await tx.insert(ordersTable).values({
        id,
        orderNumber: assignedOrderNumber,
        tenantId,
        userId: customerSession?.userId ?? null,
        guestAccessToken,
        affiliateUserId,
        affiliateCode: affiliateUserId ? normalizedAffiliateCode : null,
        clientName:          client.name,
        clientEmail:         client.email,
        clientPhone:         client.phone,
        clientDocument:      client.document,
        purchaseIp,
        addressCep:          address?.cep          || null,
        addressStreet:       address?.street       || null,
        addressNumber:       address?.number       || null,
        addressComplement:   address?.complement   || null,
        addressNeighborhood: address?.neighborhood || null,
        addressCity:         address?.city         || null,
        addressState:        address?.state        || null,
        products: orderProducts,
        shippingType,
        motoboyDeliveryDate: motoboySchedule?.date || null,
        motoboyDeliveryTime: motoboySchedule?.time || null,
        motoboyDeliveryDurationHours: motoboySchedule?.durationHours || null,
        ...insuranceSnapshotColumns(insurance),
        subtotal:          String(computedSubtotal),
        shippingCost:      String(computedShippingCost),
        total:             String(computedTotal),
        status:            method === "card_simulation" ? "awaiting_payment" : "pending",
        paymentMethod:     method,
        cardInstallments:  cardInstallments ? Number(cardInstallments) : null,
        sellerCode:        sellerCode ? String(sellerCode) : null,
        sellerCommissionRateSnapshot: String(sellerCommissionRateSnapshot),
        couponCode:        normalizedCouponCode,
        discountAmount:    computedDiscountAmount > 0 ? String(computedDiscountAmount) : null,
      });
    });

    let storeCreditUsed = 0;
    if (useStoreCredit === true && customerSession?.userId) {
      storeCreditUsed = await applyStoreCreditToOrder({
        tenantId,
        userId: customerSession.userId,
        orderId: id,
        requestedAmount: computedTotal,
      });
      if (storeCreditUsed > 0) {
        const payableAfterStore = Math.max(0, computedTotal - storeCreditUsed);
        await db.update(ordersTable).set({
          total: String(payableAfterStore),
          storeCreditUsed: String(storeCreditUsed),
          paymentMethod: payableAfterStore <= 0 ? "store_credit" : method,
          status: payableAfterStore <= 0 ? "paid" : (method === "card_simulation" ? "awaiting_payment" : "pending"),
          updatedAt: new Date(),
        }).where(eq(ordersTable.id, id));
      }
    }

    // Geo lookup — fire and forget, não bloqueia a resposta
    lookupIpGeo(purchaseIp).then((geo) => {
      if (!geo) return;
      db.update(ordersTable)
        .set({ ipCity: geo.city, ipRegion: geo.region, ipIsp: geo.isp, ipIsProxy: geo.isProxy })
        .where(and(eq(ordersTable.id, id), buildOrderTenantWhere(tenantId)))
        .catch(() => {});
    }).catch(() => {});

    if (affiliateUserId) {
      await registerAffiliateLead({
        tenantId,
        affiliateUserId,
        referredUserId: customerSession?.userId ?? null,
        referredEmail: client?.email ?? null,
      });
    }

    broadcastNotification({
      type: "new_order",
      data: {
        id,
        clientName: client.name,
        total: computedTotal,
        paymentMethod: method,
        sellerCode: sellerCode || null,
        tenantId,
        createdAt: new Date().toISOString(),
      },
    });
    void sendOutboundWebhook("new_order", {
      id,
      clientName: client.name,
      total: computedTotal,
      paymentMethod: method,
      sellerCode: sellerCode || null,
      createdAt: new Date().toISOString(),
    }, { tenantId });

    res.status(201).json({
      id,
      orderNumber: assignedOrderNumber,
      client, address: address || null, products: orderProducts, shippingType,
      includeInsurance: insurance.includeInsurance,
      insurancePlan: insurance.plan === "none" ? null : insurance.plan,
      subtotal: computedSubtotal,
      shippingCost: computedShippingCost,
      insuranceAmount: computedInsuranceAmount,
      insuranceKeepAmount: insurance.keepAmount,
      insuranceCashbackAmount: insurance.cashbackAmount,
      storeCreditUsed: storeCreditUsed > 0 ? storeCreditUsed : null,
      total: Math.max(0, computedTotal - storeCreditUsed),
      status:        method === "card_simulation" ? "awaiting_payment" : "pending",
      paymentMethod: method,
      sellerCode:    sellerCode || null,
      affiliateCode: affiliateUserId ? normalizedAffiliateCode : null,
      guestAccessToken,
      isGuestOrder: !customerSession,
      createdAt:     new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof MotoboyScheduleError) {
      res.status(err.code === "DELIVERY_SLOT_UNAVAILABLE" ? 409 : 400).json({ error: err.code, message: err.message });
      return;
    }
    console.error("Create order error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar pedido. Tente novamente." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/me/orders  (protected customer route)
// ---------------------------------------------------------------------------
router.get("/me/orders", requireCustomerAuth, async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req as any);
    const customerSession = getCustomerSession(req);
    if (!customerSession) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    await attachLegacyGuestOrdersToCustomer(customerSession.userId, customerSession.email, tenantId);

    const orders = await db
      .select()
      .from(ordersTable)
      .where(and(buildOrderTenantWhere(tenantId), eq(ordersTable.userId, customerSession.userId)))
      .orderBy(desc(ordersTable.createdAt));

    res.json({ orders: orders.map(mapOrder) });
  } catch (err) {
    console.error("Customer orders error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pedidos." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/me/orders/:id  (protected customer route)
// ---------------------------------------------------------------------------
router.get("/me/orders/:id", requireCustomerAuth, async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req as any);
    const customerSession = getCustomerSession(req);
    if (!customerSession) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    await attachLegacyGuestOrdersToCustomer(customerSession.userId, customerSession.email, tenantId);

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    let orderId = id;
    if (Array.isArray(orderId)) orderId = orderId[0];
    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), buildOrderTenantWhere(tenantId), eq(ordersTable.userId, customerSession.userId)))
      .limit(1);

    if (!rows[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    res.json({ order: mapOrder(rows[0]) });
  } catch (err) {
    console.error("Customer order detail error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pedido." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/guest/:id?token=...  (public guest route)
// ---------------------------------------------------------------------------
router.get("/orders/guest/:id", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req as any);
    const { id } = req.params;
    const token = String((req.query as Record<string, string>).token || "").trim();

    if (!token) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Token de acesso é obrigatório." });
      return;
    }

    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.id, id), buildOrderTenantWhere(tenantId), eq(ordersTable.guestAccessToken, token)))
      .limit(1);

    if (!rows[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    res.json({ order: mapOrder(rows[0]) });
  } catch (err) {
    console.error("Guest order access error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pedido." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/orders  (protected)
// ---------------------------------------------------------------------------
router.get("/admin/orders", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    const { dateFrom, dateTo, status, paymentMethod, sellerCode, whatsappGroup, pinReshipments } = req.query as Record<string, string>;
    const shouldPinReshipments = pinReshipments !== "0";

    // São Paulo = UTC-3: midnight SP = 03:00 UTC; end-of-day SP 23:59:59 = next day 02:59:59 UTC
    const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
    const dateConditions = [];
    const nonDateConditions = [];
    if (dateFrom) {
      const from = new Date(dateFrom + "T00:00:00.000Z");
      from.setTime(from.getTime() + SP_OFFSET_MS);
      dateConditions.push(gte(ordersTable.createdAt, from));
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59.999Z");
      to.setTime(to.getTime() + SP_OFFSET_MS);
      dateConditions.push(lte(ordersTable.createdAt, to));
    }
    if (status && status !== "all") {
      if (status === "paid") nonDateConditions.push(inArray(ordersTable.status, ["paid", "completed"]));
      else nonDateConditions.push(eq(ordersTable.status, status));
    }
    if (paymentMethod && paymentMethod !== "all") nonDateConditions.push(eq(ordersTable.paymentMethod, paymentMethod));
    if (whatsappGroup && whatsappGroup !== "all") nonDateConditions.push(eq(ordersTable.whatsappGroup, whatsappGroup));
    nonDateConditions.push(buildOrderTenantWhere(adminScope.tenantId));
    if (!adminScope.hasGlobalAccess) {
      if (sellerCode && sellerCode !== "all" && sellerCode !== adminScope.sellerCode) {
        res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para acessar outro seller." });
        return;
      }
      nonDateConditions.push(eq(ordersTable.sellerCode, adminScope.sellerCode!));
    } else if (sellerCode && sellerCode !== "all") {
      nonDateConditions.push(eq(ordersTable.sellerCode, sellerCode));
    }

    const conditions = [...dateConditions, ...nonDateConditions];

    const baseOrders = await db
      .select()
      .from(ordersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ordersTable.createdAt));

    // Keep active reshipments visible in Orders even if the order is outside the current date range.
    let orders = baseOrders;
    if (shouldPinReshipments && dateConditions.length > 0) {
      const activeReshipments = await db
        .select({ orderId: reshipmentsTable.orderId })
        .from(reshipmentsTable)
        .where(inArray(reshipmentsTable.status, ["reenvio_aguardando_estoque", "reenvio_pronto_para_envio"]));

      const baseOrderIds = new Set(baseOrders.map((o) => o.id));
      const activeOrderIds = Array.from(new Set(activeReshipments.map((r) => r.orderId))).filter((id) => !baseOrderIds.has(id));

      if (activeOrderIds.length > 0) {
        const extraWhere = nonDateConditions.length > 0
          ? and(inArray(ordersTable.id, activeOrderIds), ...nonDateConditions)
          : inArray(ordersTable.id, activeOrderIds);

        const extraOrders = await db
          .select()
          .from(ordersTable)
          .where(extraWhere)
          .orderBy(desc(ordersTable.createdAt));

        orders = [...baseOrders, ...extraOrders];
      }
    }

    const reshipmentByOrder = await getReshipmentByOrderIds(orders.map((o) => o.id), adminScope.tenantId);
    const priorityByOrder = await loadOrderPriorityMap(orders.map((o) => o.id));
    const searchingProductByOrder = await loadOrderSearchingProductMap(orders.map((o) => o.id));
    const orderIds = orders.map((order) => order.id);
    const logisticsAllocations = orderIds.length > 0
      ? await db.select().from(orderLogisticsAllocationsTable).where(and(
          eq(orderLogisticsAllocationsTable.tenantId, adminScope.tenantId),
          eq(orderLogisticsAllocationsTable.status, "allocated"),
          inArray(orderLogisticsAllocationsTable.orderId, orderIds),
        ))
      : [];
    const logisticsByOrder = new Map(logisticsAllocations.map((allocation) => [allocation.orderId, allocation] as const));

    const enriched = orders.map((order) => {
      const manualPriority = priorityByOrder.get(order.id) ?? false;
      const automaticPriority = shouldAutoPrioritizeOrder({
        status: order.status,
        enviado: !!order.enviado,
        createdAt: order.createdAt,
      });
      const ipCity   = String((order as any).ipCity   || "").trim().toLowerCase();
      const ipRegion = String((order as any).ipRegion || "").trim().toLowerCase();
      const addrCity = String(order.addressCity  || "").trim().toLowerCase();
      const addrState= String(order.addressState || "").trim().toLowerCase();
      const hasGeo   = ipCity !== "" || ipRegion !== "";
      const hasAddr  = addrCity !== "" || addrState !== "";

      let purchaseRisk: "low" | "medium" | "high";
      let purchaseRiskReason: string;

      if (!hasGeo || !hasAddr) {
        // Sem dados de geolocalização ou endereço — não é possível comparar
        purchaseRisk = "medium";
        purchaseRiskReason = !hasGeo
          ? "Geolocalização do IP indisponível"
          : "Endereço do pedido não informado";
      } else {
        const cityMatch  = ipCity   !== "" && addrCity  !== "" && (addrCity.includes(ipCity)  || ipCity.includes(addrCity));
        const stateMatch = ipRegion !== "" && addrState !== "" && (ipRegion.includes(addrState) || addrState.includes(ipRegion));

        if (cityMatch) {
          purchaseRisk = "low";
          purchaseRiskReason = `Cidade do IP bate com o endereço (${(order as any).ipCity} / ${order.addressCity})`;
        } else if (stateMatch) {
          purchaseRisk = "medium";
          purchaseRiskReason = `Estado bate, cidade diverge (IP: ${(order as any).ipCity || ipRegion}, pedido: ${order.addressCity})`;
        } else {
          purchaseRisk = "high";
          purchaseRiskReason = `Localização não bate com o endereço (IP: ${(order as any).ipCity || (order as any).ipRegion}, pedido: ${order.addressCity}/${order.addressState})`;
        }
      }

      return {
        ...mapOrder(order, { light: true }),
        logisticsAllocation: logisticsByOrder.get(order.id) || null,
        isPrioridade: !order.enviado && (manualPriority || automaticPriority),
        isProcurandoProduto: searchingProductByOrder.get(order.id) ?? false,
        priorityManual: manualPriority,
        priorityAutomatic: automaticPriority,
        prioritySource: manualPriority ? "manual" : automaticPriority ? "automatic" : null,
        purchaseRisk,
        purchaseRiskReason,
        reshipment: reshipmentByOrder.get(order.id) || null,
      };
    });

    // Prioritize cards that still need resend handling at the top of the list.
    const prioritized = [...enriched].sort((a, b) => {
      const aActive = a.reshipment?.status === "reenvio_aguardando_estoque" || a.reshipment?.status === "reenvio_pronto_para_envio";
      const bActive = b.reshipment?.status === "reenvio_aguardando_estoque" || b.reshipment?.status === "reenvio_pronto_para_envio";
      if (aActive !== bActive) return bActive ? 1 : -1;

      const aPriority = !!a.isPrioridade;
      const bPriority = !!b.isPrioridade;
      if (aPriority !== bPriority) return bPriority ? 1 : -1;

      const aTime = Date.parse(a.createdAt || "");
      const bTime = Date.parse(b.createdAt || "");
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });

    res.json({ orders: prioritized });
  } catch (err) {
    console.error("Admin orders error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pedidos." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/orders/:id  (protected) — mídia completa do card
// ---------------------------------------------------------------------------
router.get("/admin/orders/:id", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];

    const rows = await db
      .select()
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);

    if (!rows[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    res.json({ order: mapOrder(rows[0]) });
  } catch (err) {
    console.error("Admin order detail error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pedido." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/status  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/status", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { status, cardInstallmentsActual, cardInstallmentValue, cardTotalActual, adminPassword } = req.body as {
      status: string;
      cardInstallmentsActual?: number;
      cardInstallmentValue?: number;
      cardTotalActual?: number;
      adminPassword?: string;
    };

    const allowed = ["pending", "awaiting_payment", "paid", "cancelled", "completed"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "INVALID_STATUS", message: "Status inválido." });
      return;
    }

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (cardInstallmentsActual !== undefined) updates.cardInstallmentsActual = Number(cardInstallmentsActual);
    if (cardInstallmentValue !== undefined) updates.cardInstallmentValue = String(cardInstallmentValue);
    if (cardTotalActual !== undefined) updates.cardTotalActual = String(cardTotalActual);

    const existing = await db
      .select({ status: ordersTable.status, couponCode: ordersTable.couponCode, total: ordersTable.total, paidAmount: ordersTable.paidAmount })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    const currentStatus = String(existing[0]?.status || "").trim().toLowerCase();
    const nextStatus = String(status || "").trim().toLowerCase();
    const wasAlreadyPaid = currentStatus === "paid" || currentStatus === "completed";
    const isBeingPaid = nextStatus === "paid" || nextStatus === "completed";

    if (wasAlreadyPaid && !isBeingPaid) {
      const providedPassword = String(adminPassword || "").trim();
      if (!providedPassword) {
        res.status(403).json({ error: "PASSWORD_REQUIRED", message: "Senha do admin é obrigatória para desfazer status pago." });
        return;
      }
      const passwordOk = await verifyCurrentAdminPassword(req, providedPassword);
      if (!passwordOk) {
        res.status(403).json({ error: "INVALID_ADMIN_PASSWORD", message: "Senha do admin inválida." });
        return;
      }
      console.warn("[SECURITY] Status rollback autorizado por senha", {
        orderId: id,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        admin: (req as any).adminSession?.username || "unknown",
      });
    }

    let couponCodeToIncrement: string | null = null;
    if (isBeingPaid) {
      if (!wasAlreadyPaid && existing[0]?.couponCode) {
        couponCodeToIncrement = existing[0].couponCode;
      }
      // Manual paid/completed confirmation should reflect at least the current order total.
      const currentTotal = Number(existing[0]?.total ?? 0);
      const currentPaidAmount = Number(existing[0]?.paidAmount ?? 0);
      const reconciledPaidAmount = Math.max(currentPaidAmount, currentTotal);
      if (reconciledPaidAmount > 0) {
        updates.paidAmount = String(reconciledPaidAmount);
      }
    }

    const updateResult = await db.update(ordersTable).set(updates).where(buildAdminOrderWhere(id, adminScope));
    if ((updateResult as any).rowsAffected === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    if (nextStatus === "cancelled") {
      await db.delete(motoboyDeliveryReservationsTable).where(and(
        eq(motoboyDeliveryReservationsTable.orderId, id),
        eq(motoboyDeliveryReservationsTable.tenantId, adminScope.tenantId),
      ));
    }
    if (!isBeingPaid) {
      await releaseOrderLogistics(id, adminScope.tenantId);
    }

    if (couponCodeToIncrement) {
      await incrementCouponUse(couponCodeToIncrement, adminScope.tenantId);
    }

    if (isBeingPaid) {
      await ensureOrderCommission(id);
      await allocateOrderLogistics(id);
      if (!wasAlreadyPaid) {
        await enqueueFilialOrderPurchaseRequest(id);
      }
    }

    broadcastNotification({ type: "order_status_updated", data: { id, status, tenantId: adminScope.tenantId } });
    res.json({ ok: true, id, status });
  } catch (err) {
    console.error("Update order status error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar status." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/observation  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/observation", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { observation } = req.body as { observation?: string };
    await db.update(ordersTable)
      .set({ observation: observation?.trim() || null, updatedAt: new Date() })
      .where(buildAdminOrderWhere(id, adminScope));
    res.json({ ok: true });
  } catch (err) {
    console.error("Update observation error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar observação." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/whatsapp-group  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/whatsapp-group", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];

    const rawGroup = req.body?.whatsappGroup;
    let normalizedGroup: string | null = null;
    if (rawGroup !== undefined && rawGroup !== null) {
      const parsed = String(rawGroup).trim().toLowerCase().replace(/\s+/g, "_");
      if (parsed.length > 0) {
        if (!/^[a-z0-9_-]{1,64}$/.test(parsed)) {
          res.status(400).json({ error: "INVALID_INPUT", message: "Grupo inválido. Use apenas letras, números, _ ou -." });
          return;
        }
        normalizedGroup = parsed;
      }
    }

    const existing = await db.select({ id: ordersTable.id }).from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    await db
      .update(ordersTable)
      .set({ whatsappGroup: normalizedGroup, updatedAt: new Date() })
      .where(buildAdminOrderWhere(id, adminScope));

    const updated = await db.select().from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    if (!updated[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    res.json({ ok: true, order: mapOrder(updated[0]) });
  } catch (err) {
    console.error("Update whatsapp group error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar grupo do pedido." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/proof  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/proof", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { proofData } = req.body as { proofData: string };

    if (!proofData) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Comprovante obrigatório." });
      return;
    }

    const existing = await db
      .select({ proofUrl: ordersTable.proofUrl, proofUrls: ordersTable.proofUrls, total: ordersTable.total, paidAmount: ordersTable.paidAmount, status: ordersTable.status })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    let urls: string[] = [];
    if (existing[0]?.proofUrls) {
      try { urls = JSON.parse(existing[0].proofUrls); } catch { urls = []; }
    }
    if (existing[0]?.proofUrl && !urls.includes(existing[0].proofUrl)) {
      urls.unshift(existing[0].proofUrl);
    }
    if (!urls.includes(proofData)) urls.push(proofData);

    // Proof upload means payment was confirmed; reconcile paidAmount with at least the current total.
    const proofCurrentTotal = Number(existing[0]?.total ?? 0);
    const proofCurrentPaid = Number(existing[0]?.paidAmount ?? 0);
    const proofPaidAmount = Math.max(proofCurrentPaid, proofCurrentTotal);

    await db.update(ordersTable)
      .set({ proofUrl: proofData, proofUrls: JSON.stringify(urls), status: "completed", paidAmount: String(proofPaidAmount), updatedAt: new Date() })
      .where(buildAdminOrderWhere(id, adminScope));

    await ensureOrderCommission(id);
    await allocateOrderLogistics(id);
    const priorStatus = String(existing[0]?.status || "").trim().toLowerCase();
    if (priorStatus !== "paid" && priorStatus !== "completed") {
      await enqueueFilialOrderPurchaseRequest(id);
    }

    broadcastNotification({ type: "order_status_updated", data: { id, status: "completed", tenantId: adminScope.tenantId } });
    res.json({ ok: true, proofUrls: urls });
  } catch (err) {
    console.error("Upload proof error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar comprovante." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/orders/:id/proof/:index  (protected)
// ---------------------------------------------------------------------------
router.delete("/admin/orders/:id/proof/:index", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const proofIndex = Number(Array.isArray(req.params.index) ? req.params.index[0] : req.params.index);
    if (!Number.isInteger(proofIndex) || proofIndex < 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Comprovante inválido." });
      return;
    }

    const [existing] = await db
      .select({ proofUrl: ordersTable.proofUrl, proofUrls: ordersTable.proofUrls })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    let urls: string[] = [];
    if (existing.proofUrls) {
      try { urls = JSON.parse(existing.proofUrls); } catch { urls = []; }
    }
    if (existing.proofUrl && !urls.includes(existing.proofUrl)) urls.unshift(existing.proofUrl);
    if (proofIndex >= urls.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Comprovante não encontrado." });
      return;
    }

    urls.splice(proofIndex, 1);
    const proofUrl = urls.at(-1) || null;
    await db
      .update(ordersTable)
      .set({ proofUrl, proofUrls: JSON.stringify(urls), updatedAt: new Date() })
      .where(buildAdminOrderWhere(id, adminScope));

    res.json({ ok: true, proofUrl, proofUrls: urls });
  } catch (err) {
    console.error("Delete proof error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao remover comprovante." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/edit  (protected, full-access only)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/edit", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;
    if (!adminScope.hasGlobalAccess) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para editar pedidos." });
      return;
    }

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { products: newProducts, address, discountAmount, clientName, clientPhone, clientEmail, clientDocument } = req.body as {
      products: Array<{ id: string; name: string; quantity: number; price: number }>;
      discountAmount?: number;
      clientName?: string;
      clientPhone?: string;
      clientEmail?: string;
      clientDocument?: string;
      address?: {
        cep?: string | null;
        street?: string | null;
        number?: string | null;
        complement?: string | null;
        neighborhood?: string | null;
        city?: string | null;
        state?: string | null;
      };
    };

    const nextClientName = clientName !== undefined ? String(clientName || "").trim() : undefined;
    if (nextClientName !== undefined && !nextClientName) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Nome do cliente inválido." });
      return;
    }
    const nextClientPhone = clientPhone !== undefined ? String(clientPhone || "").trim() : undefined;
    if (nextClientPhone !== undefined && !nextClientPhone) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Telefone do cliente inválido." });
      return;
    }
    const nextClientEmail = clientEmail !== undefined ? String(clientEmail || "").trim().toLowerCase() : undefined;
    if (nextClientEmail !== undefined && !nextClientEmail) {
      res.status(400).json({ error: "INVALID_INPUT", message: "E-mail do cliente inválido." });
      return;
    }
    const nextClientDocument = clientDocument !== undefined ? String(clientDocument || "").trim() : undefined;

    if (!newProducts || !Array.isArray(newProducts) || newProducts.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Produtos inválidos." });
      return;
    }

    // Read current order to decide if status should change
    const current = await db.select().from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    if (!current[0]) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const currentTotal   = Number(current[0].total);
    const currentStatus  = current[0].status;
    const paidAmount     = current[0].paidAmount ? Number(current[0].paidAmount) : null;
    const isPaid         = currentStatus === "paid" || currentStatus === "completed";

    // Fetch catalog products to resolve prices with bulk-discount tiers
    const editProductIds = Array.from(new Set(newProducts.map((p) => String(p?.id || "")).filter(Boolean)));
    let editProductRows = new Map<string, typeof productsTable.$inferSelect>();
    if (editProductIds.length > 0) {
      const rows = await db.select().from(productsTable).where(inArray(productsTable.id, editProductIds));
      editProductRows = new Map(rows.map((row) => [row.id, row]));
    }

    // Resolve final products with correct tier prices
    const resolvedProducts = newProducts.map((item) => {
      const productId = String(item?.id || "").trim();
      const quantity = Number(item?.quantity) || 0;
      const catalogProduct = editProductRows.get(productId);
      // If product exists in catalog, recalculate price with tiers; otherwise keep sent price (manual/bump items)
      const price = catalogProduct ? resolveUnitPriceForQuantity(catalogProduct, quantity) : Number(item?.price) || 0;
      return { id: productId, name: String(item?.name || "Produto"), quantity, price };
    }).filter((item) => item.id && item.quantity > 0);

    const computedSubtotal = resolvedProducts.reduce((sum, product) => {
      return sum + product.quantity * product.price;
    }, 0);
    const computedShippingCost = Math.max(0, Number(current[0].shippingCost) || 0);
    const computedDiscountAmount = discountAmount !== undefined
      ? Math.max(0, Number(discountAmount) || 0)
      : Math.max(0, Number(current[0].discountAmount) || 0);
    const insuranceSettings = await loadCheckoutInsuranceSettings((key) => getSettingValue(key, adminScope.tenantId));
    const insurance = resolveCheckoutInsurance({
      includeInsurance: current[0].includeInsurance,
      insurancePlan: current[0].insurancePlan,
      subtotal: computedSubtotal,
      shippingCost: computedShippingCost,
      discountAmount: computedDiscountAmount,
      lines: insuranceLinesFromProducts(resolvedProducts),
      settings: insuranceSettings,
      honorToggles: false,
    });
    const computedInsuranceAmount = insurance.insuranceAmount;
    const total = insurance.total;

    let newStatus: string;
    if (paidAmount !== null) {
      // Order has a recorded paid amount — use it as the reference for all comparisons
      if (total > paidAmount + 0.01) {
        // New total exceeds what was paid → wait for the difference
        newStatus = "awaiting_payment";
      } else {
        // New total is at or below what was paid → fully paid again
        newStatus = "paid";
      }
    } else if (isPaid && total > currentTotal + 0.01) {
      // Paid order (no paidAmount recorded yet) edited UP → flag for difference
      newStatus = "awaiting_payment";
    } else {
      // Unpaid order or no change in direction — keep current status
      newStatus = currentStatus;
    }

    const nextAddressCep = address?.cep !== undefined ? String(address.cep || "").trim() || null : undefined;
    const nextAddressStreet = address?.street !== undefined ? String(address.street || "").trim() || null : undefined;
    const nextAddressNumber = address?.number !== undefined ? String(address.number || "").trim() || null : undefined;
    const nextAddressComplement = address?.complement !== undefined ? String(address.complement || "").trim() || null : undefined;
    const nextAddressNeighborhood = address?.neighborhood !== undefined ? String(address.neighborhood || "").trim() || null : undefined;
    const nextAddressCity = address?.city !== undefined ? String(address.city || "").trim() || null : undefined;
    const nextAddressState = address?.state !== undefined ? String(address.state || "").trim() || null : undefined;

    const updates: Partial<typeof ordersTable.$inferInsert> = {
      products: resolvedProducts,
      subtotal: String(computedSubtotal),
      insuranceAmount: String(computedInsuranceAmount),
      insuranceKeepAmount: String(insurance.keepAmount),
      insuranceCashbackAmount: String(insurance.cashbackAmount),
      includeInsurance: insurance.includeInsurance,
      insurancePlan: insurance.plan === "none" ? null : insurance.plan,
      discountAmount: String(computedDiscountAmount),
      total: String(total),
      status: newStatus,
      updatedAt: new Date(),
    };

    if (nextAddressCep !== undefined) updates.addressCep = nextAddressCep;
    if (nextAddressStreet !== undefined) updates.addressStreet = nextAddressStreet;
    if (nextAddressNumber !== undefined) updates.addressNumber = nextAddressNumber;
    if (nextAddressComplement !== undefined) updates.addressComplement = nextAddressComplement;
    if (nextAddressNeighborhood !== undefined) updates.addressNeighborhood = nextAddressNeighborhood;
    if (nextAddressCity !== undefined) updates.addressCity = nextAddressCity;
    if (nextAddressState !== undefined) updates.addressState = nextAddressState;
    if (nextClientName !== undefined) updates.clientName = nextClientName;
    if (nextClientPhone !== undefined) updates.clientPhone = nextClientPhone;
    if (nextClientEmail !== undefined) updates.clientEmail = nextClientEmail;
    if (nextClientDocument !== undefined) updates.clientDocument = nextClientDocument;

    await db.update(ordersTable)
      .set(updates)
      .where(buildAdminOrderWhere(id, adminScope));

    if (newStatus === "paid" || newStatus === "completed") {
      await allocateOrderLogistics(id);
    } else if (isPaid) {
      await releaseOrderLogistics(id, adminScope.tenantId);
    }

    const updated = await db.select().from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    if (!updated[0]) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    broadcastNotification({ type: "order_updated", data: { id, tenantId: adminScope.tenantId } });
    res.json({ ok: true, order: mapOrder(updated[0]) });
  } catch (err) {
    console.error("Edit order error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao editar pedido." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/orders/:id/reshipment  (protected)
// Creates/refreshes a reshipment for missing items without changing the order
// totals, preserving seller commission based on the original order.
// ---------------------------------------------------------------------------
router.post("/admin/orders/:id/reshipment", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];

    const rawProducts = Array.isArray(req.body?.products)
      ? req.body.products
      : [];

    if (rawProducts.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe ao menos um produto para o reenvio." });
      return;
    }

    const products = rawProducts
      .map((item: any) => ({
        id: String(item?.id || "").trim(),
        name: String(item?.name || "Produto").trim() || "Produto",
        quantity: Number(item?.quantity) || 0,
      }))
      .filter((item: { id: string; quantity: number }) => item.id && item.quantity > 0);

    if (products.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Produtos de reenvio inválidos." });
      return;
    }

    const rows = await db
      .select({ id: ordersTable.id, clientName: ordersTable.clientName })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);

    const order = rows[0];
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    const supportTicketId = `admin_reenvio_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;

    const created = await createOrRefreshReshipment({
      tenantId: adminScope.tenantId,
      orderId: id,
      supportTicketId,
      productsRaw: products,
      resolvedReason: "reenvio_admin_edicao",
    });

    broadcastNotification({
      type: "support_ticket_reshipment_authorized",
      data: { id: created.id, orderId: id, clientName: order.clientName || "", tenantId: adminScope.tenantId },
    });

    res.status(201).json({
      ok: true,
      message: "Reenvio lançado sem alterar o pedido original e sem impacto na comissão.",
      reshipment: created,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao lançar reenvio.";
    console.error("Create order reshipment error:", err);
    res.status(400).json({ error: "INVALID_INPUT", message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/orders/:id/difference-charge  (protected, full-access only)
// ---------------------------------------------------------------------------
router.post("/admin/orders/:id/difference-charge", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { amount, description } = req.body as { amount: number; description?: string };

    if (!amount || amount <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor inválido." });
      return;
    }

    const orders = await db.select().from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    if (!orders[0]) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    const order = orders[0];

    const chargeId = crypto.randomBytes(8).toString("hex");
    const gatewayProvider = await getActivePixGateway(adminScope.tenantId);
    const identifier = genIdentifier();
    const webhookSecret = String(process.env.WEBHOOK_SHARED_SECRET || "").trim();
    const callbackBase = buildCallbackUrl(req as never, "/webhook/pix");
    const callbackUrl = webhookSecret
      ? `${callbackBase}${callbackBase.includes("?") ? "&" : "?"}whsec=${encodeURIComponent(webhookSecret)}`
      : callbackBase;
    const desc = description || `Diferença pedido #${id}`;

    const gatewayData = await createPixChargeWithProvider({
      identifier,
      amount,
      provider: gatewayProvider,
      tenantId: adminScope.tenantId,
      client: { name: order.clientName, email: order.clientEmail, phone: order.clientPhone, document: order.clientDocument },
      metadata: { chargeId, description: desc },
      callbackUrl,
    });

    await db.insert(customChargesTable).values({
      id: chargeId,
      orderId: id,
      clientName: order.clientName,
      clientEmail: order.clientEmail,
      clientPhone: order.clientPhone,
      clientDocument: order.clientDocument,
      addressCep: order.addressCep,
      addressStreet: order.addressStreet,
      addressNumber: order.addressNumber,
      addressComplement: order.addressComplement,
      addressNeighborhood: order.addressNeighborhood,
      addressCity: order.addressCity,
      addressState: order.addressState,
      description: desc,
      sellerCode: order.sellerCode,
      amount: String(amount),
      status: "awaiting_payment",
      transactionId: gatewayData.transactionId,
    });

    const expiresAt = new Date(Date.now() + PIX_DURATION_MS).toISOString();
    res.json({
      id: chargeId,
      transactionId: gatewayData.transactionId,
      gatewayProvider: gatewayData.gatewayProvider || gatewayProvider,
      pixCode: gatewayData.pix?.code || "",
      pixBase64: gatewayData.pix?.base64 || "",
      pixImage: gatewayData.pix?.image || "",
      expiresAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido.";
    console.error("Diff PIX error:", err);
    res.status(400).json({ error: "GATEWAY_ERROR", message: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/export  (protected)
// ---------------------------------------------------------------------------
router.get("/admin/export", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    const { dateFrom, dateTo, status, paymentMethod, sellerCode, whatsappGroup } = req.query as Record<string, string>;

    // São Paulo = UTC-3: midnight SP = 03:00 UTC; end-of-day SP 23:59:59 = next day 02:59:59 UTC
    const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
    const conditions = [];
    conditions.push(buildOrderTenantWhere(adminScope.tenantId));
    if (dateFrom) {
      const from = new Date(dateFrom + "T00:00:00.000Z");
      from.setTime(from.getTime() + SP_OFFSET_MS);
      conditions.push(gte(ordersTable.createdAt, from));
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59.999Z");
      to.setTime(to.getTime() + SP_OFFSET_MS);
      conditions.push(lte(ordersTable.createdAt, to));
    }
    if (status && status !== "all") {
      if (status === "paid") conditions.push(inArray(ordersTable.status, ["paid", "completed"]));
      else conditions.push(eq(ordersTable.status, status));
    }
    if (paymentMethod && paymentMethod !== "all") conditions.push(eq(ordersTable.paymentMethod, paymentMethod));
    if (whatsappGroup && whatsappGroup !== "all") conditions.push(eq(ordersTable.whatsappGroup, whatsappGroup));
    if (!adminScope.hasGlobalAccess) {
      if (sellerCode && sellerCode !== "all" && sellerCode !== adminScope.sellerCode) {
        res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para acessar outro seller." });
        return;
      }
      conditions.push(eq(ordersTable.sellerCode, adminScope.sellerCode!));
    } else if (sellerCode && sellerCode !== "all") {
      conditions.push(eq(ordersTable.sellerCode, sellerCode));
    }

    const orders = await db
      .select()
      .from(ordersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ordersTable.createdAt));

    const cols = [
      "ID", "Data", "Vendedor", "Cliente", "Email", "Telefone", "CPF",
      "CEP", "Rua", "Número", "Bairro", "Cidade", "Estado",
      "Pagamento", "Parcelamento", "Frete", "Seguro",
      "Subtotal", "Frete (R$)", "Seguro (R$)", "Cupom", "Desconto (R$)", "Total",
      "Status", "Transação PIX", "Produtos",
    ];
    const header = cols.map(csvField).join(";");

    const rows = orders.map((o) => {
      const products = (o.products as Array<{ name: string; quantity: number; price: number }>)
        .map((p) => `${p.quantity}x ${p.name}`).join(" | ");

      return [
        o.id,
        o.createdAt?.toLocaleString("pt-BR") ?? "",
        o.sellerCode || "",
        o.clientName,
        o.clientEmail,
        o.clientPhone,
        o.clientDocument,
        o.addressCep ?? "",
        o.addressStreet ?? "",
        o.addressNumber ?? "",
        o.addressNeighborhood ?? "",
        o.addressCity ?? "",
        o.addressState ?? "",
        o.paymentMethod === "card_simulation" ? "Cartão (simulação)" : "PIX",
        o.cardInstallments ? `${o.cardInstallments}x` : "",
        o.shippingType,
        o.includeInsurance ? "Sim" : "Não",
        o.subtotal,
        o.shippingCost,
        o.insuranceAmount,
        o.couponCode ?? "",
        o.discountAmount ?? "0",
        o.total,
        o.status,
        o.transactionId ?? "",
        products,
      ].map(csvField).join(";");
    });

    const csv = [header, ...rows].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pedidos-${Date.now()}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao exportar." });
  }
});

function isInlineMediaUrl(value: string | null | undefined): boolean {
  return /^data:/i.test(String(value || "").trim());
}

function slimExternalUrl(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed || isInlineMediaUrl(trimmed)) return null;
  return trimmed;
}

function mapOrder(o: typeof ordersTable.$inferSelect, options?: { light?: boolean }) {
  const light = Boolean(options?.light);
  let proofUrls: string[] = [];
  if (o.proofUrls) {
    try { proofUrls = JSON.parse(o.proofUrls); } catch { proofUrls = []; }
  }
  if (o.proofUrl && !proofUrls.includes(o.proofUrl)) {
    proofUrls = [o.proofUrl, ...proofUrls];
  }
  const hasInlineProof = proofUrls.some((url) => isInlineMediaUrl(url));
  if (light) {
    proofUrls = proofUrls.filter((url) => !isInlineMediaUrl(url));
  }

  let products: Array<{ id: string; name: string; quantity: number; price: number; costPrice?: number }> = [];
  if (Array.isArray(o.products)) {
    products = o.products as Array<{ id: string; name: string; quantity: number; price: number; costPrice?: number }>;
  } else if (typeof o.products === "string") {
    try {
      const parsed = JSON.parse(o.products);
      if (Array.isArray(parsed)) {
        products = parsed as Array<{ id: string; name: string; quantity: number; price: number; costPrice?: number }>;
      }
    } catch {
      products = [];
    }
  }

  return {
    id:                  o.id,
    orderNumber:         o.orderNumber ?? null,
    clientName:          o.clientName,
    clientEmail:         o.clientEmail,
    clientPhone:         o.clientPhone,
    clientDocument:      o.clientDocument,
    addressCep:          o.addressCep,
    addressStreet:       o.addressStreet,
    addressNumber:       o.addressNumber,
    addressComplement:   o.addressComplement,
    addressNeighborhood: o.addressNeighborhood,
    addressCity:         o.addressCity,
    addressState:        o.addressState,
    products,
    shippingType:        o.shippingType,
    motoboyDeliveryDate: o.motoboyDeliveryDate,
    motoboyDeliveryTime: o.motoboyDeliveryTime,
    motoboyDeliveryDurationHours: o.motoboyDeliveryDurationHours,
    includeInsurance:    o.includeInsurance,
    insurancePlan:       (o as { insurancePlan?: string | null }).insurancePlan ?? null,
    insuranceKeepAmount: (o as { insuranceKeepAmount?: unknown }).insuranceKeepAmount != null ? Number((o as { insuranceKeepAmount?: unknown }).insuranceKeepAmount) : 0,
    insuranceCashbackAmount: (o as { insuranceCashbackAmount?: unknown }).insuranceCashbackAmount != null ? Number((o as { insuranceCashbackAmount?: unknown }).insuranceCashbackAmount) : 0,
    insuranceClaimStatus: (o as { insuranceClaimStatus?: string | null }).insuranceClaimStatus || "none",
    insuranceReshipCount: Number((o as { insuranceReshipCount?: unknown }).insuranceReshipCount || 0),
    insuranceCashbackGranted: Boolean((o as { insuranceCashbackGranted?: unknown }).insuranceCashbackGranted),
    parentOrderId:       (o as { parentOrderId?: string | null }).parentOrderId ?? null,
    storeCreditUsed:     (o as { storeCreditUsed?: unknown }).storeCreditUsed != null ? Number((o as { storeCreditUsed?: unknown }).storeCreditUsed) : null,
    subtotal:            Number(o.subtotal),
    shippingCost:        Number(o.shippingCost),
    insuranceAmount:     Number(o.insuranceAmount),
    total:               Number(o.total),
    status:              o.status,
    paymentMethod:       o.paymentMethod || "pix",
    whatsappGroup:       o.whatsappGroup ?? null,
    cardInstallments:    o.cardInstallments,
    proofUrl:            light ? slimExternalUrl(o.proofUrl) : o.proofUrl,
    proofUrls,
    hasInlineProof,
    transactionId:       o.transactionId,
    sellerCode:             o.sellerCode,
    sellerCommissionRateSnapshot: o.sellerCommissionRateSnapshot ? Number(o.sellerCommissionRateSnapshot) : null,
    couponCode:             o.couponCode,
    discountAmount:         o.discountAmount ? Number(o.discountAmount) : null,
    affiliateCreditUsed:    o.affiliateCreditUsed ? Number(o.affiliateCreditUsed) : null,
    observation:            o.observation,
    cardInstallmentsActual: o.cardInstallmentsActual,
    cardInstallmentValue:   o.cardInstallmentValue ? Number(o.cardInstallmentValue) : null,
    cardTotalActual:        o.cardTotalActual ? Number(o.cardTotalActual) : null,
    paidAmount:             o.paidAmount ? Number(o.paidAmount) : null,
    createdAt:              o.createdAt?.toISOString() ?? new Date().toISOString(),
    purchaseIp:             o.purchaseIp,
    ipCity:                 o.ipCity ?? null,
    ipRegion:               o.ipRegion ?? null,
    ipIsp:                  o.ipIsp ?? null,
    ipIsProxy:              o.ipIsProxy ?? null,
    isPrioridade:           !!(o as any).isPrioridade,
    isProcurandoProduto:    !!(o as any).isProcurandoProduto,
    enviado:                !!o.enviado,
    inventoryExitPool:      parseKaInventoryExitPool((o as { inventoryExitPool?: unknown }).inventoryExitPool),
    inventoryExitedPools:   parseKaInventoryExitedPools((o as { inventoryExitedPools?: unknown }).inventoryExitedPools),
    trackingCode:           o.trackingCode ?? null,
    trackingLabelUrl:       light ? slimExternalUrl(o.trackingLabelUrl) : (o.trackingLabelUrl ?? null),
    trackingLabelText:      light ? null : (o.trackingLabelText ?? null),
    trackingDetectedName:   o.trackingDetectedName ?? null,
    trackingDetectedAddress:o.trackingDetectedAddress ?? null,
    envioecomShipmentId:    o.envioecomShipmentId ?? null,
    envioecomBarcode:       o.envioecomBarcode ?? null,
    envioecomTrackingKey:   o.envioecomTrackingKey ?? null,
    envioecomDeliveryMode:  o.envioecomDeliveryMode ?? null,
    envioecomStatus:        o.envioecomStatus ?? null,
    envioecomStatusUpdatedAt: o.envioecomStatusUpdatedAt?.toISOString?.() ?? o.envioecomStatusUpdatedAt ?? null,
    envioecomStatusHistory: o.envioecomStatusHistory ?? [],
    envioecomLabelUrl:      light ? slimExternalUrl(o.envioecomLabelUrl) : (o.envioecomLabelUrl ?? null),
    envioecomFreightCost:   o.envioecomFreightCost != null ? Number(o.envioecomFreightCost) : null,
    envioecomExternalOrderNumber: o.envioecomExternalOrderNumber ?? null,
    envioecomAccountId:          o.envioecomAccountId ?? null,
    bankDepositMatchStatus: (o as any).bankDepositMatchStatus ?? null,
    bankDepositFitid:       (o as any).bankDepositFitid ?? null,
    bankDepositAmount:      (o as any).bankDepositAmount != null ? Number((o as any).bankDepositAmount) : null,
    bankDepositPayerName:   (o as any).bankDepositPayerName ?? null,
    bankDepositPostedAt:    (o as any).bankDepositPostedAt ?? null,
    bankDepositMatchedAt:   (o as any).bankDepositMatchedAt?.toISOString?.() ?? (o as any).bankDepositMatchedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/prioridade  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/prioridade", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];

    const { isPrioridade } = req.body as { isPrioridade: boolean };
    if (typeof isPrioridade !== "boolean") {
      res.status(400).json({ error: "INVALID_INPUT", message: "Campo 'isPrioridade' obrigatório e deve ser boolean." });
      return;
    }

    const available = await isOrderPriorityColumnAvailable();
    if (!available) {
      res.status(503).json({
        error: "PRIORITY_COLUMN_PENDING_MIGRATION",
        message: "Prioridade temporariamente indisponível até aplicar a migração no banco.",
      });
      return;
    }

    const existing = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    if (adminScope.hasGlobalAccess) {
      await pool.query(
        "UPDATE orders SET is_prioridade = ?, updated_at = NOW() WHERE id = ?",
        [isPrioridade ? 1 : 0, id],
      );
    } else {
      await pool.query(
        "UPDATE orders SET is_prioridade = ?, updated_at = NOW() WHERE id = ? AND seller_code = ?",
        [isPrioridade ? 1 : 0, id, adminScope.sellerCode],
      );
    }

    const updated = await db
      .select()
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);

    broadcastNotification({ type: "order_priority_updated", data: { id, isPrioridade, tenantId: adminScope.tenantId } });
    res.json({
      ok: true,
      id,
      isPrioridade,
      order: updated[0] ? { ...mapOrder(updated[0]), isPrioridade } : null,
    });
  } catch (err) {
    console.error("Update order priority error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar prioridade do pedido." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/procurando-produto  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/procurando-produto", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];

    const { isProcurandoProduto } = req.body as { isProcurandoProduto: boolean };
    if (typeof isProcurandoProduto !== "boolean") {
      res.status(400).json({ error: "INVALID_INPUT", message: "Campo 'isProcurandoProduto' obrigatório e deve ser boolean." });
      return;
    }

    const available = await isOrderSearchingProductColumnAvailable();
    if (!available) {
      res.status(503).json({
        error: "SEARCHING_PRODUCT_COLUMN_PENDING_MIGRATION",
        message: "Flag de produto em busca temporariamente indisponível até aplicar a migração no banco.",
      });
      return;
    }

    const existing = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    if (adminScope.hasGlobalAccess) {
      await pool.query(
        "UPDATE orders SET is_procurando_produto = ?, updated_at = NOW() WHERE id = ?",
        [isProcurandoProduto ? 1 : 0, id],
      );
    } else {
      await pool.query(
        "UPDATE orders SET is_procurando_produto = ?, updated_at = NOW() WHERE id = ? AND seller_code = ?",
        [isProcurandoProduto ? 1 : 0, id, adminScope.sellerCode],
      );
    }

    const updated = await db
      .select()
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);

    broadcastNotification({
      type: "order_searching_product_updated",
      data: { id, isProcurandoProduto, tenantId: adminScope.tenantId },
    });
    res.json({
      ok: true,
      id,
      isProcurandoProduto,
      order: updated[0] ? { ...mapOrder(updated[0]), isProcurandoProduto } : null,
    });
  } catch (err) {
    console.error("Update order searching product error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar flag de produto em busca." });
  }
});

function statusForOrderEnviadoError(code: string): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "YURY_EXIT_UNAVAILABLE" || code === "YURY_EXIT_FAILED") return 502;
  if (code === "YURY_SYNC_DISABLED" || code === "YURY_TOKEN_INVALID") return 503;
  return 400;
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/inventory-exit-pool  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/inventory-exit-pool", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const pool = parseKaInventoryExitPool((req.body as { pool?: unknown })?.pool);
    if (!pool) {
      res.status(400).json({ error: "INVALID_INPUT", message: "pool deve ser loja, motoboy ou minas." });
      return;
    }

    const existing = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    await db.update(ordersTable)
      .set({ inventoryExitPool: pool, updatedAt: new Date() })
      .where(buildAdminOrderWhere(id, adminScope));

    const updated = await db.select().from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    res.json({ ok: true, id, pool, order: updated[0] ? mapOrder(updated[0]) : null });
  } catch (err) {
    console.error("Update order inventory exit pool error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar o estoque da baixa." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/orders/:id/inventory-exit  (protected)
// ---------------------------------------------------------------------------
router.post("/admin/orders/:id/inventory-exit", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const pool = parseKaInventoryExitPool((req.body as { pool?: unknown })?.pool);
    if (!pool) {
      res.status(400).json({ error: "INVALID_INPUT", message: "pool deve ser loja, motoboy ou minas." });
      return;
    }

    const existing = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    const result = await debitOrderInventoryPool({
      orderId: id,
      tenantId: adminScope.tenantId,
      pool,
    });
    const updated = await db.select().from(ordersTable).where(buildAdminOrderWhere(id, adminScope)).limit(1);
    res.status(result.alreadyDebited ? 200 : 201).json({
      ok: true,
      id,
      alreadyDebited: result.alreadyDebited,
      pool: result.pool,
      inventoryExitedPools: result.exitedPools,
      order: updated[0] ? mapOrder(updated[0]) : null,
    });
  } catch (err) {
    if (err instanceof OrderEnviadoError) {
      res.status(statusForOrderEnviadoError(err.code)).json({ error: err.code, message: err.message });
      return;
    }
    console.error("Order inventory exit error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao dar baixa no estoque." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/enviado  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/enviado", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { enviado, adminPassword } = req.body as { enviado: boolean; adminPassword?: string };
    if (typeof enviado !== "boolean") {
      res.status(400).json({ error: "INVALID_INPUT", message: "Campo 'enviado' obrigatório e deve ser boolean." });
      return;
    }
    const rows = await db
      .select({
        id: ordersTable.id,
        products: ordersTable.products,
        clientName: ordersTable.clientName,
        enviado: ordersTable.enviado,
        shippingType: ordersTable.shippingType,
        motoboyDeliveryDate: ordersTable.motoboyDeliveryDate,
        motoboyDeliveryTime: ordersTable.motoboyDeliveryTime,
        inventoryExitPool: ordersTable.inventoryExitPool,
        inventoryExitedPools: ordersTable.inventoryExitedPools,
      })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);
    const order = rows[0];
    if (!order) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    const wasEnviado = !!order.enviado;
    const yuryPool = resolveYuryInventoryExitPool(order);
    const exitedPools = parseKaInventoryExitedPools(order.inventoryExitedPools);
    const shouldEstornoFoz = exitedPools.includes("loja")
      || (exitedPools.length === 0 && !yuryPool);
    console.info("[ORDER_ENVIADO] Toggle requested", {
      orderId: id,
      tenantId: adminScope.tenantId,
      admin: (req as any).adminSession?.username || "unknown",
      previousEnviado: wasEnviado,
      requestedEnviado: enviado,
    });

    if (wasEnviado && !enviado) {
      const providedPassword = String(adminPassword || "").trim();
      if (!providedPassword) {
        res.status(403).json({ error: "PASSWORD_REQUIRED", message: "Senha do admin é obrigatória para desfazer envio." });
        return;
      }
      const passwordOk = await verifyCurrentAdminPassword(req, providedPassword);
      if (!passwordOk) {
        res.status(403).json({ error: "INVALID_ADMIN_PASSWORD", message: "Senha do admin inválida." });
        return;
      }
      console.warn("[SECURITY] Envio rollback autorizado por senha", {
        orderId: id,
        admin: (req as any).adminSession?.username || "unknown",
      });
    }

    if (enviado) {
      try {
        await ensureOrderMarkedEnviado(id, adminScope.tenantId);
      } catch (err) {
        if (err instanceof OrderEnviadoError) {
          const status = statusForOrderEnviadoError(err.code);
          res.status(status).json({ error: err.code, message: err.message });
          return;
        }
        throw err;
      }

      const persisted = await db
        .select({ enviado: ordersTable.enviado })
        .from(ordersTable)
        .where(buildAdminOrderWhere(id, adminScope))
        .limit(1);
      const persistedEnviado = !!persisted[0]?.enviado;
      console.info("[ORDER_ENVIADO] Toggle persisted", {
        orderId: id,
        tenantId: adminScope.tenantId,
        previousEnviado: wasEnviado,
        requestedEnviado: enviado,
        persistedEnviado,
        yuryPool,
      });
      res.json({ ok: true, id, enviado: true });
      return;
    }

    const shouldSkipReturnToStock = !enviado && wasEnviado
      ? await db
          .select({ id: reshipmentsTable.id })
          .from(reshipmentsTable)
          .where(and(
            eq(reshipmentsTable.orderId, id),
            inArray(reshipmentsTable.status, ["reenvio_aguardando_estoque", "reenvio_pronto_para_envio"]),
          ))
          .limit(1)
          .then((rows) => !!rows[0])
      : false;

    if (enviado !== wasEnviado && shouldEstornoFoz) {
      const orderItems = parseOrderItemsForInventory(order.products);
      if (orderItems.length > 0) {
        const missingIds = orderItems.filter((item) => !item.productId);
        let resolvedItems = orderItems;

        if (missingIds.length > 0) {
          const productRows = await db
            .select({ id: productsTable.id, name: productsTable.name })
            .from(productsTable);
          const productIdByName = new Map(productRows.map((row) => [String(row.name || "").trim().toLowerCase(), row.id] as const));
          resolvedItems = orderItems.map((item) => {
            if (item.productId) return item;
            const byName = productIdByName.get(item.productName.trim().toLowerCase()) || null;
            return { ...item, productId: byName };
          });
        }

        const stillMissingIds = resolvedItems.filter((item) => !item.productId);
        if (stillMissingIds.length > 0) {
          const names = stillMissingIds.map((item) => item.productName).join(", ");
          res.status(400).json({
            error: "INVENTORY_PRODUCT_MAPPING_ERROR",
            message: `Não foi possível mapear os produtos no estoque: ${names}.`,
          });
          return;
        }

        for (const item of resolvedItems) {
          if (shouldSkipReturnToStock && !enviado) {
            continue;
          }
          await registerInventoryEntry({
            tenantId: adminScope.tenantId,
            productId: item.productId!,
            quantity: item.quantity,
            reason: `Estorno de saída do pedido ${id}`,
            referenceId: id,
            clientName: order.clientName || null,
          });
        }
      }
    }

    await db.update(ordersTable)
      .set({
        enviado,
        ...(shouldEstornoFoz && !shouldSkipReturnToStock
          ? { inventoryExitedPools: serializeKaInventoryExitedPools(exitedPools.filter((pool) => pool !== "loja")) }
          : {}),
        updatedAt: new Date(),
      })
      .where(buildAdminOrderWhere(id, adminScope));

    if (!enviado && wasEnviado) {
      await allocateOrderLogistics(id);
    }

    const persisted = await db
      .select({ enviado: ordersTable.enviado })
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);
    const persistedEnviado = !!persisted[0]?.enviado;

    console.info("[ORDER_ENVIADO] Toggle persisted", {
      orderId: id,
      tenantId: adminScope.tenantId,
      previousEnviado: wasEnviado,
      requestedEnviado: enviado,
      persistedEnviado,
    });

    broadcastNotification({ type: "order_enviado_updated", data: { id, enviado, tenantId: adminScope.tenantId } });
    res.json({ ok: true, id, enviado });
  } catch (err) {
    console.error("Update order enviado error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar status de envio." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/tracking-code  (protected)
// ---------------------------------------------------------------------------
router.patch("/admin/orders/:id/tracking-code", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    let id = req.params.id;
    if (Array.isArray(id)) id = id[0];
    const { trackingCode, overwrite } = req.body as { trackingCode?: string; overwrite?: boolean };

    const normalized = normalizeTrackingCode(trackingCode);
    if (!isTrackingCodeValid(normalized)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Código de rastreio inválido." });
      return;
    }

    const existing = await db
      .select()
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);

    const current = existing[0];
    if (!current) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    const currentTracking = normalizeTrackingCode(current.trackingCode || "");
    if (currentTracking && currentTracking !== normalized && overwrite !== true) {
      res.status(409).json({
        error: "TRACKING_ALREADY_SET",
        message: "O pedido já possui código de rastreio. Confirme substituição para atualizar.",
        currentTrackingCode: currentTracking,
      });
      return;
    }

    await db
      .update(ordersTable)
      .set({
        trackingCode: normalized,
        updatedAt: new Date(),
      })
      .where(buildAdminOrderWhere(id, adminScope));

    const updated = await db
      .select()
      .from(ordersTable)
      .where(buildAdminOrderWhere(id, adminScope))
      .limit(1);

    broadcastNotification({ type: "order_tracking_updated", data: { id, trackingCode: normalized, tenantId: adminScope.tenantId } });
    res.json({ ok: true, order: updated[0] ? mapOrder(updated[0]) : null });
  } catch (err) {
    console.error("Update order tracking code error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar código de rastreio." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/orders/tracking-label/match  (protected)
// ---------------------------------------------------------------------------
router.post("/admin/orders/tracking-label/match", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    const { imageData } = req.body as {
      imageData?: string;
    };

    const candidates = await fetchOpenTrackingCandidates(adminScope);

    if (!imageData?.startsWith("data:image/")) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Envie uma imagem válida em JPG, PNG, WebP ou GIF." });
      return;
    }
    if (candidates.length === 0) {
      res.status(400).json({
        error: "NO_CANDIDATES_AVAILABLE",
        message: "Nenhum pedido pago/concluído pendente de envio encontrado para o escopo deste admin.",
        matchedOrderId: null,
      });
      return;
    }
    if (!isR2Configured()) {
      res.status(503).json({
        error: "R2_NOT_CONFIGURED",
        message: "Cloudflare R2 não está configurado no servidor.",
        missing: getR2MissingConfig(),
      });
      return;
    }

    const labelUrl = await uploadOrderTrackingLabelToR2({ dataUrl: imageData, orderId: null });
    const ocrText = await runOcrOnImageDataUrl(imageData);
    let parsed: TrackingVisionResult = { ...parseTrackingText(ocrText), confidence: null, source: "ocr" };

    if (!parsed.trackingCode || !parsed.detectedName || !parsed.detectedAddress) {
      const vision = await runOpenAIVisionOnImageDataUrl(imageData);
      if (vision) {
        parsed = vision;
        if (!parsed.rawText) {
          parsed.rawText = ocrText.slice(0, 20000);
        }
      }
    }

    const deterministicMatch = pickDeterministicTrackingMatch(parsed, candidates);
    const aiMatch = deterministicMatch || await runOpenAIMatchTrackingOrderOnImageDataUrl({ imageData, parsed, candidates });
    let matchedOrderId: string | null = aiMatch?.matchedOrderId || null;
    let matchedOrder: ReturnType<typeof mapOrder> | null = null;

    if (matchedOrderId) {
      const rows = await db.select().from(ordersTable).where(buildAdminOrderWhere(matchedOrderId, adminScope)).limit(1);
      matchedOrder = rows[0] ? mapOrder(rows[0]) : null;
      if (!matchedOrder) {
        matchedOrderId = null;
      }
    }

    res.status(201).json({
      ok: true,
      imageUrl: labelUrl,
      matchedOrderId,
      order: matchedOrder,
      parsed: {
        suggestedTrackingCode: parsed.trackingCode,
        detectedName: parsed.detectedName,
        detectedAddress: parsed.detectedAddress,
        detectedCep: parsed.detectedCep,
        confidence: parsed.confidence,
        source: parsed.source,
        ocrEnabled: !!String(process.env.OCR_SPACE_API_KEY || "").trim(),
        openaiEnabled: !!String(process.env.OPENAI_API_KEY || "").trim(),
      },
      match: aiMatch,
      candidateCount: candidates.length,
      message: matchedOrderId
        ? "Etiqueta processada e pedido candidato encontrado para confirmação."
        : "Etiqueta processada, mas não foi possível associar a um pedido com segurança.",
    });
  } catch (err) {
    console.error("Match tracking label error:", err);
    const code = err instanceof Error ? err.message : "INTERNAL_ERROR";
    if (code === "INVALID_IMAGE_DATA_URL" || code === "UNSUPPORTED_IMAGE_TYPE" || code === "EMPTY_IMAGE") {
      res.status(400).json({ error: code, message: "Imagem inválida para upload." });
      return;
    }
    if (code === "CLOUDFLARE_R2_NOT_CONFIGURED") {
      res.status(503).json({
        error: code,
        message: "Cloudflare R2 não está configurado no servidor.",
        missing: getR2MissingConfig(),
      });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao processar etiqueta de rastreio." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/orders/tracking-label/parse  (protected)
// ---------------------------------------------------------------------------
router.post("/admin/orders/tracking-label/parse", requireAdminAuth, async (req, res) => {
  try {
    const adminScope = ensureSellerScopeOnOrderQuery(req, res);
    if (!adminScope) return;

    const { orderId, imageData } = req.body as { orderId?: string | null; imageData?: string };
    const normalizedOrderId = String(orderId || "").trim();

    if (!imageData?.startsWith("data:image/")) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Envie uma imagem válida em JPG, PNG, WebP ou GIF." });
      return;
    }
    if (!isR2Configured()) {
      res.status(503).json({
        error: "R2_NOT_CONFIGURED",
        message: "Cloudflare R2 não está configurado no servidor.",
        missing: getR2MissingConfig(),
      });
      return;
    }

    if (!normalizedOrderId) {
      const candidates = await fetchOpenTrackingCandidates(adminScope);
      if (candidates.length === 0) {
        res.status(400).json({
          error: "NO_CANDIDATES_AVAILABLE",
          message: "Nenhum pedido pago/concluído pendente de envio encontrado para o escopo deste admin.",
          matchedOrderId: null,
        });
        return;
      }

      const labelUrl = await uploadOrderTrackingLabelToR2({ dataUrl: imageData, orderId: null });
      const ocrText = await runOcrOnImageDataUrl(imageData);
      let parsed: TrackingVisionResult = { ...parseTrackingText(ocrText), confidence: null, source: "ocr" };

      if (!parsed.trackingCode || !parsed.detectedName || !parsed.detectedAddress) {
        const vision = await runOpenAIVisionOnImageDataUrl(imageData);
        if (vision) {
          parsed = vision;
          if (!parsed.rawText) {
            parsed.rawText = ocrText.slice(0, 20000);
          }
        }
      }

      const deterministicMatch = pickDeterministicTrackingMatch(parsed, candidates);
      const aiMatch = deterministicMatch || await runOpenAIMatchTrackingOrderOnImageDataUrl({ imageData, parsed, candidates });
      let matchedOrderId: string | null = aiMatch?.matchedOrderId || null;
      let matchedOrder: ReturnType<typeof mapOrder> | null = null;

      if (matchedOrderId) {
        const rows = await db.select().from(ordersTable).where(buildAdminOrderWhere(matchedOrderId, adminScope)).limit(1);
        matchedOrder = rows[0] ? mapOrder(rows[0]) : null;
        if (!matchedOrder) {
          matchedOrderId = null;
        }
      }

      res.status(201).json({
        ok: true,
        imageUrl: labelUrl,
        matchedOrderId,
        order: matchedOrder,
        parsed: {
          suggestedTrackingCode: parsed.trackingCode,
          detectedName: parsed.detectedName,
          detectedAddress: parsed.detectedAddress,
          detectedCep: parsed.detectedCep,
          confidence: parsed.confidence,
          source: parsed.source,
          ocrEnabled: !!String(process.env.OCR_SPACE_API_KEY || "").trim(),
          openaiEnabled: !!String(process.env.OPENAI_API_KEY || "").trim(),
        },
        match: aiMatch,
        candidateCount: candidates.length,
        message: matchedOrderId
          ? "Etiqueta processada e pedido candidato encontrado para confirmação."
          : "Etiqueta processada, mas não foi possível associar a um pedido com segurança.",
      });
      return;
    }

    const existing = await db
      .select()
      .from(ordersTable)
      .where(buildAdminOrderWhere(normalizedOrderId, adminScope))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    const labelUrl = await uploadOrderTrackingLabelToR2({ dataUrl: imageData, orderId: normalizedOrderId });
    const ocrText = await runOcrOnImageDataUrl(imageData);
    let parsed: TrackingVisionResult = { ...parseTrackingText(ocrText), confidence: null, source: "ocr" };

    if (!parsed.trackingCode || !parsed.detectedName || !parsed.detectedAddress) {
      const vision = await runOpenAIVisionOnImageDataUrl(imageData);
      if (vision) {
        parsed = vision;
        if (!parsed.rawText) {
          parsed.rawText = ocrText.slice(0, 20000);
        }
      }
    }

    await db
      .update(ordersTable)
      .set({
        trackingLabelUrl: labelUrl,
        trackingLabelText: parsed.rawText || null,
        trackingDetectedName: parsed.detectedName,
        trackingDetectedAddress: parsed.detectedAddress,
        updatedAt: new Date(),
      })
      .where(buildAdminOrderWhere(normalizedOrderId, adminScope));

    const updated = await db
      .select()
      .from(ordersTable)
      .where(buildAdminOrderWhere(normalizedOrderId, adminScope))
      .limit(1);

    res.status(201).json({
      ok: true,
      order: updated[0] ? mapOrder(updated[0]) : null,
      imageUrl: labelUrl,
      parsed: {
        suggestedTrackingCode: parsed.trackingCode,
        detectedName: parsed.detectedName,
        detectedAddress: parsed.detectedAddress,
        detectedCep: parsed.detectedCep,
        confidence: parsed.confidence,
        source: parsed.source,
        ocrEnabled: !!String(process.env.OCR_SPACE_API_KEY || "").trim(),
        openaiEnabled: !!String(process.env.OPENAI_API_KEY || "").trim(),
      },
      message: parsed.trackingCode
        ? "Etiqueta processada. Código identificado, aguardando confirmação do admin."
        : "Etiqueta enviada. Não foi possível identificar automaticamente o código de rastreio.",
    });
  } catch (err) {
    console.error("Parse tracking label error:", err);
    const code = err instanceof Error ? err.message : "INTERNAL_ERROR";
    if (code === "INVALID_IMAGE_DATA_URL" || code === "UNSUPPORTED_IMAGE_TYPE" || code === "EMPTY_IMAGE") {
      res.status(400).json({ error: code, message: "Imagem inválida para upload." });
      return;
    }
    if (code === "CLOUDFLARE_R2_NOT_CONFIGURED") {
      res.status(503).json({
        error: code,
        message: "Cloudflare R2 não está configurado no servidor.",
        missing: getR2MissingConfig(),
      });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao processar etiqueta de rastreio." });
  }
});

export default router;
