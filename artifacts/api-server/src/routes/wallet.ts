import { Router, type IRouter } from "express";
import { customerUsersTable, db } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { getCustomerSession, requireCustomerAuth } from "../middlewares/customer-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { creditWallet, getWalletBalance, listWalletEntries } from "../lib/customer-wallet";

const router: IRouter = Router();

function buildCustomerUsersTenantWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(eq(customerUsersTable.tenantId, tenantId), isNull(customerUsersTable.tenantId), eq(customerUsersTable.tenantId, ""));
  }
  return eq(customerUsersTable.tenantId, tenantId);
}

router.get("/me/wallet", requireCustomerAuth, async (req, res) => {
  const session = getCustomerSession(req);
  if (!session) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return;
  }
  const tenantId = session.tenantId || DEFAULT_TENANT_ID;
  const available = await getWalletBalance(session.userId, tenantId);
  res.json({ availableCredit: available, entries: await listWalletEntries(session.userId, tenantId, 20) });
});

router.get("/admin/wallet/:userId", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    const tenantId = scope.tenantId || DEFAULT_TENANT_ID;
    const userId = String(req.params.userId || "").trim();
    if (!userId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe o ID do cliente." });
      return;
    }
    const available = await getWalletBalance(userId, tenantId);
    const entries = await listWalletEntries(userId, tenantId, 50);
    res.json({ userId, availableCredit: available, entries });
  } catch (err) {
    console.error("Admin wallet get error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar saldo." });
  }
});

router.post("/admin/wallet/adjust", requireAdminAuth, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    if (!scope.hasGlobalAccess) {
      res.status(403).json({ error: "FORBIDDEN", message: "Sem permissão para ajustar saldo." });
      return;
    }
    const tenantId = scope.tenantId || DEFAULT_TENANT_ID;
    const userId = String(req.body?.customerUserId || req.body?.userId || "").trim();
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || "").trim();
    if (!userId || !Number.isFinite(amount) || amount === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe ID do cliente e um valor diferente de zero." });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe o motivo do ajuste." });
      return;
    }

    const [user] = await db
      .select({ id: customerUsersTable.id })
      .from(customerUsersTable)
      .where(and(buildCustomerUsersTenantWhere(tenantId), eq(customerUsersTable.id, userId)))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "NOT_FOUND", message: "Cliente não encontrado." });
      return;
    }

    if (amount < 0) {
      const available = await getWalletBalance(userId, tenantId);
      if (available + amount < -0.001) {
        res.status(400).json({ error: "INSUFFICIENT_BALANCE", message: "Saldo insuficiente para debitar." });
        return;
      }
    }
    await creditWallet({
      tenantId,
      userId,
      amount,
      type: "admin_adjust",
      note: reason,
    });

    const available = await getWalletBalance(userId, tenantId);
    res.json({ ok: true, userId, availableCredit: available });
  } catch (err) {
    console.error("Admin wallet adjust error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao ajustar saldo." });
  }
});

export default router;
