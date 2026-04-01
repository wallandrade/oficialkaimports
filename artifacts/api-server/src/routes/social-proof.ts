import { Router, type IRouter } from "express";
import { db, socialProofSettingsTable, socialProofFakeEntriesTable, ordersTable, productsTable } from "@workspace/db";
import { eq, desc, and, gte, ne } from "drizzle-orm";
import { requireAdminAuth } from "./admin-auth";

const router: IRouter = Router();

// ─── Brazilian name / city pools ──────────────────────────────────────────────

const BR_NAMES_F = [
  "Ana", "Beatriz", "Camila", "Daniela", "Fernanda", "Gabriela", "Helena",
  "Isabela", "Juliana", "Larissa", "Letícia", "Luciana", "Mariana", "Natália",
  "Patrícia", "Priscila", "Rafaela", "Renata", "Sabrina", "Tatiane", "Vanessa",
  "Viviane", "Amanda", "Bruna", "Carolina", "Cristina", "Denise", "Eliane",
  "Fabiana", "Gisele", "Jéssica", "Karina", "Luana", "Mônica", "Nadia",
  "Paula", "Roberta", "Sandra", "Simone", "Thaís", "Thayná", "Aline",
  "Bianca", "Cláudia", "Débora", "Elaine", "Flávia", "Giovanna", "Ingrid",
  "Joana", "Lara", "Milena", "Nathalia", "Raquel", "Sueli", "Talita",
];

const BR_NAMES_M = [
  "Alexandre", "Bruno", "Carlos", "Daniel", "Eduardo", "Felipe", "Gabriel",
  "Henrique", "Igor", "João", "Lucas", "Marcelo", "Matheus", "Paulo",
  "Rafael", "Ricardo", "Rodrigo", "Thiago", "Vinícius", "William", "Anderson",
  "Diego", "Fábio", "Gustavo", "Leandro", "Leonardo", "Marcos", "Pedro",
  "Roberto", "Sérgio", "Alan", "Caio", "David", "Emerson", "Fernando",
  "Gilberto", "Hudson", "Ivan", "José", "Luiz", "Márcio", "Nathan",
  "Otávio", "Patrick", "Renan", "Saulo", "Tiago", "Ulisses", "Vítor",
];

const BR_NAMES = [...BR_NAMES_F, ...BR_NAMES_M];

const BR_CITIES = [
  "São Paulo", "Rio de Janeiro", "Belo Horizonte", "Salvador", "Fortaleza",
  "Curitiba", "Recife", "Porto Alegre", "Belém", "Goiânia", "Guarulhos",
  "Campinas", "São Luís", "Maceió", "Natal", "Teresina", "Campo Grande",
  "João Pessoa", "Osasco", "Ribeirão Preto", "Uberlândia", "Aracaju",
  "Feira de Santana", "Cuiabá", "Joinville", "Londrina", "Juiz de Fora",
  "Niterói", "Florianópolis", "Caxias do Sul", "Santos", "São José dos Campos",
  "Sorocaba", "Mogi das Cruzes", "Betim", "Olinda", "Campina Grande",
  "Contagem", "Aparecida de Goiânia", "Vila Velha", "Ananindeua", "Macapá",
  "Nova Iguaçu", "Duque de Caxias", "Carapicuíba", "São Gonçalo",
  "São Bernardo do Campo", "Caucaia", "Caruaru", "Vitória", "São Vicente",
  "Montes Claros", "Pelotas", "Canoas", "Maringá", "Bauru", "Franca",
  "Cascavel", "Blumenau", "Itabuna", "Juazeiro do Norte", "Mossoró",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateEntries(
  count: number,
  productNames: string[],
): Array<{ firstName: string; city: string; productName: string; source: "auto" }> {
  if (productNames.length === 0) return [];

  // Build shuffled name/city pools — use each at most once before repeating
  const namePool = shuffle([...BR_NAMES, ...shuffle(BR_NAMES)]);
  const cityPool = shuffle([...BR_CITIES, ...shuffle(BR_CITIES)]);

  const result: Array<{ firstName: string; city: string; productName: string; source: "auto" }> = [];
  const usedPairs = new Set<string>();

  let attempts = 0;
  while (result.length < count && attempts < count * 4) {
    attempts++;
    const firstName = namePool[result.length % namePool.length];
    const city      = cityPool[(result.length * 7 + attempts) % cityPool.length];
    const productName = productNames[result.length % productNames.length];
    const key = `${firstName}|${city}`;
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    result.push({ firstName, city, productName, source: "auto" });
  }

  return shuffle(result);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the UTC Date corresponding to midnight of today in São Paulo (America/Sao_Paulo). */
function startOfTodaySaoPaulo(): Date {
  const tz = "America/Sao_Paulo";
  const now = new Date();
  // Get today's date string in SP timezone, e.g. "2026-03-27"
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: tz });
  // Compute the current SP offset vs UTC by comparing SP wall-clock to UTC
  const spParts = new Intl.DateTimeFormat("en", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now);
  const gp = (t: string) => parseInt(spParts.find(p => p.type === t)?.value ?? "0");
  const spAsUtc = Date.UTC(gp("year"), gp("month") - 1, gp("day"), gp("hour"), gp("minute"), gp("second"));
  const offsetMs = now.getTime() - spAsUtc; // positive for UTC-3 (+10800000)
  // SP midnight = UTC midnight of SP date + offsetMs
  const midnightUtc = new Date(`${todayStr}T00:00:00.000Z`).getTime();
  return new Date(midnightUtc + offsetMs);
}

