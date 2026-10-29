import { db, ordersTable, pool, sellersTable, siteSettingsTable, tenantSettingsTable, tenantsTable, whatsappSupportSessionsTable } from "@workspace/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { isUsableLabelBarcode } from "./envioecom-status";
import { listOrderShipments } from "./order-shipments";
import { phoneHasRecentRecovery, recordRecoveryAnswer, recoveryAnswerId, RECOVERY_THANKS } from "./whatsapp-recovery";
import { inboundTypeShouldIgnore, menuShouldSendAgain, normalizeWhatsappPhone } from "./whatsapp-notices";
import {
  instanceMatchesPoly,
  postWhatsappWebhook,
  readPolyInstanceId,
  readSecondInstanceSlugs,
  readSupportAttendantPhone,
  resolveWhatsappWebhookUrl,
  whatsappSupportTokenMatches,
} from "./whatsapp-n8n";

const SESSION_MS = 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const MENU_BUTTON = "Ver opções";

type MenuOption = { id: string; title: string; description: string };

const DEFAULT_MENU: MenuOption[] = [
  { id: "meu-pedido", title: "Meu pedido", description: "Status, prazo e rastreio" },
  { id: "quero-comprar", title: "Quero comprar", description: "Ver produtos e preços" },
  { id: "chave-pix", title: "Chave Pix", description: "Dados da conta Inter" },
  { id: "problemas", title: "Problemas com pedido", description: "Atraso, falta ou extravio" },
  { id: "atendente", title: "Falar com atendente", description: "Falar com uma pessoa" },
];

const PIX_ACCOUNT_MESSAGE = [
  "Esses são os dados da minha",
  "",
  "conta no Inter:",
  "INTER - 077",
  "ALBERT MACHADO BARROS",
  "",
  "Agência: 0001",
  "Conta: 31816632-1",
  "",
  "",
  "Chave pix aleatório 👇",
].join("\n");

const PIX_KEY_MESSAGE = "3b2946fe-b3e1-4683-baa0-4dae6336ccdc";

const PROBLEM_MENU: MenuOption[] = [
  { id: "atrasado", title: "Pedido atrasado", description: "Passou do prazo" },
  { id: "faltando", title: "Veio faltando", description: "Item não chegou" },
  { id: "sumiu", title: "Pedido sumiu", description: "Não acho o rastreio" },
  { id: "quebra", title: "Chegou quebrado", description: "Produto danificado" },
  { id: "voltou", title: "Pedido voltou", description: "Retornou ao remetente" },
  { id: "outro", title: "Outro problema", description: "Quero explicar" },
];

type SessionStep = "menu" | "problem_menu" | "ask_ref" | "ask_cpf" | "ask_problem_ref" | "ask_problem_cpf" | "human";

type SessionState = {
  step: SessionStep;
  problem: string | null;
  pendingOrder: string | null;
};

const rateBuckets = new Map<string, { stamps: number[]; warned: boolean }>();
let ignoreCache: { at: number; phones: Set<string> } | null = null;

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readText(body: Record<string, unknown>): string {
  const text = asRecord(body.text);
  const nested = text.message;
  if (typeof nested === "string") return nested.trim();
  if (typeof body.message === "string") return body.message.trim();
  return "";
}

function readChoice(body: Record<string, unknown>): string {
  const list = asRecord(body.listResponseMessage);
  const buttons = asRecord(body.buttonsResponseMessage);
  return String(list.selectedRowId || buttons.buttonId || "").trim();
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseMenu(raw: string): MenuOption[] {
  if (!raw.trim()) return DEFAULT_MENU;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_MENU;
    const options = parsed
      .map((item) => {
        const row = asRecord(item);
        const id = String(row.id || "").trim();
        const title = String(row.title || "").trim();
        const description = String(row.description || "").trim();
        if (!id || !title) return null;
        return { id, title, description };
      })
      .filter((item): item is MenuOption => !!item);
    return options.length ? options : DEFAULT_MENU;
  } catch {
    return DEFAULT_MENU;
  }
}

function optionList(title: string, options: MenuOption[]) {
  return {
    title: clip(title, 24) || "Atendimento",
    buttonLabel: clip(MENU_BUTTON, 20),
    options: options.map((option) => ({
      id: option.id,
      title: clip(option.title, 24),
      description: clip(option.description, 72),
    })),
  };
}

