import { Router, type IRouter } from "express";
import { customerUsersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAdminScope, requireAdminAuth, requireStoreWideAdmin } from "./admin-auth";
import { getCustomerSession, requireCustomerAuth } from "../middlewares/customer-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";
import { creditWallet, getWalletBalance, listWalletEntries, WalletIdempotencyConflict } from "../lib/customer-wallet";
import { attachGuestOrdersForCustomer } from "../lib/customer-guest-orders";
import {
  ensureGuestCustomerAccount,
  findCustomerInTenantByEmail,
  findCustomerInTenantById,
  guestEmailHasOrders,
  parseGuestCustomerEmail,
} from "../lib/customer-guest-account";

const router: IRouter = Router();

router.get("/me/wallet", requireCustomerAuth, async (req, res) => {
  const session = getCustomerSession(req);
  if (!session) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
    return;
  }
  const tenantId = session.tenantId || DEFAULT_TENANT_ID;
  const [user] = await db
    .select({ document: customerUsersTable.document, email: customerUsersTable.email })
    .from(customerUsersTable)
    .where(eq(customerUsersTable.id, session.userId))
    .limit(1);
  await attachGuestOrdersForCustomer({
    userId: session.userId,
    email: session.email || user?.email || "",
    document: user?.document,
    tenantId,
  });
  const available = await getWalletBalance(session.userId, tenantId);
  res.json({ availableCredit: available, entries: await listWalletEntries(session.userId, tenantId, 20) });
});

router.get("/admin/wallet/:userId", requireAdminAuth, requireStoreWideAdmin, async (req, res) => {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }
    const tenantId = scope.tenantId || DEFAULT_TENANT_ID;
    const rawUserId = String(req.params.userId || "").trim();
    if (!rawUserId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe o ID do cliente." });
      return;
    }
    const guestEmail = parseGuestCustomerEmail(rawUserId);
    let userId = rawUserId;
    if (guestEmail) {
      const existing = await findCustomerInTenantByEmail(tenantId, guestEmail);
      if (!existing) {
        const hasOrders = await guestEmailHasOrders(tenantId, guestEmail);
        if (!hasOrders) {
          res.status(404).json({ error: "NOT_FOUND", message: "Cliente não encontrado." });
          return;
        }
        res.json({ userId: rawUserId, availableCredit: 0, entries: [] });
        return;
      }
      userId = existing.id;
    } else {
      const customer = await findCustomerInTenantById(tenantId, userId);
      if (!customer) {
        res.status(404).json({ error: "NOT_FOUND", message: "Cliente não encontrado." });
        return;
      }
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
    const rawUserId = String(req.body?.customerUserId || req.body?.userId || "").trim();
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || "").trim();
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
    if (!rawUserId || !Number.isFinite(amount) || amount === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe ID do cliente e um valor diferente de zero." });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Informe o motivo do ajuste." });
      return;
    }
    if (idempotencyKey.length > 80) {
      res.status(400).json({ error: "INVALID_INPUT", message: "A chave de idempotência é longa demais." });
      return;
    }

    const guestEmail = parseGuestCustomerEmail(rawUserId);
    let userId = rawUserId;
    let createdAccount = false;
    if (guestEmail) {
      if (amount < 0) {
        const existing = await findCustomerInTenantByEmail(tenantId, guestEmail);
        if (!existing) {
          res.status(400).json({ error: "INSUFFICIENT_BALANCE", message: "Saldo insuficiente para debitar." });
          return;
        }
        userId = existing.id;
      } else {
        const ensured = await ensureGuestCustomerAccount({ tenantId, email: guestEmail });
        if (!ensured.ok) {
          res.status(ensured.status).json({ error: ensured.error, message: ensured.message });
          return;
        }
        userId = ensured.customer.id;
        createdAccount = ensured.customer.created;
      }
    } else {
      const customer = await findCustomerInTenantById(tenantId, userId);
      if (!customer) {
        res.status(404).json({ error: "NOT_FOUND", message: "Cliente não encontrado." });
        return;
      }
    }

    if (amount < 0) {
      const available = await getWalletBalance(userId, tenantId);
      if (available + amount < -0.001) {
        res.status(400).json({ error: "INSUFFICIENT_BALANCE", message: "Saldo insuficiente para debitar." });
        return;
      }
    }
    try {
      await creditWallet({
        tenantId,
        userId,
        amount,
        type: "admin_adjust",
        note: reason,
        idempotencyKey: idempotencyKey || null,
      });
    } catch (err) {
      if (err instanceof WalletIdempotencyConflict) {
        res.status(409).json({
          error: "IDEMPOTENCY_CONFLICT",
          message: "Este crédito já foi enviado com outro valor ou motivo.",
        });
        return;
      }
      throw err;
    }

    const available = await getWalletBalance(userId, tenantId);
    res.json({ ok: true, userId, availableCredit: available, createdAccount });
  } catch (err) {
    console.error("Admin wallet adjust error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao ajustar saldo." });
  }
});

export default router;