async function getSettings() {
  const rows = await db.select().from(socialProofSettingsTable).where(eq(socialProofSettingsTable.id, 1));
  if (rows.length > 0) return rows[0];
  await db.insert(socialProofSettingsTable).values({ id: 1 });
  const fresh = await db.select().from(socialProofSettingsTable).where(eq(socialProofSettingsTable.id, 1));
  return fresh[0];
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/social-proof/feed — public */
router.get("/social-proof/feed", async (_req, res) => {
  try {
    const settings = await getSettings();
    if (!settings.enabled) { res.json({ enabled: false, realEntries: [], fillEntries: [] }); return; }

    type Entry = { firstName: string; city: string; productName: string; source: "real" | "fake" | "auto" };
    const realEntries: Entry[] = [];
    const fillEntries: Entry[] = [];

    // ── Real sales (within the configured window, e.g. last 2 hours) ──
    if (settings.showRealSales) {
      const windowHours = settings.realWindowHours ?? 2;
      const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      const orders = await db
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.status, "paid"), gte(ordersTable.createdAt, windowStart)))
        .orderBy(desc(ordersTable.createdAt))
        .limit(50);

      for (const order of orders) {
        if (!order.clientName || !order.addressCity) continue;
        const firstName = order.clientName.trim().split(/\s+/)[0];
        const products = (order.products ?? []) as Array<{ name?: string }>;
        for (const item of products) {
          const productName = item.name ?? "";
          if (!productName) continue;
          realEntries.push({ firstName, city: order.addressCity, productName, source: "real" });
        }
      }
    }

    // ── Manual fake entries (fill) — excludes auto-generated rows ──
    if (settings.showFakeCards) {
      const fakeEntries = await db.select().from(socialProofFakeEntriesTable)
        .where(eq(socialProofFakeEntriesTable.isAuto, false))
        .orderBy(desc(socialProofFakeEntriesTable.id));
      for (const f of fakeEntries) {
        fillEntries.push({ firstName: f.firstName, city: f.city, productName: f.productName, source: "fake" });
      }
    }

    // ── Auto-generated entries (read from DB, saved via admin generate button) ──
    if (settings.autoGenerate) {
      const autoEntries = await db.select().from(socialProofFakeEntriesTable)
        .where(eq(socialProofFakeEntriesTable.isAuto, true))
        .orderBy(desc(socialProofFakeEntriesTable.id));
      for (const e of autoEntries) {
        fillEntries.push({ firstName: e.firstName, city: e.city, productName: e.productName, source: "auto" });
      }
    }

    res.json({
      enabled: true,
      delaySeconds: settings.delaySeconds,
      displaySeconds: settings.displaySeconds,
      cardBgColor: settings.cardBgColor,
      cardTextColor: settings.cardTextColor,
      badgeColor: settings.badgeColor,
      realEntries,
      fillEntries,
    });
  } catch (err) {
    console.error("[SocialProof] feed error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** GET /api/admin/social-proof/settings */
router.get("/admin/social-proof/settings", requireAdminAuth, async (_req, res) => {
  try {
    res.json(await getSettings());
  } catch (err) {
    console.error("[SocialProof] get settings error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** PATCH /api/admin/social-proof/settings */
router.patch("/admin/social-proof/settings", requireAdminAuth, async (req, res) => {
  try {
    const body = req.body as Partial<typeof socialProofSettingsTable.$inferInsert>;
    await db
      .insert(socialProofSettingsTable)
      .values({ id: 1, ...body, updatedAt: new Date() })
      .onDuplicateKeyUpdate({
        set: { ...body, updatedAt: new Date() },
      });
    res.json(await getSettings());
  } catch (err) {
    console.error("[SocialProof] patch settings error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** POST /api/admin/social-proof/generate — delete old auto entries and generate fresh ones */
router.post("/admin/social-proof/generate", requireAdminAuth, async (_req, res) => {
  try {
    const settings = await getSettings();
    let productNames: string[] = [];

    if (settings.fakeAllProducts) {
      const prods = await db.select({ name: productsTable.name }).from(productsTable);
      productNames = prods.map((p) => p.name).filter(Boolean);
    } else {
      let ids: string[] = [];
      try { ids = JSON.parse(settings.fakeProductIds ?? "[]"); } catch { /* ignore */ }
      if (ids.length > 0) {
        const prods = await db.select({ id: productsTable.id, name: productsTable.name }).from(productsTable);
        productNames = prods.filter((p) => ids.includes(p.id)).map((p) => p.name).filter(Boolean);
      }
    }

    if (!productNames.length) {
      res.status(400).json({ error: "NO_PRODUCTS", message: "Nenhum produto encontrado para gerar notificações." });
      return;
    }

    const count = Math.max(10, Math.min(100, settings.autoGenerateCount ?? 40));
    const generated = generateEntries(count, productNames);

    // Delete old auto-generated entries and insert fresh ones atomically
    await db.delete(socialProofFakeEntriesTable).where(eq(socialProofFakeEntriesTable.isAuto, true));
    await db.insert(socialProofFakeEntriesTable).values(
      generated.map((e) => ({ firstName: e.firstName, city: e.city, state: "BR", productName: e.productName, isAuto: true }))
    );

    res.json({ success: true, count: generated.length });
  } catch (err) {
    console.error("[SocialProof] generate error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** GET /api/admin/social-proof/auto-count — count of stored auto-generated entries */
router.get("/admin/social-proof/auto-count", requireAdminAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(socialProofFakeEntriesTable).where(eq(socialProofFakeEntriesTable.isAuto, true));
    res.json({ count: rows.length });
  } catch (err) {
    console.error("[SocialProof] auto-count error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** GET /api/admin/social-proof/fake-entries */
router.get("/admin/social-proof/fake-entries", requireAdminAuth, async (_req, res) => {
  try {
    res.json(await db.select().from(socialProofFakeEntriesTable)
      .where(eq(socialProofFakeEntriesTable.isAuto, false))
      .orderBy(desc(socialProofFakeEntriesTable.id)));
  } catch (err) {
    console.error("[SocialProof] get fake entries error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** POST /api/admin/social-proof/fake-entries */
router.post("/admin/social-proof/fake-entries", requireAdminAuth, async (req, res) => {
  try {
    const { firstName, city, state, productName } = req.body as { firstName?: string; city?: string; state?: string; productName?: string };
    if (!firstName || !city || !state || !productName) { res.status(400).json({ error: "MISSING_FIELDS" }); return; }
    const [result] = await db.insert(socialProofFakeEntriesTable).values({ firstName, city, state, productName });
    const [row] = await db.select().from(socialProofFakeEntriesTable).where(eq(socialProofFakeEntriesTable.id, result.insertId));
    res.json(row);
  } catch (err) {
    console.error("[SocialProof] create fake entry error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** PUT /api/admin/social-proof/fake-entries/:id */
router.put("/admin/social-proof/fake-entries/:id", requireAdminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { firstName, city, state, productName } = req.body as { firstName?: string; city?: string; state?: string; productName?: string };
    if (!firstName || !city || !state || !productName) { res.status(400).json({ error: "MISSING_FIELDS" }); return; }
    await db.update(socialProofFakeEntriesTable).set({ firstName, city, state, productName }).where(eq(socialProofFakeEntriesTable.id, id));
    const [row] = await db.select().from(socialProofFakeEntriesTable).where(eq(socialProofFakeEntriesTable.id, id));
    if (!row) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[SocialProof] update fake entry error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** DELETE /api/admin/social-proof/fake-entries/:id */
router.delete("/admin/social-proof/fake-entries/:id", requireAdminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(socialProofFakeEntriesTable).where(eq(socialProofFakeEntriesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[SocialProof] delete fake entry error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

/** GET /api/admin/social-proof/real-entries — preview real sales */
router.get("/admin/social-proof/real-entries", requireAdminAuth, async (_req, res) => {
  try {
    const orders = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.status, "paid"))
      .orderBy(desc(ordersTable.createdAt))
      .limit(20);

    const entries: Array<{ firstName: string; city: string; productName: string }> = [];
    for (const order of orders) {
      if (!order.clientName || !order.addressCity) continue;
      const firstName = order.clientName.trim().split(/\s+/)[0];
      const products = (order.products ?? []) as Array<{ name?: string }>;
      const productName = products[0]?.name ?? "";
      if (!productName) continue;
      entries.push({ firstName, city: order.addressCity, productName });
    }
    res.json(entries);
  } catch (err) {
    console.error("[SocialProof] real entries error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
