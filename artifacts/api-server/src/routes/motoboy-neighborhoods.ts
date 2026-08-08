import crypto from "crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, motoboyNeighborhoodsTable } from "@workspace/db";
import { resolvePublicTenantId } from "../lib/tenant-context";
import { getAdminScope, requireAdminAuth } from "./admin-auth";

const router: IRouter = Router();
const DEFAULT_TENANT_ID = "tenant_loja1";

function normalizeNeighborhoodName(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function parsePrice(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

router.get("/motoboy-neighborhoods/lookup", async (req, res) => {
  try {
    const lookupName = normalizeNeighborhoodName(req.query.bairro);
    if (!lookupName) {
      res.json({ neighborhood: null });
      return;
    }

    const tenantId = await resolvePublicTenantId(req);
    const neighborhoods = await db
      .select()
      .from(motoboyNeighborhoodsTable)
      .where(and(
        eq(motoboyNeighborhoodsTable.tenantId, tenantId),
        eq(motoboyNeighborhoodsTable.isActive, true),
      ))
      .orderBy(asc(motoboyNeighborhoodsTable.sortOrder), asc(motoboyNeighborhoodsTable.createdAt));

    const neighborhood = neighborhoods.find((item) => (
      normalizeNeighborhoodName(item.neighborhoodName) === lookupName
    )) || null;

    res.json({ neighborhood });
  } catch (error) {
    console.error("[MotoboyNeighborhoods] lookup error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao consultar entrega por motoboy." });
  }
});

router.get("/admin/motoboy-neighborhoods", requireAdminAuth, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const neighborhoods = await db
      .select()
      .from(motoboyNeighborhoodsTable)
      .where(eq(motoboyNeighborhoodsTable.tenantId, tenantId))
      .orderBy(asc(motoboyNeighborhoodsTable.sortOrder), asc(motoboyNeighborhoodsTable.neighborhoodName));

    res.json({ neighborhoods });
  } catch (error) {
    console.error("[MotoboyNeighborhoods] admin list error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar bairros atendidos." });
  }
});

router.post("/admin/motoboy-neighborhoods", requireAdminAuth, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const neighborhoodName = String(req.body?.neighborhoodName || "").trim();
    const price = parsePrice(req.body?.price);
    if (!neighborhoodName) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Bairro é obrigatório." });
      return;
    }
    if (price == null) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Valor da entrega é inválido." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    await db.insert(motoboyNeighborhoodsTable).values({
      id,
      tenantId,
      neighborhoodName,
      city: String(req.body?.city || "").trim() || null,
      price: price.toFixed(2),
      sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Math.trunc(Number(req.body.sortOrder)) : 0,
      isActive: true,
      notes: String(req.body?.notes || "").trim() || null,
    });

    const [neighborhood] = await db
      .select()
      .from(motoboyNeighborhoodsTable)
      .where(and(
        eq(motoboyNeighborhoodsTable.tenantId, tenantId),
        eq(motoboyNeighborhoodsTable.id, id),
      ))
      .limit(1);

    res.status(201).json({ neighborhood });
  } catch (error) {
    console.error("[MotoboyNeighborhoods] create error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao cadastrar bairro." });
  }
});

router.patch("/admin/motoboy-neighborhoods/:id", requireAdminAuth, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id || "").trim();
    const updates: Partial<typeof motoboyNeighborhoodsTable.$inferInsert> = { updatedAt: new Date() };

    if (req.body?.neighborhoodName !== undefined) {
      const neighborhoodName = String(req.body.neighborhoodName || "").trim();
      if (!neighborhoodName) {
        res.status(400).json({ error: "INVALID_INPUT", message: "Bairro é obrigatório." });
        return;
      }
      updates.neighborhoodName = neighborhoodName;
    }
    if (req.body?.city !== undefined) updates.city = String(req.body.city || "").trim() || null;
    if (req.body?.notes !== undefined) updates.notes = String(req.body.notes || "").trim() || null;
    if (req.body?.sortOrder !== undefined) {
      const sortOrder = Number(req.body.sortOrder);
      if (!Number.isFinite(sortOrder)) {
        res.status(400).json({ error: "INVALID_INPUT", message: "Ordem de exibição inválida." });
        return;
      }
      updates.sortOrder = Math.trunc(sortOrder);
    }
    if (req.body?.price !== undefined) {
      const price = parsePrice(req.body.price);
      if (price == null) {
        res.status(400).json({ error: "INVALID_INPUT", message: "Valor da entrega é inválido." });
        return;
      }
      updates.price = price.toFixed(2);
    }
    if (req.body?.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);

    await db
      .update(motoboyNeighborhoodsTable)
      .set(updates)
      .where(and(
        eq(motoboyNeighborhoodsTable.tenantId, tenantId),
        eq(motoboyNeighborhoodsTable.id, id),
      ));

    const [neighborhood] = await db
      .select()
      .from(motoboyNeighborhoodsTable)
      .where(and(
        eq(motoboyNeighborhoodsTable.tenantId, tenantId),
        eq(motoboyNeighborhoodsTable.id, id),
      ))
      .limit(1);

    if (!neighborhood) {
      res.status(404).json({ error: "NOT_FOUND", message: "Bairro não encontrado." });
      return;
    }

    res.json({ neighborhood });
  } catch (error) {
    console.error("[MotoboyNeighborhoods] update error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar bairro." });
  }
});

router.delete("/admin/motoboy-neighborhoods/:id", requireAdminAuth, async (req, res) => {
  try {
    const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
    const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id || "").trim();
    await db.delete(motoboyNeighborhoodsTable).where(and(
      eq(motoboyNeighborhoodsTable.tenantId, tenantId),
      eq(motoboyNeighborhoodsTable.id, id),
    ));
    res.json({ ok: true });
  } catch (error) {
    console.error("[MotoboyNeighborhoods] delete error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao excluir bairro." });
  }
});

export default router;