function numberedMenu(intro: string, options: MenuOption[]): string {
  const lines = options.map((option, index) => `${index + 1}. ${option.title}${option.description ? ` — ${option.description}` : ""}`);
  return [intro, "", ...lines, "", "Responda com o número da opção."].join("\n");
}

function matchOption(options: MenuOption[], raw: string): MenuOption | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const byId = options.find((option) => option.id.toLowerCase() === value);
  if (byId) return byId;
  const number = Number(value);
  if (Number.isInteger(number) && number >= 1 && number <= options.length) return options[number - 1] || null;
  return options.find((option) => option.title.toLowerCase() === value) || null;
}

function readRef(text: string): { kind: "cpf" | "order" | "unknown"; value: string } {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 11) return { kind: "cpf", value: digits };
  if (digits.length >= 1 && digits.length <= 10 && text.trim().length <= 14) {
    const numeric = String(Number(digits));
    if (numeric !== "0") return { kind: "order", value: numeric };
  }
  return { kind: "unknown", value: "" };
}

function documentDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function orderLabel(order: { orderNumber?: number | null; id: string }): string {
  const numeric = Number(order.orderNumber);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  return order.id;
}

function productLines(raw: unknown): string {
  const products = Array.isArray(raw) ? raw : [];
  if (!products.length) return "💊 1x Produto";
  return products.map((item) => {
    const row = asRecord(item);
    const qty = Number(row.quantity) || 0;
    const name = String(row.name || "").trim() || "Produto";
    return `💊 ${qty}x ${name}`;
  }).join("\n");
}

function pushCode(codes: string[], value: unknown) {
  const code = String(value || "").trim();
  if (!isUsableLabelBarcode(code) || codes.includes(code)) return;
  codes.push(code);
}

function rateLimit(phone: string): "ok" | "warn" | "silence" {
  const now = Date.now();
  const bucket = rateBuckets.get(phone) || { stamps: [], warned: false };
  bucket.stamps = bucket.stamps.filter((stamp) => now - stamp < RATE_WINDOW_MS);
  bucket.stamps.push(now);
  if (bucket.stamps.length <= RATE_MAX) bucket.warned = false;
  rateBuckets.set(phone, bucket);
  if (bucket.stamps.length <= RATE_MAX) return "ok";
  if (!bucket.warned) {
    bucket.warned = true;
    return "warn";
  }
  return "silence";
}

async function ignorePhones(tenantId: string): Promise<Set<string>> {
  const now = Date.now();
  if (ignoreCache && now - ignoreCache.at < 60_000) return ignoreCache.phones;
  const phones = new Set<string>();
  const sellers = await db.select({ whatsapp: sellersTable.whatsapp }).from(sellersTable);
  for (const seller of sellers) {
    const phone = normalizeWhatsappPhone(seller.whatsapp);
    if (phone) phones.add(phone);
  }
  const settings = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(eq(tenantSettingsTable.key, "support_whatsapp"));
  for (const row of settings) {
    const phone = normalizeWhatsappPhone(row.value);
    if (phone) phones.add(phone);
  }
  const legacy = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "support_whatsapp")).limit(1);
  const legacyPhone = normalizeWhatsappPhone(legacy[0]?.value);
  if (legacyPhone) phones.add(legacyPhone);
  const attendant = await readSupportAttendantPhone(tenantId);
  if (attendant) phones.add(attendant);
  const fromEnv = String(process.env.N8N_SUPPORT_IGNORE_PHONES || "");
  const ignoreRows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(eq(tenantSettingsTable.key, "n8n_support_ignore_phones"));
  const legacyIgnore = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "n8n_support_ignore_phones")).limit(1);
  const ignoreText = [
    fromEnv,
    BUILTIN_IGNORED_PHONES.join("\n"),
    ...ignoreRows.map((row) => row.value),
    legacyIgnore[0]?.value || "",
  ].join("\n");
  for (const part of ignoreText.split(/[^0-9]+/)) {
    const phone = normalizeWhatsappPhone(part);
    if (phone) phones.add(phone);
  }
  ignoreCache = { at: now, phones };
  return phones;
}

