import { Router, type IRouter } from "express";
import { db, kycDocumentsTable, ordersTable, sellersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAdminAuth, getSessionInfo } from "./admin-auth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/kyc/check-cpf/:cpf — public: check if CPF has an approved KYC
// ---------------------------------------------------------------------------
router.get("/kyc/check-cpf/:cpf", async (req, res) => {
  try {
    const cpf = req.params.cpf.replace(/\D/g, "");
    if (!cpf) { res.json({ approved: false }); return; }

    const rows = await db
      .select({ id: kycDocumentsTable.id, status: kycDocumentsTable.status, approvedAt: kycDocumentsTable.approvedAt })
      .from(kycDocumentsTable)
      .where(and(eq(kycDocumentsTable.clientDocument, cpf), eq(kycDocumentsTable.status, "approved")))
      .limit(1);

    res.json({ approved: rows.length > 0, kycId: rows[0]?.id ?? null });
  } catch (err) {
    console.error("[KYC] check-cpf error:", err);
    res.json({ approved: false });
  }
});

// ---------------------------------------------------------------------------
// GET /api/kyc/:orderId — public: get order info + KYC status for client form
// ---------------------------------------------------------------------------
router.get("/kyc/:orderId", async (req, res) => {
  try {
    let orderId = req.params.orderId;
    if (Array.isArray(orderId)) orderId = orderId[0];

    const orderRows = await db
      .select({
        id: ordersTable.id,
        clientName: ordersTable.clientName,
        clientDocument: ordersTable.clientDocument,
        clientPhone: ordersTable.clientPhone,
        addressStreet: ordersTable.addressStreet,
        addressNumber: ordersTable.addressNumber,
        addressComplement: ordersTable.addressComplement,
        addressNeighborhood: ordersTable.addressNeighborhood,
        addressCity: ordersTable.addressCity,
        addressState: ordersTable.addressState,
        addressCep: ordersTable.addressCep,
        paymentMethod: ordersTable.paymentMethod,
        sellerCode: ordersTable.sellerCode,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    const order = orderRows[0];
    if (!order) {
      res.status(404).json({ error: "ORDER_NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    // Look up seller WhatsApp
    let sellerWhatsapp: string | null = null;
    if (order.sellerCode) {
      const sellerRows = await db
        .select({ whatsapp: sellersTable.whatsapp })
        .from(sellersTable)
        .where(eq(sellersTable.slug, order.sellerCode))
        .limit(1);
      sellerWhatsapp = sellerRows[0]?.whatsapp?.trim() || null;
    }

    const kycRows = await db
      .select({
        id: kycDocumentsTable.id,
        status: kycDocumentsTable.status,
        submittedAt: kycDocumentsTable.submittedAt,
        hasSelfie: kycDocumentsTable.selfieUrl,
        hasRgFront: kycDocumentsTable.rgFrontUrl,
        declarationSignature: kycDocumentsTable.declarationSignature,
        declarationSignedAt: kycDocumentsTable.declarationSignedAt,
      })
      .from(kycDocumentsTable)
      .where(eq(kycDocumentsTable.orderId, orderId))
      .limit(1);

    const kyc = kycRows[0];

    res.json({
      order: {
        id: order.id,
        clientName: order.clientName,
        clientDocument: order.clientDocument,
        address: [
          order.addressStreet && order.addressNumber ? `${order.addressStreet}, ${order.addressNumber}` : null,
          order.addressComplement || null,
          order.addressNeighborhood || null,
          order.addressCity && order.addressState ? `${order.addressCity}/${order.addressState}` : null,
          order.addressCep ? `CEP ${order.addressCep}` : null,
        ].filter(Boolean).join(", "),
        paymentMethod: order.paymentMethod,
        sellerWhatsapp,
      },
      kyc: kyc ? {
        status: kyc.status,
        submittedAt: kyc.submittedAt,
        hasSelfie: Boolean(kyc.hasSelfie),
        hasRgFront: Boolean(kyc.hasRgFront),
        declarationSigned: Boolean(kyc.declarationSignature),
        declarationSignedAt: kyc.declarationSignedAt,
      } : null,
    });
  } catch (err) {
    console.error("[KYC] GET error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar dados." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/kyc/:orderId — public: submit KYC documents
// ---------------------------------------------------------------------------
router.post("/kyc/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { selfieUrl, rgFrontUrl, declarationSignature, cardNumber, cardHolderName, declarationProduct } = req.body as {
      selfieUrl?: string;
      rgFrontUrl?: string;
      declarationSignature?: string;
      cardNumber?: string;
      cardHolderName?: string;
      declarationProduct?: string;
    };

    if (!selfieUrl || !rgFrontUrl || !declarationSignature?.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Todos os documentos são obrigatórios." });
      return;
    }

    const orderRows = await db
      .select({
        id: ordersTable.id,
        clientDocument: ordersTable.clientDocument,
        clientName: ordersTable.clientName,
        clientPhone: ordersTable.clientPhone,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    const order = orderRows[0];
    if (!order) {
      res.status(404).json({ error: "ORDER_NOT_FOUND", message: "Pedido não encontrado." });
      return;
    }

    const cpf = order.clientDocument?.replace(/\D/g, "") ?? order.clientDocument ?? null;

    const existing = await db
      .select({ id: kycDocumentsTable.id, status: kycDocumentsTable.status })
      .from(kycDocumentsTable)
      .where(eq(kycDocumentsTable.orderId, orderId))
      .limit(1);

    // Block resubmission if already approved
    if (existing[0]?.status === "approved") {
      res.status(409).json({ error: "ALREADY_APPROVED", message: "Seu KYC já foi aprovado. Não é necessário enviar novamente." });
      return;
    }

    const now = new Date();

    if (existing[0]) {
      await db
        .update(kycDocumentsTable)
        .set({
          selfieUrl,
          rgFrontUrl,
          declarationSignature: declarationSignature.trim(),
          declarationSignedAt: now,
          clientDocument:      cpf,
          clientName:          order.clientName,
          clientPhone:         order.clientPhone,
          cardNumber:          cardNumber?.replace(/\D/g, "").trim() || null,
          cardHolderName:      cardHolderName?.trim().toUpperCase() || null,
          declarationProduct:  declarationProduct?.trim() || null,
          status:              "submitted",
          submittedAt:         now,
          updatedAt:           now,
        })
        .where(eq(kycDocumentsTable.orderId, orderId));
    } else {
      await db.insert(kycDocumentsTable).values({
        id: crypto.randomBytes(8).toString("hex"),
        orderId,
        selfieUrl,
        rgFrontUrl,
        declarationSignature: declarationSignature.trim(),
        declarationSignedAt:  now,
        clientDocument:       cpf,
        clientName:           order.clientName,
        clientPhone:          order.clientPhone,
        cardNumber:           cardNumber?.replace(/\D/g, "").trim() || null,
        cardHolderName:       cardHolderName?.trim().toUpperCase() || null,
        declarationProduct:   declarationProduct?.trim() || null,
        status:               "submitted",
        submittedAt:          now,
      });
    }

    res.json({ ok: true, message: "KYC enviado com sucesso!" });
  } catch (err) {
    console.error("[KYC] POST error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar documentos." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/kyc — admin: list all KYC records (with optional search filter)
// ---------------------------------------------------------------------------
router.get("/admin/kyc", requireAdminAuth, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: kycDocumentsTable.id,
        orderId: kycDocumentsTable.orderId,
        clientDocument: kycDocumentsTable.clientDocument,
        clientName: kycDocumentsTable.clientName,
        clientPhone: kycDocumentsTable.clientPhone,
        status: kycDocumentsTable.status,
        submittedAt: kycDocumentsTable.submittedAt,
        approvedAt: kycDocumentsTable.approvedAt,
        approvedByUsername: kycDocumentsTable.approvedByUsername,
        rejectedAt: kycDocumentsTable.rejectedAt,
        adminEdited: kycDocumentsTable.adminEdited,
        declarationSignature: kycDocumentsTable.declarationSignature,
        createdAt: kycDocumentsTable.createdAt,
      })
      .from(kycDocumentsTable)
      .orderBy(kycDocumentsTable.createdAt);

    res.json({ kycs: rows.reverse() });
  } catch (err) {
    console.error("[KYC] Admin list error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/kyc/:orderId — admin: full KYC document details
// ---------------------------------------------------------------------------
router.get("/admin/kyc/:orderId", requireAdminAuth, async (req, res) => {
  try {
    let orderId = req.params.orderId;
    if (Array.isArray(orderId)) orderId = orderId[0];
    const rows = await db
      .select()
      .from(kycDocumentsTable)
      .where(eq(kycDocumentsTable.orderId, orderId))
      .limit(1);

    res.json({ kyc: rows[0] ?? null });
  } catch (err) {
    console.error("[KYC] Admin GET error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/kyc/:orderId/status — admin: approve or reject KYC
// ---------------------------------------------------------------------------
router.patch("/admin/kyc/:orderId/status", requireAdminAuth, async (req, res) => {
  try {
    let orderId = req.params.orderId;
    if (Array.isArray(orderId)) orderId = orderId[0];
    const { action } = req.body as { action: "approve" | "reject" };

    if (!["approve", "reject"].includes(action)) {
      res.status(400).json({ error: "INVALID_ACTION" });
      return;
    }

    const existing = await db
      .select({ id: kycDocumentsTable.id })
      .from(kycDocumentsTable)
      .where(eq(kycDocumentsTable.orderId, orderId))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "KYC_NOT_FOUND" });
      return;
    }

    const session = getSessionInfo(req);
    const now = new Date();
    await db
      .update(kycDocumentsTable)
      .set({
        status:             action === "approve" ? "approved" : "rejected",
        approvedAt:         action === "approve" ? now : null,
        approvedByUsername: action === "approve" ? (session?.username ?? null) : null,
        rejectedAt:         action === "reject"  ? now : null,
        updatedAt:          now,
      })
      .where(eq(kycDocumentsTable.orderId, orderId));

    res.json({ ok: true, status: action === "approve" ? "approved" : "rejected" });
  } catch (err) {
    console.error("[KYC] Status PATCH error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/kyc/:orderId — admin: edit declaration fields
// ---------------------------------------------------------------------------
router.patch("/admin/kyc/:orderId", requireAdminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { declarationProduct, declarationCompanyName, declarationCompanyCnpj, declarationPurchaseValue, declarationDate } = req.body as {
      declarationProduct?: string;
      declarationCompanyName?: string;
      declarationCompanyCnpj?: string;
      declarationPurchaseValue?: string;
      declarationDate?: string;
    };

    const existing = await db
      .select({ id: kycDocumentsTable.id })
      .from(kycDocumentsTable)
      .where(eq(kycDocumentsTable.orderId, orderId))
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "KYC_NOT_FOUND" });
      return;
    }

    await db
      .update(kycDocumentsTable)
      .set({
        declarationProduct:       declarationProduct       ?? null,
        declarationCompanyName:   declarationCompanyName   ?? null,
        declarationCompanyCnpj:   declarationCompanyCnpj   ?? null,
        declarationPurchaseValue: declarationPurchaseValue ?? null,
        declarationDate:          declarationDate          ?? null,
        adminEdited:    true,
        adminEditedAt:  new Date(),
        updatedAt:      new Date(),
      })
      .where(eq(kycDocumentsTable.orderId, orderId));

    res.json({ ok: true });
  } catch (err) {
    console.error("[KYC] Admin PATCH error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
