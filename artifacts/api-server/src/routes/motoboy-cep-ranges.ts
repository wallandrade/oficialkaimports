import crypto from "crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db, motoboyCepRangesTable } from "@workspace/db";
import { resolvePublicTenantId } from "../lib/tenant-context";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { isMotoboyCoverageWriteLocked } from "../lib/motoboy-yury-sync";

const router: IRouter = Router();
const DEFAULT_TENANT_ID = "tenant_loja1";

function parseCep(value: unknown): number | null {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const parsed = Number(digits);
  return Number.isInteger(parsed) ? parsed : null;
}

function parsePrice(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseIntervalHours(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : null;
}

function parseSortOrder(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeCity(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

router.get("/motoboy-cep-ranges/lookup", async (req, res) => {
  try {
    const cep = parseCep(req.query.cep);
    const city = normalizeCity(req.query.cidade);
    if (cep == null || !city) {
      res.status(400).json({ error: "INVALID_INPUT", message: "CEP e cidade são obrigatórios." });
      return;
    }

    const tenantId = await resolvePublicTenantId(req);
    const candidates = await db
      .select()
      .from(motoboyCepRangesTable)
      .where(and(
        eq(motoboyCepRangesTable.tenantId, tenantId),
        eq(motoboyCepRangesTable.isActive, true),
        lte(motoboyCepRangesTable.cepStart, cep),
        gte(motoboyCepRangesTable.cepEnd, cep),
      ))
      .orderBy(
        sql`${motoboyCepRangesTable.cepEnd} - ${motoboyCepRangesTable.cepStart} asc`,
        asc(motoboyCepRangesTable.sortOrder),
      );
    const cepRange = candidates.find((candidate) => normalizeCity(candidate.city) === city) || null;

    res.json({ cepRange });
  } catch (error) {
    console.error("[MotoboyCepRanges] lookup error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao consultar faixa de CEP." });
  }
});

router.get("/admin/motoboy-cep-ranges", requireAdminAuth, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const cepRanges = await db
      .select()
      .from(motoboyCepRangesTable)
      .where(eq(motoboyCepRangesTable.tenantId, tenantId))
      .orderBy(asc(motoboyCepRangesTable.sortOrder), asc(motoboyCepRangesTable.cepStart));
    res.json({ cepRanges });
  } catch (error) {
    console.error("[MotoboyCepRanges] admin list error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar faixas de CEP." });
  }
});

router.post("/admin/motoboy-cep-ranges", requireAdminAuth, async (req, res) => {
  try {
    if (isMotoboyCoverageWriteLocked()) {
      res.status(409).json({ error: "YURY_COVERAGE_LOCKED", message: "Cadastro de faixa Motoboy só na Yury. Use Sincronizar." });
      return;
    }
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const label = String(req.body?.label || "").trim();
    const cepStart = parseCep(req.body?.cepStart);
    const cepEnd = parseCep(req.body?.cepEnd);
    const price = parsePrice(req.body?.price);
    const intervalHours = parseIntervalHours(req.body?.intervalHours);
    const sortOrder = parseSortOrder(req.body?.sortOrder ?? 0);

    if (!label || cepStart == null || cepEnd == null || cepStart > cepEnd || price == null || intervalHours == null || sortOrder == null) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Confira descrição, faixa de CEP, valor e intervalo de horas." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    await db.insert(motoboyCepRangesTable).values({
      id,
      tenantId,
      label,
      city: String(req.body?.city || "").trim() || null,
      cepStart,
      cepEnd,
      price: price.toFixed(2),
      intervalHours,
      isActive: req.body?.isActive !== false,
      sortOrder,
      notes: String(req.body?.notes || "").trim() || null,
    });

    const [cepRange] = await db.select().from(motoboyCepRangesTable).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      eq(motoboyCepRangesTable.id, id),
    )).limit(1);
    res.status(201).json({ cepRange });
  } catch (error) {
    console.error("[MotoboyCepRanges] create error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao cadastrar faixa de CEP." });
  }
});

router.patch("/admin/motoboy-cep-ranges/:id", requireAdminAuth, async (req, res) => {
  try {
    if (isMotoboyCoverageWriteLocked()) {
      res.status(409).json({ error: "YURY_COVERAGE_LOCKED", message: "Cadastro de faixa Motoboy só na Yury. Use Sincronizar." });
      return;
    }
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id || "").trim();
    const [existing] = await db.select().from(motoboyCepRangesTable).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      eq(motoboyCepRangesTable.id, id),
    )).limit(1);
    if (!existing) {
      res.status(404).json({ error: "NOT_FOUND", message: "Faixa de CEP não encontrada." });
      return;
    }

    const updates: Partial<typeof motoboyCepRangesTable.$inferInsert> = { updatedAt: new Date() };
    const label = req.body?.label === undefined ? existing.label : String(req.body.label || "").trim();
    const cepStart = req.body?.cepStart === undefined ? existing.cepStart : parseCep(req.body.cepStart);
    const cepEnd = req.body?.cepEnd === undefined ? existing.cepEnd : parseCep(req.body.cepEnd);
    if (!label || cepStart == null || cepEnd == null || cepStart > cepEnd) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Descrição ou faixa de CEP inválida." });
      return;
    }
    updates.label = label;
    updates.cepStart = cepStart;
    updates.cepEnd = cepEnd;

    if (req.body?.city !== undefined) updates.city = String(req.body.city || "").trim() || null;
    if (req.body?.notes !== undefined) updates.notes = String(req.body.notes || "").trim() || null;
    if (req.body?.price !== undefined) {
      const price = parsePrice(req.body.price);
      if (price == null) {
        res.status(400).json({ error: "INVALID_INPUT", message: "Valor da entrega inválido." });
        return;
      }
      updates.price = price.toFixed(2);
    }
    if (req.body?.intervalHours !== undefined) {
      const intervalHours = parseIntervalHours(req.body.intervalHours);
      if (intervalHours == null) {
        res.status(400).json({ error: "INVALID_INPUT", message: "Intervalo deve ser entre 1 e 8 horas." });
        return;
      }
      updates.intervalHours = intervalHours;
    }
    if (req.body?.sortOrder !== undefined) {
      const sortOrder = parseSortOrder(req.body.sortOrder);
      if (sortOrder == null) {
        res.status(400).json({ error: "INVALID_INPUT", message: "Ordem inválida." });
        return;
      }
      updates.sortOrder = sortOrder;
    }
    if (req.body?.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);

    await db.update(motoboyCepRangesTable).set(updates).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      eq(motoboyCepRangesTable.id, id),
    ));
    const [cepRange] = await db.select().from(motoboyCepRangesTable).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      eq(motoboyCepRangesTable.id, id),
    )).limit(1);
    res.json({ cepRange });
  } catch (error) {
    console.error("[MotoboyCepRanges] update error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar faixa de CEP." });
  }
});

router.delete("/admin/motoboy-cep-ranges/:id", requireAdminAuth, async (req, res) => {
  try {
    if (isMotoboyCoverageWriteLocked()) {
      res.status(409).json({ error: "YURY_COVERAGE_LOCKED", message: "Cadastro de faixa Motoboy só na Yury. Use Sincronizar." });
      return;
    }
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id || "").trim();
    await db.delete(motoboyCepRangesTable).where(and(
      eq(motoboyCepRangesTable.tenantId, tenantId),
      eq(motoboyCepRangesTable.id, id),
    ));
    res.json({ ok: true });
  } catch (error) {
    console.error("[MotoboyCepRanges] delete error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao excluir faixa de CEP." });
  }
});

export default router;
