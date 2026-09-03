import { Router, type IRouter } from "express";
import { lookupMotoboyCoverage } from "../lib/motoboy-coverage-lookup";
import { resolvePublicTenantId } from "../lib/tenant-context";

const router: IRouter = Router();

/**
 * GET /api/motoboy-coverage/lookup?cep=&bairro=&cidade=
 * Km ligado: ignora bairros e cota por distância (consult > limite não cai na faixa CEP).
 * Km desligado: bairro cadastrado → faixa CEP.
 */
router.get("/motoboy-coverage/lookup", async (req, res) => {
  try {
    const tenantId = await resolvePublicTenantId(req);
    const result = await lookupMotoboyCoverage({
      tenantId,
      cep: String(req.query.cep ?? ""),
      bairro: String(req.query.bairro ?? ""),
      cidade: String(req.query.cidade ?? ""),
    });
    res.json(result);
  } catch (err) {
    console.error("[MotoboyCoverage] lookup error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao consultar cobertura Motoboy." });
  }
});

export default router;
