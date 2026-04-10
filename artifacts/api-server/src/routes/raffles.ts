import { Router, type IRouter } from "express";
import { db, rafflesTable, raffleReservationsTable, raffleResultsTable, rafflePromotionsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import crypto from "crypto";
import { requireAdminAuth } from "./admin-auth";
import {
  createPixCharge,
  buildCallbackUrl,
  genIdentifier,
  PIX_DURATION_MS,
  isPaymentConfirmed,
} from "../gateway";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseNumbers(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as number[]; } catch { return []; }
}

function normalizePhone(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

type RaffleRankingEntry = {
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  clientDocument?: string | null;
  totalNumbers: number;
  totalSpent: number;
  reservationCount: number;
};

type RafflePromotion = {
  id: string;
  raffleId: string;
  quantity: number;
  promoPrice: string;
  isActive: number;
  sortOrder: number;
};

async function getRafflePromotions(raffleId: string, onlyActive = true): Promise<RafflePromotion[]> {
  const conditions = [eq(rafflePromotionsTable.raffleId, raffleId)];
  if (onlyActive) conditions.push(eq(rafflePromotionsTable.isActive, 1));
  return db
    .select()
    .from(rafflePromotionsTable)
    .where(and(...conditions))
    .orderBy(sql`sort_order ASC`, sql`quantity ASC`, sql`created_at ASC`);
}

async function getRaffleRanking(raffleId: string, limit = 3): Promise<RaffleRankingEntry[]> {
  const rows = await db
    .select({
      clientName: raffleReservationsTable.clientName,
      clientPhone: raffleReservationsTable.clientPhone,
      clientEmail: raffleReservationsTable.clientEmail,
      clientDocument: raffleReservationsTable.clientDocument,
      numbers: raffleReservationsTable.numbers,
      totalAmount: raffleReservationsTable.totalAmount,
    })
    .from(raffleReservationsTable)
    .where(and(
      eq(raffleReservationsTable.raffleId, raffleId),
      eq(raffleReservationsTable.status, "paid"),
    ));

  const grouped = new Map<string, RaffleRankingEntry>();
  for (const row of rows) {
    const documentKey = String(row.clientDocument ?? "").replace(/\D/g, "");
    const emailKey = String(row.clientEmail ?? "").trim().toLowerCase();
    const phoneKey = normalizePhone(row.clientPhone);
    // Prefer CPF, then e-mail, then phone, then name to avoid splitting the same buyer.
    const key = documentKey || emailKey || phoneKey || row.clientName.toLowerCase();
    const current = grouped.get(key) ?? {
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      clientEmail: row.clientEmail,
      clientDocument: row.clientDocument,
      totalNumbers: 0,
      totalSpent: 0,
      reservationCount: 0,
    };
    current.totalNumbers += parseNumbers(row.numbers).length;
    current.totalSpent += Number(row.totalAmount || 0);
    current.reservationCount += 1;
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .sort((a, b) => {
      if (b.totalNumbers !== a.totalNumbers) return b.totalNumbers - a.totalNumbers;
      if (b.totalSpent !== a.totalSpent) return b.totalSpent - a.totalSpent;
      return a.clientName.localeCompare(b.clientName);
    })
    .slice(0, limit);
}

async function getRaffleResult(raffleId: string) {
  const [result] = await db
    .select()
    .from(raffleResultsTable)
    .where(eq(raffleResultsTable.raffleId, raffleId))
    .limit(1);
  return result ?? null;
}

/** Return set of numbers already taken (reserved/paid) for a raffle */
async function getTakenNumbers(raffleId: string): Promise<Set<number>> {
  const now = new Date();
  const rows = await db
    .select({ numbers: raffleReservationsTable.numbers, status: raffleReservationsTable.status, expiresAt: raffleReservationsTable.expiresAt })
    .from(raffleReservationsTable)
    .where(and(
      eq(raffleReservationsTable.raffleId, raffleId),
      inArray(raffleReservationsTable.status, ["reserved", "paid"]),
    ));

  const taken = new Set<number>();
  for (const row of rows) {
    // Skip expired reserved reservations (they count as expired even if not yet cleaned up)
    if (row.status === "reserved" && row.expiresAt < now) continue;
    for (const n of parseNumbers(row.numbers)) taken.add(n);
  }
  return taken;
}

// ---------------------------------------------------------------------------
// PUBLIC: GET /api/raffles — list active raffles
// ---------------------------------------------------------------------------
router.get("/raffles", async (_req, res) => {
  const raffles = await db
    .select()
    .from(rafflesTable)
    .where(eq(rafflesTable.status, "active"))
    .orderBy(sql`created_at DESC`);
  res.json(raffles);
});

// ---------------------------------------------------------------------------
// PUBLIC: GET /api/raffles/:id — raffle detail + number map
// ---------------------------------------------------------------------------
router.get("/raffles/:id", async (req, res) => {
  const { id: raffleIdParam } = req.params as { id: string };
  const [raffle] = await db
    .select()
    .from(rafflesTable)
    .where(eq(rafflesTable.id, raffleIdParam))
    .limit(1);

  if (!raffle) {
    res.status(404).json({ error: "NOT_FOUND", message: "Rifa não encontrada." });
    return;
  }

  // Build a flat status array indexed by number (1-based)
  // "available" | "reserved" | "paid"
  const now = new Date();
  const reservations = await db
    .select({
      numbers: raffleReservationsTable.numbers,
      status: raffleReservationsTable.status,
      expiresAt: raffleReservationsTable.expiresAt,
    })
    .from(raffleReservationsTable)
    .where(and(
      eq(raffleReservationsTable.raffleId, raffle.id),
      inArray(raffleReservationsTable.status, ["reserved", "paid"]),
    ));

  const numberStatus: Record<number, "available" | "reserved" | "paid"> = {};
  for (const row of reservations) {
    const isExpired = row.status === "reserved" && row.expiresAt < now;
    if (isExpired) continue;
    for (const n of parseNumbers(row.numbers)) {
      numberStatus[n] = row.status as "reserved" | "paid";
    }
  }

  const [result, ranking, promotions] = await Promise.all([
    getRaffleResult(raffle.id),
    getRaffleRanking(raffle.id, 3),
    getRafflePromotions(raffle.id, true),
  ]);

  res.json({ raffle, numberStatus, result, ranking, promotions });
});

// ---------------------------------------------------------------------------
// PUBLIC: POST /api/raffles/:id/reserve — create reservation + PIX
// ---------------------------------------------------------------------------
router.post("/raffles/:id/reserve", async (req, res) => {
  const { id: reserveRaffleId } = req.params as { id: string };
  const { numbers, client } = req.body as {
    numbers: number[];
    client: { name: string; email: string; phone: string; cpf?: string };
  };

  if (!Array.isArray(numbers) || numbers.length === 0) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Selecione ao menos um número." });
    return;
  }

  if (!client?.name || !client?.email || !client?.phone || !client?.cpf) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Nome, e-mail, telefone e CPF são obrigatórios." });
    return;
  }

  const [raffle] = await db
    .select()
    .from(rafflesTable)
    .where(and(eq(rafflesTable.id, reserveRaffleId), eq(rafflesTable.status, "active")))
    .limit(1);

  if (!raffle) {
    res.status(404).json({ error: "NOT_FOUND", message: "Rifa não encontrada ou encerrada." });
    return;
  }

  // Validate number range
  const price = Number(raffle.pricePerNumber);
  for (const n of numbers) {
    if (!Number.isInteger(n) || n < 1 || n > raffle.totalNumbers) {
      res.status(400).json({ error: "INVALID_INPUT", message: `Número ${n} é inválido.` });
      return;
    }
  }

  // Check conflicts
  const taken = await getTakenNumbers(raffle.id);
  const conflict = numbers.find((n) => taken.has(n));
  if (conflict !== undefined) {
    res.status(409).json({ error: "NUMBER_TAKEN", message: `O número ${conflict} já está reservado.` });
    return;
  }

  const promotions = await getRafflePromotions(raffle.id, true);
  const matchingPromotions = promotions.filter((p) => p.quantity === numbers.length);
  const bestPromotion = matchingPromotions.sort((a, b) => Number(a.promoPrice) - Number(b.promoPrice))[0] ?? null;

  const totalAmount = bestPromotion ? Number(bestPromotion.promoPrice) : price * numbers.length;
  const reservationId = crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + raffle.reservationHours * 60 * 60 * 1000);

  await db.insert(raffleReservationsTable).values({
    id: reservationId,
    raffleId: raffle.id,
    numbers: JSON.stringify(numbers),
    clientName: client.name,
    clientEmail: client.email,
    clientPhone: client.phone,
    clientDocument: client.cpf.replace(/\D/g, ""),
    totalAmount: String(totalAmount),
    status: "reserved",
    expiresAt,
  });

  // Generate PIX
  const identifier = genIdentifier();
  const callbackUrl = buildCallbackUrl(req as never, "/webhook/raffle-pix");

  let gatewayData;
  try {
    gatewayData = await createPixCharge({
      identifier,
      amount: totalAmount,
      client: {
        name: client.name,
        email: client.email,
        phone: client.phone,
        document: client.cpf.replace(/\D/g, ""),
      },
      metadata: {
        reservationId,
        raffleId: raffle.id,
        numbers: JSON.stringify(numbers),
      },
      callbackUrl,
    });
  } catch (err) {
    // Cleanup reservation if PIX generation fails
    await db
      .update(raffleReservationsTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(raffleReservationsTable.id, reservationId))
      .catch(() => {});
    const msg = err instanceof Error ? err.message : "Erro ao gerar PIX.";
    res.status(400).json({ error: "GATEWAY_ERROR", message: msg });
    return;
  }

  await db
    .update(raffleReservationsTable)
    .set({
      transactionId: gatewayData.transactionId,
      pixCode: gatewayData.pix?.code ?? null,
      pixBase64: gatewayData.pix?.base64 ?? null,
      pixExpiresAt: new Date(Date.now() + PIX_DURATION_MS),
      updatedAt: new Date(),
    })
    .where(eq(raffleReservationsTable.id, reservationId));

  res.json({
    reservationId,
    transactionId: gatewayData.transactionId,
    pixCode: gatewayData.pix?.code,
    pixBase64: gatewayData.pix?.base64,
    totalAmount,
    appliedPromotion: bestPromotion
      ? { id: bestPromotion.id, quantity: bestPromotion.quantity, promoPrice: bestPromotion.promoPrice }
      : null,
    expiresAt: expiresAt.toISOString(),
    pixExpiresAt: new Date(Date.now() + PIX_DURATION_MS).toISOString(),
  });
});