async function loadMenu(tenantId: string): Promise<MenuOption[]> {
  const rows = await db
    .select({ value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(eq(tenantSettingsTable.tenantId, tenantId), eq(tenantSettingsTable.key, "whatsapp_support_menu")))
    .limit(1);
  return parseMenu(String(rows[0]?.value || ""));
}

function tenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(ordersTable.tenantId, tenantId), isNull(ordersTable.tenantId), eq(ordersTable.tenantId, ""));
  }
  return eq(ordersTable.tenantId, tenantId);
}

async function ordersByDocument(tenantId: string, cpf: string) {
  return db
    .select()
    .from(ordersTable)
    .where(and(
      tenantWhere(tenantId),
      inArray(ordersTable.status, ["paid", "completed"]),
      sql`REPLACE(REPLACE(REPLACE(REPLACE(${ordersTable.clientDocument}, '.', ''), '-', ''), '/', ''), ' ', '') = ${cpf}`,
    ))
    .orderBy(desc(ordersTable.createdAt))
    .limit(3);
}

async function orderByNumber(tenantId: string, orderNumber: string) {
  const numeric = Number(orderNumber);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const rows = await db
    .select()
    .from(ordersTable)
    .where(and(tenantWhere(tenantId), eq(ordersTable.orderNumber, Math.trunc(numeric))))
    .limit(1);
  return rows[0] || null;
}

async function summaryForOrder(order: typeof ordersTable.$inferSelect): Promise<string> {
  const packages = await listOrderShipments(order.id);
  const codes: string[] = [];
  if (packages.length >= 2) {
    for (const pkg of packages) {
      pushCode(codes, pkg.envioecomBarcode);
      pushCode(codes, pkg.manualTrackingCode);
    }
  } else {
    pushCode(codes, order.envioecomBarcode);
    pushCode(codes, order.trackingCode);
    pushCode(codes, order.manualTrackingCode);
  }
  const lines = [
    `*Pedido #${orderLabel(order)}*`,
    String(order.clientName || "").trim(),
    "",
    productLines(order.products),
  ];
  if (codes.length) {
    lines.push("", "Rastreio:");
    for (const code of codes) {
      lines.push(code, `https://envioecomrastreio.com.br/${code}`);
    }
  } else {
    lines.push("", "O código de rastreio ainda não está disponível.");
  }
  return lines.filter((line) => line !== undefined).join("\n");
}

const BUILTIN_IGNORED_PHONES = ["11992790531", "35991490820", "35991738862", "19997349772", "35997190899"];
const MAIN_STORE_LINK = "https://www.ka-imports.com/kaique";

