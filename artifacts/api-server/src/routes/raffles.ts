import { Router, type IRouter } from "express";
import { db, rafflesTable, raffleReservationsTable, raffleResultsTable } from "@workspace/db";
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
  totalNumbers: number;
  totalSpent: number;
  reservationCount: number;
};

async function getRaffleRanking(raffleId: string, limit = 3): Promise<RaffleRankingEntry[]> {
  const rows = await db
    .select({
      clientName: raffleReservationsTable.clientName,
      clientPhone: raffleReservationsTable.clientPhone,
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
    const key = normalizePhone(row.clientPhone) || row.clientName.toLowerCase();
    const current = grouped.get(key) ?? {
      clientName: row.clientName,
      clientPhone: row.clientPhone,
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

  const [result, ranking] = await Promise.all([
    getRaffleResult(raffle.id),
    getRaffleRanking(raffle.id, 3),
  ]);

  res.json({ raffle, numberStatus, result, ranking });
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

  const totalAmount = price * numbers.length;
  const reservationId = crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + raffle.reservationHours * 60 * 60 * 1000);

  await db.insert(raffleReservationsTable).values({
    id: reservationId,
    raffleId: raffle.id,
    numbers: JSON.stringify(numbers),
    clientName: client.name,
    clientEmail: client.email,
    clientPhone: client.phone,
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
      updatedAt: new Date(),
    })
    .where(eq(raffleReservationsTable.id, reservationId));

  res.json({
    reservationId,
    transactionId: gatewayData.transactionId,
    pixCode: gatewayData.pix?.code,
    pixBase64: gatewayData.pix?.base64,
    totalAmount,
    expiresAt: expiresAt.toISOString(),
    pixExpiresAt: new Date(Date.now() + PIX_DURATION_MS).toISOString(),
  });
});

// ---------------------------------------------------------------------------
// PUBLIC: GET /api/raffles/reservations/lookup?phone=XX — consulta por tel.
// ---------------------------------------------------------------------------
router.get("/raffles/reservations/lookup", async (req, res) => {
  const phone = String(req.query.phone || "").replace(/\D/g, "");
  if (phone.length < 8) {
    res.status(400).json({ error: "INVALID_INPUT", message: "Informe um telefone válido." });
    return;
  }

  // Match any reservation where phone contains the digits (stripped)
  const rows = await db
    .select({
      id: raffleReservationsTable.id,
      raffleId: raffleReservationsTable.raffleId,
      numbers: raffleReservationsTable.numbers,
      clientName: raffleReservationsTable.clientName,
      clientPhone: raffleReservationsTable.clientPhone,
      totalAmount: raffleReservationsTable.totalAmount,
      status: raffleReservationsTable.status,
      expiresAt: raffleReservationsTable.expiresAt,
      createdAt: raffleReservationsTable.createdAt,
      pixCode: raffleReservationsTable.pixCode,
      pixBase64: raffleReservationsTable.pixBase64,
      transactionId: raffleReservationsTable.transactionId,
    })
    .from(raffleReservationsTable)
    .where(sql`REPLACE(REPLACE(REPLACE(REPLACE(client_phone,' ',''),'-',''),'(',''),')','') LIKE ${'%' + phone + '%'}`)
    .orderBy(sql`created_at DESC`)
    .limit(20);

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
  }));

  res.json(result);
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
      .select()
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