// ---------------------------------------------------------------------------
// PUBLIC: GET /api/raffles/reservations/lookup?phone=XX|cpf=YYY|query=ZZZ&raffleId=ID — consulta por tel/CPF.
// ---------------------------------------------------------------------------
router.get("/raffles/reservations/lookup", async (req, res) => {
  const rawQuery = String(req.query.query || "").trim();
  const queryDigits = rawQuery.replace(/\D/g, "");
  const phone = String(req.query.phone || "").replace(/\D/g, "");
  const cpf = String(req.query.cpf || "").replace(/\D/g, "");

  const lookupPhone = phone || (queryDigits.length >= 8 ? queryDigits : "");
  const lookupCpf = cpf || (queryDigits.length === 11 ? queryDigits : "");
  const raffleId = String(req.query.raffleId || "").trim();

  if (lookupPhone.length < 8 && lookupCpf.length !== 11) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Informe um telefone ou CPF válido." });
    return;
  }

  let whereClause;
  const cpfLike = "%" + lookupCpf + "%";
  const cpfByEmailSubquery = raffleId
    ? sql`SELECT rr2.client_email FROM raffle_reservations rr2 WHERE rr2.client_document LIKE ${cpfLike} AND rr2.raffle_id = ${raffleId}`
    : sql`SELECT rr2.client_email FROM raffle_reservations rr2 WHERE rr2.client_document LIKE ${cpfLike}`;

  if (lookupPhone.length >= 8 && lookupCpf.length === 11) {
    whereClause = sql`(
      REPLACE(REPLACE(REPLACE(REPLACE(client_phone,' ',''),'-',''),'(',''),')','') LIKE ${"%" + lookupPhone + "%"}
      OR client_document LIKE ${cpfLike}
      OR client_email IN (${cpfByEmailSubquery})
    )`;
  } else if (lookupCpf.length === 11) {
    whereClause = sql`(
      client_document LIKE ${cpfLike}
      OR client_email IN (${cpfByEmailSubquery})
    )`;
  } else {
    whereClause = sql`REPLACE(REPLACE(REPLACE(REPLACE(client_phone,' ',''),'-',''),'(',''),')','') LIKE ${"%" + lookupPhone + "%"}`;
  }

  // Match reservation where phone/CPF contains the typed digits.
  const conditions = [whereClause];
  if (raffleId) {
    conditions.push(eq(raffleReservationsTable.raffleId, raffleId));
  }

  const rows = await db
    .select({
      id: raffleReservationsTable.id,
      raffleId: raffleReservationsTable.raffleId,
      numbers: raffleReservationsTable.numbers,
      clientName: raffleReservationsTable.clientName,
      clientPhone: raffleReservationsTable.clientPhone,
      clientEmail: raffleReservationsTable.clientEmail,
      clientDocument: raffleReservationsTable.clientDocument,
      totalAmount: raffleReservationsTable.totalAmount,
      status: raffleReservationsTable.status,
      expiresAt: raffleReservationsTable.expiresAt,
      createdAt: raffleReservationsTable.createdAt,
      pixCode: raffleReservationsTable.pixCode,
      pixBase64: raffleReservationsTable.pixBase64,
      pixExpiresAt: raffleReservationsTable.pixExpiresAt,
      transactionId: raffleReservationsTable.transactionId,
    })
    .from(raffleReservationsTable)
    .where(and(...conditions))
    .orderBy(sql`created_at DESC`)
    .limit(200);

  // Enrich with raffle title
  const raffleIds = [...new Set(rows.map((r) => r.raffleId))];
  let raffleMap: Record<string, string> = {};
  if (raffleIds.length > 0) {
    const raffleRows = await db
      .select({ id: rafflesTable.id, title: rafflesTable.title })
      .from(rafflesTable)
      .where(inArray(rafflesTable.id, raffleIds));
    for (const r of raffleRows) raffleMap[r.id] = r.title;
  }

  const now = new Date();
  const result = rows.map((r) => ({
    ...r,
    numbers: parseNumbers(r.numbers),
    raffleTitle: raffleMap[r.raffleId] ?? "Rifa",
    isExpired: r.status === "reserved" && r.expiresAt < now,
    isPixExpired: r.pixExpiresAt ? r.pixExpiresAt < now : true,
  }));

  res.json(result);
});