async function storeLink(tenantId: string, secondInstance: boolean): Promise<string> {
  if (!secondInstance) return MAIN_STORE_LINK;
  const rows = await db.select({ domain: tenantsTable.domain }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const host = String(rows[0]?.domain || "").trim().replace(/^https?:\/\//, "").split("/")[0] || "";
  if (!host) return "";
  const base = `https://${host}`;
  const slugs = await readSecondInstanceSlugs(tenantId);
  return slugs[0] ? `${base}/${slugs[0]}` : base;
}

async function readSession(phone: string): Promise<SessionState | null> {
  const rows = await db
    .select()
    .from(whatsappSupportSessionsTable)
    .where(eq(whatsappSupportSessionsTable.phone, phone))
    .limit(1);
  const row = rows[0];
  if (!row?.updatedAt) return null;
  if (Date.now() - new Date(row.updatedAt).getTime() >= SESSION_MS) return null;
  const step = String(row.step || "menu") as SessionStep;
  return {
    step,
    problem: row.problem || null,
    pendingOrder: row.pendingOrder || null,
  };
}

async function saveSession(phone: string, state: SessionState): Promise<void> {
  await pool.query(
    `INSERT INTO whatsapp_support_sessions (phone, step, problem, pending_order, updated_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE step = VALUES(step), problem = VALUES(problem), pending_order = VALUES(pending_order), updated_at = NOW()`,
    [phone, state.step, state.problem, state.pendingOrder],
  );
}

async function sendText(input: {
  tenantId: string;
  secondInstance: boolean;
  phone: string;
  message: string;
}): Promise<void> {
  const url = await resolveWhatsappWebhookUrl({
    event: "support",
    tenantId: input.tenantId,
    secondInstance: false,
  });
  if (!url) return;
  await postWhatsappWebhook(url, { phone: input.phone, message: input.message });
}

async function sendMenu(input: {
  tenantId: string;
  secondInstance: boolean;
  phone: string;
  title: string;
  intro: string;
  options: MenuOption[];
}): Promise<boolean> {
  const menuUrl = await resolveWhatsappWebhookUrl({
    event: "support_menu",
    tenantId: input.tenantId,
    secondInstance: false,
  });
  if (menuUrl) {
    await postWhatsappWebhook(menuUrl, {
      phone: input.phone,
      message: input.intro,
      optionList: optionList(input.title, input.options),
    });
    return true;
  }
  await sendText({
    ...input,
    message: numberedMenu(input.intro, input.options),
  });
  return true;
}

function reminder(): string {
  return `Toque em ${MENU_BUTTON} acima e escolha sua opção.`;
}

async function readMenuSentAt(phone: string): Promise<Date | null> {
  const [rows] = await pool.query(
    `SELECT menu_sent_at AS menuSentAt FROM whatsapp_support_sessions WHERE phone = ? LIMIT 1`,
    [phone],
  ) as unknown as [Array<{ menuSentAt: Date | string | null }>, unknown];
  const value = rows[0]?.menuSentAt;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function markMenuSent(phone: string): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_support_sessions SET menu_sent_at = NOW() WHERE phone = ?`,
    [phone],
  );
}

export async function handleWhatsappSupportInbound(rawBody: unknown, token: string): Promise<{ status: number }> {
  const auth = await whatsappSupportTokenMatches(token);
  if (!auth.ok) return { status: 401 };

  const body = asRecord(rawBody);
  if (truthy(body.fromMe) || truthy(body.isGroup) || truthy(body.isNewsletter)) return { status: 200 };
  if (inboundTypeShouldIgnore(body.type)) return { status: 200 };

  const phone = normalizeWhatsappPhone(body.phone);
  if (!phone) return { status: 200 };
  if ((await ignorePhones(auth.tenantId)).has(phone)) return { status: 200 };

  const limit = rateLimit(phone);
  const polyId = await readPolyInstanceId(auth.tenantId);
  const secondInstance = instanceMatchesPoly(body.instanceId, polyId);
  if (limit === "silence") return { status: 200 };
  if (limit === "warn") {
    await sendText({
      tenantId: auth.tenantId,
      secondInstance,
      phone,
      message: "Você enviou muitas mensagens. Aguarde um pouco e tente de novo.",
    });
    return { status: 200 };
  }

  const menu = await loadMenu(auth.tenantId);
  const text = readText(body);
  let session = await readSession(phone);
  const clicked = recoveryAnswerId(readChoice(body) || (session ? "" : text));
  if (clicked && await phoneHasRecentRecovery(phone)) {
    await recordRecoveryAnswer(phone, clicked);
    await sendText({
      tenantId: auth.tenantId,
      secondInstance,
      phone,
      message: RECOVERY_THANKS,
    });
    return { status: 200 };
  }
  if (!session && await phoneHasRecentRecovery(phone)) {
    await sendText({
      tenantId: auth.tenantId,
      secondInstance,
      phone,
      message: "Obrigado por responder. Uma pessoa vai ler sua mensagem por aqui.",
    });
    await saveSession(phone, { step: "human", problem: "recuperacao", pendingOrder: null });
    return { status: 200 };
  }
  let state: SessionState = session || { step: "menu", problem: null, pendingOrder: null };
  const inboundChoice = readChoice(body);

  if (!session) {
    if (!inboundChoice && !menuShouldSendAgain(await readMenuSentAt(phone))) {
      return { status: 200 };
    }
    if (!inboundChoice) {
      const sent = await sendMenu({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        title: "Atendimento",
        intro: "Olá! Você entrou em contato com o atendimento.",
        options: menu,
      });
      if (sent) {
        await saveSession(phone, { step: "menu", problem: null, pendingOrder: null });
        await markMenuSent(phone);
      }
      return { status: 200 };
    }
  }

  if (state.step === "human") {
    await saveSession(phone, state);
    return { status: 200 };
  }

  if (state.step === "menu" || state.step === "problem_menu") {
    const options = state.step === "problem_menu" ? PROBLEM_MENU : menu;
    const picked = matchOption(options, readChoice(body) || text);
    if (!picked) {
      return { status: 200 };
    }
    if (state.step === "problem_menu") {
      state = { step: "ask_problem_ref", problem: picked.id, pendingOrder: null };
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: "Me envie o número do pedido ou o CPF da compra.",
      });
      await saveSession(phone, state);
      return { status: 200 };
    }
    if (picked.id === "meu-pedido") {
      state = { step: "ask_ref", problem: null, pendingOrder: null };
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: "Me envie o número do pedido ou o CPF da compra.",
      });
    } else if (picked.id === "quero-comprar") {
      const link = await storeLink(auth.tenantId, secondInstance);
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: link ? `Você pode comprar aqui:\n${link}` : "Acesse o site da loja pelo endereço que você já usa.",
      });
      state = { step: "menu", problem: null, pendingOrder: null };
    } else if (picked.id === "chave-pix") {
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: PIX_ACCOUNT_MESSAGE,
      });
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: PIX_KEY_MESSAGE,
      });
      state = { step: "menu", problem: null, pendingOrder: null };
    } else if (picked.id === "problemas") {
      const sent = await sendMenu({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        title: "Problemas",
        intro: "Qual é o problema com o pedido?",
        options: PROBLEM_MENU,
      });
      state = { step: sent ? "problem_menu" : "menu", problem: null, pendingOrder: null };
    } else if (picked.id === "atendente") {
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: "Certo. Um atendente continua a conversa por aqui.",
      });
      state = { step: "human", problem: null, pendingOrder: null };
    } else if (menuShouldSendAgain(await readMenuSentAt(phone))) {
      await sendText({ tenantId: auth.tenantId, secondInstance, phone, message: reminder() });
    }
    await saveSession(phone, state);
    return { status: 200 };
  }

  const ref = readRef(text);
  if (state.step === "ask_ref" || state.step === "ask_problem_ref") {
    if (ref.kind === "cpf") {
      const orders = await ordersByDocument(auth.tenantId, ref.value);
      if (!orders.length) {
        await sendText({
          tenantId: auth.tenantId,
          secondInstance,
          phone,
          message: "Não encontrei pedido pago com esse CPF.",
        });
      } else if (state.step === "ask_problem_ref") {
        const labels = orders.map((order) => `#${orderLabel(order)}`).join(", ");
        await sendText({
          tenantId: auth.tenantId,
          secondInstance,
          phone,
          message: `Anotei o problema. Um atendente continua daqui. Pedido ${labels}.`,
        });
        state = { step: "human", problem: state.problem, pendingOrder: null };
      } else {
        const blocks = [];
        for (const order of orders) blocks.push(await summaryForOrder(order));
        await sendText({
          tenantId: auth.tenantId,
          secondInstance,
          phone,
          message: blocks.join("\n\n"),
        });
        state = { step: "menu", problem: null, pendingOrder: null };
      }
    } else if (ref.kind === "order") {
      state = {
        step: state.step === "ask_problem_ref" ? "ask_problem_cpf" : "ask_cpf",
        problem: state.problem,
        pendingOrder: ref.value,
      };
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: "Agora me envie o CPF da compra.",
      });
    } else {
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: "Me envie só o número do pedido ou o CPF da compra.",
      });
    }
    await saveSession(phone, state);
    return { status: 200 };
  }

  if (state.step === "ask_cpf" || state.step === "ask_problem_cpf") {
    if (ref.kind !== "cpf") {
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: "Me envie o CPF da compra, só com os números.",
      });
      await saveSession(phone, state);
      return { status: 200 };
    }
    const order = state.pendingOrder ? await orderByNumber(auth.tenantId, state.pendingOrder) : null;
    if (!order || documentDigits(order.clientDocument) !== ref.value) {
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: "O CPF não confere com esse pedido.",
      });
      await saveSession(phone, state);
      return { status: 200 };
    }
    if (state.step === "ask_problem_cpf") {
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: `Anotei o problema. Um atendente continua daqui. Pedido #${orderLabel(order)}.`,
      });
      state = { step: "human", problem: state.problem, pendingOrder: orderLabel(order) };
    } else {
      await sendText({
        tenantId: auth.tenantId,
        secondInstance,
        phone,
        message: await summaryForOrder(order),
      });
      state = { step: "menu", problem: null, pendingOrder: null };
    }
    await saveSession(phone, state);
  }

  return { status: 200 };
}
