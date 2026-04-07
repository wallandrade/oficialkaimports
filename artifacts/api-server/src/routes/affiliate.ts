import { Router, type IRouter, type Request } from "express";
import {
  affiliateCommissionsTable,
  affiliateReferralsTable,
  affiliatesTable,
  db,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getCustomerSession, requireCustomerAuth } from "../middlewares/customer-auth";
import { getAffiliateAvailableCreditByUserId, getOrCreateAffiliateByUserId } from "../lib/affiliates";

const router: IRouter = Router();

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function getStorefrontOrigin(req: Request): string {
  const explicitOrigin =
    process.env.STOREFRONT_URL ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_SITE_URL ||
    "https://www.ka-imports.com";

  if (explicitOrigin) {
    return normalizeOrigin(String(explicitOrigin));
  }

  const forwardedHost = String(req.get("x-forwarded-host") || "").trim();
  const forwardedProto = String(req.get("x-forwarded-proto") || req.protocol || "http").trim();
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const origin = String(req.get("origin") || "").trim();
  if (origin) {
    return normalizeOrigin(origin);
  }

  const referer = String(req.get("referer") || "").trim();
  if (referer) {
    try {
      const parsed = new URL(referer);
      return normalizeOrigin(parsed.origin);
    } catch {
      // Ignore invalid referer and fallback to request host.
    }
  }

  return `${req.protocol}://${req.get("host")}`;
}

router.get("/me/affiliate/dashboard", requireCustomerAuth, async (req, res) => {
  try {
    const session = getCustomerSession(req);
    if (!session) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const affiliate = await getOrCreateAffiliateByUserId(session.userId);

    const commissions = await db
      .select({
        status: affiliateCommissionsTable.status,
        commissionAmount: affiliateCommissionsTable.commissionAmount,
      })
      .from(affiliateCommissionsTable)
      .where(eq(affiliateCommissionsTable.affiliateUserId, session.userId));

    let pending = 0;
    let released = 0;

    for (const row of commissions) {
      const value = Number(row.commissionAmount || 0);
      if (!Number.isFinite(value)) continue;

      if (row.status === "released") released += value;
      else if (row.status === "pending") pending += value;
    }

    const referrals = await db
      .select({
        hasConverted: affiliateReferralsTable.hasConverted,
      })
      .from(affiliateReferralsTable)
      .where(eq(affiliateReferralsTable.affiliateUserId, session.userId));

    const activeReferrals = referrals.filter((r) => r.hasConverted).length;
    const inactiveReferrals = Math.max(0, referrals.length - activeReferrals);

    const origin = getStorefrontOrigin(req);

    res.json({
      summary: {
        commissionsReleased: Number(released.toFixed(2)),
        commissionsPending: Number(pending.toFixed(2)),
        referralsActive: activeReferrals,
        referralsInactive: inactiveReferrals,
      },
      affiliate: {
        code: affiliate.affiliateCode,
        referralLink: `${origin}/r/${affiliate.affiliateCode}`,
        facebookPixelId: affiliate.facebookPixelId || "",
      },
    });
  } catch (err) {
    console.error("[Affiliate] dashboard error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar dados de afiliação." });
  }
});

router.patch("/me/affiliate/facebook-pixel", requireCustomerAuth, async (req, res) => {
  try {
    const session = getCustomerSession(req);
    if (!session) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const pixelId = String((req.body as { pixelId?: string }).pixelId || "").trim();

    const affiliate = await getOrCreateAffiliateByUserId(session.userId);

    await db
      .update(affiliatesTable)
      .set({ facebookPixelId: pixelId || null, updatedAt: new Date() })
      .where(and(eq(affiliatesTable.id, affiliate.id), eq(affiliatesTable.userId, session.userId)));

    res.json({ ok: true, facebookPixelId: pixelId });
  } catch (err) {
    console.error("[Affiliate] update pixel error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar pixel." });
  }
});

router.get("/me/affiliate/credit-balance", requireCustomerAuth, async (req, res) => {
  try {
    const session = getCustomerSession(req);
    if (!session) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
      return;
    }

    const availableCredit = await getAffiliateAvailableCreditByUserId(session.userId);
    res.json({ availableCredit });
  } catch (err) {
    console.error("[Affiliate] credit balance error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar saldo disponível." });
  }
});

export default router;