// ---------------------------------------------------------------------------
// PUBLIC: POST /api/raffles/reservations/:reservationId/refresh-pix — renew expired PIX
// ---------------------------------------------------------------------------
router.post("/raffles/reservations/:reservationId/refresh-pix", async (req, res) => {
  const { reservationId } = req.params as { reservationId: string };

  const [reservation] = await db
    .select()
    .from(raffleReservationsTable)
    .where(eq(raffleReservationsTable.id, reservationId))
    .limit(1);

  if (!reservation) {
    res.status(404).json({ error: "NOT_FOUND", message: "Reserva não encontrada." });
    return;
  }

  if (reservation.status !== "reserved") {
    res.status(400).json({ error: "INVALID_STATUS", message: "Esta reserva já foi paga ou expirou." });
    return;
  }

  const now = new Date();
  if (reservation.expiresAt < now) {
    res.status(400).json({ error: "RESERVATION_EXPIRED", message: "A reserva expirou. Selecione os números novamente." });
    return;
  }

  // Resolve document: use saved one, or a new one from the request body
  const bodyDoc = String((req.body as Record<string, unknown>)?.document || "").replace(/\D/g, "");
  const resolvedDocument = reservation.clientDocument || (bodyDoc.length === 11 ? bodyDoc : "");

  if (!resolvedDocument) {
    res.status(400).json({ error: "MISSING_DOCUMENT", message: "CPF obrigatório para gerar PIX. Informe seu CPF." });
    return;
  }

  // Persist CPF if it wasn't saved yet
  if (!reservation.clientDocument && bodyDoc.length === 11) {
    await db
      .update(raffleReservationsTable)
      .set({ clientDocument: bodyDoc })
      .where(eq(raffleReservationsTable.id, reservation.id));
  }

  const identifier = genIdentifier();
  const callbackUrl = buildCallbackUrl(req as never, "/webhook/raffle-pix");
  const totalAmount = Number(reservation.totalAmount);

  let gatewayData;
  try {
    gatewayData = await createPixCharge({
      identifier,
      amount: totalAmount,
      client: {
        name: reservation.clientName,
        email: reservation.clientEmail,
        phone: reservation.clientPhone,
        document: resolvedDocument,
      },
      metadata: {
        reservationId: reservation.id,
        raffleId: reservation.raffleId,
        numbers: reservation.numbers,
      },
      callbackUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao gerar PIX.";
    res.status(400).json({ error: "GATEWAY_ERROR", message: msg });
    return;
  }

  const pixExpiresAt = new Date(Date.now() + PIX_DURATION_MS);

  await db
    .update(raffleReservationsTable)
    .set({
      transactionId: gatewayData.transactionId,
      pixCode: gatewayData.pix?.code ?? null,
      pixBase64: gatewayData.pix?.base64 ?? null,
      pixExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(raffleReservationsTable.id, reservation.id));

  res.json({
    reservationId: reservation.id,
    transactionId: gatewayData.transactionId,
    pixCode: gatewayData.pix?.code,
    pixBase64: gatewayData.pix?.base64,
    pixExpiresAt: pixExpiresAt.toISOString(),
  });
});

// ---------------------------------------------------------------------------
// PUBLIC: GET /api/raffles/:id/ranking — top buyers (paid numbers)
// ---------------------------------------------------------------------------
router.get("/raffles/:id/ranking", async (req, res) => {
  const { id: raffleId } = req.params as { id: string };
  const ranking = await getRaffleRanking(raffleId, 3);
  res.json({ ranking });
});

// ---------------------------------------------------------------------------
// PUBLIC: GET /api/raffles/:id/result — winner data
// ---------------------------------------------------------------------------
router.get("/raffles/:id/result", async (req, res) => {
  const { id: raffleId } = req.params as { id: string };
  const result = await getRaffleResult(raffleId);
  res.json({ result });
});

// ===========================================================================
// ADMIN ROUTES
// ===========================================================================

// ---------------------------------------------------------------------------
// ADMIN: GET /api/admin/raffles — list all raffles
// ---------------------------------------------------------------------------
router.get("/admin/raffles", requireAdminAuth, async (_req, res) => {
  try {
    const raffles = await db
      .select({
        id: rafflesTable.id,
        title: rafflesTable.title,
        description: rafflesTable.description,
        imageUrl: rafflesTable.imageUrl,
        totalNumbers: rafflesTable.totalNumbers,
        pricePerNumber: rafflesTable.pricePerNumber,
        reservationHours: rafflesTable.reservationHours,
        status: rafflesTable.status,
        createdAt: rafflesTable.createdAt,
        updatedAt: rafflesTable.updatedAt,
        totalPaidAmount: sql<string>`COALESCE((
          SELECT SUM(CAST(rr.total_amount AS DECIMAL(12,2)))
          FROM raffle_reservations rr
          WHERE rr.raffle_id = ${rafflesTable.id}
            AND rr.status = 'paid'
        ), 0)`,
      })
      .from(rafflesTable)
      .orderBy(sql`created_at DESC`);
    res.json(raffles);
  } catch (err) {
    console.error("[Raffles] GET admin list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar rifas." });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: POST /api/admin/raffles — create raffle
// ---------------------------------------------------------------------------
router.post("/admin/raffles", requireAdminAuth, async (req, res) => {
  try {
    const { title, description, imageUrl, totalNumbers, pricePerNumber, reservationHours, status } = req.body as {
      title: string;
      description?: string;
      imageUrl?: string;
      totalNumbers: number;
      pricePerNumber: number;
      reservationHours?: number;
      status?: string;
    };

    if (!title || !totalNumbers || !pricePerNumber) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Título, quantidade de números e preço são obrigatórios." });
      return;
    }
    if (Number(totalNumbers) < 1 || Number(totalNumbers) > 100000) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Quantidade de números deve ser entre 1 e 100.000." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    await db.insert(rafflesTable).values({
      id,
      title: String(title),
      description: description ? String(description) : null,
      imageUrl: imageUrl ? String(imageUrl) : null,
      totalNumbers: Number(totalNumbers),
      pricePerNumber: String(pricePerNumber),
      reservationHours: Number(reservationHours ?? 24),
      status: status ?? "active",
    });

    const [created] = await db.select().from(rafflesTable).where(eq(rafflesTable.id, id)).limit(1);
    res.json(created);
  } catch (err) {
    console.error("[Raffles] POST create error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao criar rifa: " + (err instanceof Error ? err.message : String(err)) });
  }
});

// ---------------------------------------------------------------------------
// ADMIN: PATCH /api/admin/raffles/:id — update raffle
// ---------------------------------------------------------------------------
router.patch("/admin/raffles/:id", requireAdminAuth, async (req, res) => {
  const { id: raffleId } = req.params as { id: string };
  const { title, description, imageUrl, totalNumbers, pricePerNumber, reservationHours, status } = req.body as {
    title?: string;
    description?: string;
    imageUrl?: string;
    totalNumbers?: number;
    pricePerNumber?: number;
    reservationHours?: number;
    status?: string;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = String(title);
  if (description !== undefined) updates.description = description;
  if (imageUrl !== undefined) updates.imageUrl = imageUrl;
  if (totalNumbers !== undefined) updates.totalNumbers = Number(totalNumbers);
  if (pricePerNumber !== undefined) updates.pricePerNumber = String(pricePerNumber);
  if (reservationHours !== undefined) updates.reservationHours = Number(reservationHours);
  if (status !== undefined) updates.status = String(status);

  await db.update(rafflesTable).set(updates as never).where(eq(rafflesTable.id, raffleId));
  const [updated] = await db.select().from(rafflesTable).where(eq(rafflesTable.id, raffleId)).limit(1);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// ADMIN: DELETE /api/admin/raffles/:id — delete raffle (and reservations)
// ---------------------------------------------------------------------------
router.delete("/admin/raffles/:id", requireAdminAuth, async (req, res) => {
  const { id: delId } = req.params as { id: string };
  await db.delete(raffleReservationsTable).where(eq(raffleReservationsTable.raffleId, delId));
  await db.delete(rafflesTable).where(eq(rafflesTable.id, delId));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// ADMIN: GET /api/admin/raffles/:id/reservations — list all reservations
// ---------------------------------------------------------------------------
router.get("/admin/raffles/:id/reservations", requireAdminAuth, async (req, res) => {
  const { id: resRaffleId } = req.params as { id: string };
  const rows = await db
    .select()
    .from(raffleReservationsTable)
    .where(eq(raffleReservationsTable.raffleId, resRaffleId))
    .orderBy(sql`created_at DESC`);

  const now = new Date();
  const result = rows.map((r) => ({
    ...r,
    numbers: parseNumbers(r.numbers),
    isExpired: r.status === "reserved" && r.expiresAt < now,
  }));
  res.json(result);
});

// ---------------------------------------------------------------------------
// ADMIN: GET /api/admin/raffles/:id/ranking — ranking for admin panel
// ---------------------------------------------------------------------------
router.get("/admin/raffles/:id/ranking", requireAdminAuth, async (req, res) => {
  const { id: raffleId } = req.params as { id: string };
  const ranking = await getRaffleRanking(raffleId, 3);
  res.json({ ranking });
});

// ---------------------------------------------------------------------------
// ADMIN: GET /api/admin/raffles/:id/result — current winner/result
// ---------------------------------------------------------------------------
router.get("/admin/raffles/:id/result", requireAdminAuth, async (req, res) => {
  const { id: raffleId } = req.params as { id: string };
  const result = await getRaffleResult(raffleId);
  res.json({ result });
});

// ---------------------------------------------------------------------------
// ADMIN: PUT /api/admin/raffles/:id/result — register winner number/result
// ---------------------------------------------------------------------------
router.put("/admin/raffles/:id/result", requireAdminAuth, async (req, res) => {
  const { id: raffleId } = req.params as { id: string };
  const { winnerNumber, notes, drawMethod } = req.body as {
    winnerNumber: number;
    notes?: string;
    drawMethod?: string;
  };

  const [raffle] = await db.select().from(rafflesTable).where(eq(rafflesTable.id, raffleId)).limit(1);
  if (!raffle) {
    res.status(404).json({ error: "NOT_FOUND", message: "Rifa não encontrada." });
    return;
  }

  const parsedWinner = Number(winnerNumber);
  if (!Number.isInteger(parsedWinner) || parsedWinner < 1 || parsedWinner > raffle.totalNumbers) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Número vencedor inválido para esta rifa." });
    return;
  }

  const paidRows = await db
    .select({
      id: raffleReservationsTable.id,
      clientName: raffleReservationsTable.clientName,
      clientPhone: raffleReservationsTable.clientPhone,
      numbers: raffleReservationsTable.numbers,
    })
    .from(raffleReservationsTable)
    .where(and(
      eq(raffleReservationsTable.raffleId, raffleId),
      eq(raffleReservationsTable.status, "paid"),
    ));

  const winnerReservation = paidRows.find((r) => parseNumbers(r.numbers).includes(parsedWinner)) ?? null;

  const [existing] = await db
    .select({ id: raffleResultsTable.id })
    .from(raffleResultsTable)
    .where(eq(raffleResultsTable.raffleId, raffleId))
    .limit(1);

  if (existing) {
    await db
      .update(raffleResultsTable)
      .set({
        winnerNumber: parsedWinner,
        winnerReservationId: winnerReservation?.id ?? null,
        winnerClientName: winnerReservation?.clientName ?? null,
        winnerClientPhone: winnerReservation?.clientPhone ?? null,
        notes: notes ?? null,
        drawMethod: drawMethod?.trim() || "manual",
        drawnAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(raffleResultsTable.id, existing.id));
  } else {
    await db.insert(raffleResultsTable).values({
      id: crypto.randomBytes(8).toString("hex"),
      raffleId,
      winnerNumber: parsedWinner,
      winnerReservationId: winnerReservation?.id ?? null,
      winnerClientName: winnerReservation?.clientName ?? null,
      winnerClientPhone: winnerReservation?.clientPhone ?? null,
      notes: notes ?? null,
      drawMethod: drawMethod?.trim() || "manual",
      drawnAt: new Date(),
    });
  }

  await db
    .update(rafflesTable)
    .set({ status: "drawn", updatedAt: new Date() })
    .where(eq(rafflesTable.id, raffleId));

  const result = await getRaffleResult(raffleId);
  res.json({ result });
});

// ---------------------------------------------------------------------------
// ADMIN: GET /api/admin/raffles/:id/promotions — list promotions
// ---------------------------------------------------------------------------
router.get("/admin/raffles/:id/promotions", requireAdminAuth, async (req, res) => {
  const { id: raffleId } = req.params as { id: string };
  const promotions = await getRafflePromotions(raffleId, false);
  res.json({ promotions });
});

// ---------------------------------------------------------------------------
// ADMIN: POST /api/admin/raffles/:id/promotions — create promotion
// ---------------------------------------------------------------------------
router.post("/admin/raffles/:id/promotions", requireAdminAuth, async (req, res) => {
  const { id: raffleId } = req.params as { id: string };
  const { quantity, promoPrice, isActive, sortOrder } = req.body as {
    quantity: number;
    promoPrice: number;
    isActive?: boolean;
    sortOrder?: number;
  };

  const q = Number(quantity);
  const p = Number(promoPrice);
  if (!Number.isInteger(q) || q < 2) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Quantidade deve ser um inteiro maior que 1." });
    return;
  }
  if (!Number.isFinite(p) || p <= 0) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Preço promocional inválido." });
    return;
  }

  const id = crypto.randomBytes(8).toString("hex");
  await db.insert(rafflePromotionsTable).values({
    id,
    raffleId,
    quantity: q,
    promoPrice: String(p),
    isActive: isActive === false ? 0 : 1,
    sortOrder: Number(sortOrder ?? 0),
  });

  const [created] = await db
    .select()
    .from(rafflePromotionsTable)
    .where(eq(rafflePromotionsTable.id, id))
    .limit(1);
  res.json(created);
});

// ---------------------------------------------------------------------------
// ADMIN: PATCH /api/admin/raffles/:id/promotions/:promotionId — update
// ---------------------------------------------------------------------------
router.patch("/admin/raffles/:id/promotions/:promotionId", requireAdminAuth, async (req, res) => {
  const { promotionId } = req.params as { id: string; promotionId: string };
  const { quantity, promoPrice, isActive, sortOrder } = req.body as {
    quantity?: number;
    promoPrice?: number;
    isActive?: boolean;
    sortOrder?: number;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (quantity !== undefined) {
    const q = Number(quantity);
    if (!Number.isInteger(q) || q < 2) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Quantidade deve ser um inteiro maior que 1." });
      return;
    }
    updates.quantity = q;
  }
  if (promoPrice !== undefined) {
    const p = Number(promoPrice);
    if (!Number.isFinite(p) || p <= 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Preço promocional inválido." });
      return;
    }
    updates.promoPrice = String(p);
  }
  if (isActive !== undefined) updates.isActive = isActive ? 1 : 0;
  if (sortOrder !== undefined) updates.sortOrder = Number(sortOrder);

  await db
    .update(rafflePromotionsTable)
    .set(updates as never)
    .where(eq(rafflePromotionsTable.id, promotionId));

  const [updated] = await db
    .select()
    .from(rafflePromotionsTable)
    .where(eq(rafflePromotionsTable.id, promotionId))
    .limit(1);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// ADMIN: DELETE /api/admin/raffles/:id/promotions/:promotionId — delete
// ---------------------------------------------------------------------------
router.delete("/admin/raffles/:id/promotions/:promotionId", requireAdminAuth, async (req, res) => {
  const { promotionId } = req.params as { id: string; promotionId: string };
  await db.delete(rafflePromotionsTable).where(eq(rafflePromotionsTable.id, promotionId));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// WEBHOOK: POST /webhook/raffle-pix — payment confirmation
// ---------------------------------------------------------------------------
router.post("/webhook/raffle-pix", async (req, res) => {
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const tx = ((raw.transaction as Record<string, unknown>) ?? raw) as Record<string, unknown>;
  const txMeta = ((tx.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const rawMeta = ((raw.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;

  const transactionId = String(
    tx.id || tx.transactionId || (tx as { transaction_id?: unknown }).transaction_id || raw.transactionId || raw.transaction_id || raw.id || "",
  ).trim();

  let status = String(tx.status || raw.status || raw.payment_status || raw.event || "").trim();
  if (!status && raw.event) {
    const ev = String(raw.event).toUpperCase();
    if (ev.includes("PAID") || ev.includes("APPROVED") || ev.includes("COMPLETED")) status = "COMPLETED";
    else if (ev.includes("CANCEL") || ev.includes("REJECT") || ev.includes("FAILED")) status = "CANCELED";
  }

  const reservationId = String(txMeta.reservationId || rawMeta.reservationId || "").trim();

  if (!transactionId && !reservationId) {
    console.log("[RaffleWebhook] Missing transactionId/reservationId", JSON.stringify(raw));
    res.status(400).json({ error: "MISSING_REFERENCE" });
    return;
  }

  const [reservation] = transactionId
    ? await db
      .select()
      .from(raffleReservationsTable)
      .where(eq(raffleReservationsTable.transactionId, transactionId))
      .limit(1)
    : await db
      .select()
      .from(raffleReservationsTable)
      .where(eq(raffleReservationsTable.id, reservationId))
      .limit(1);

  if (!reservation) {
    console.log("[RaffleWebhook] Reservation not found", JSON.stringify({ transactionId, reservationId, status }));
    res.status(404).json({ error: "RESERVATION_NOT_FOUND" });
    return;
  }

  const confirmed = status ? isPaymentConfirmed(status) : false;
  if (confirmed && reservation.status !== "paid") {
    await db
      .update(raffleReservationsTable)
      .set({ status: "paid", updatedAt: new Date() })
      .where(eq(raffleReservationsTable.id, reservation.id));
    console.log("[RaffleWebhook] Reservation paid", JSON.stringify({ id: reservation.id, transactionId, status }));
  }

  res.json({ ok: true, confirmed, reservationId: reservation.id });
});

export default router;


