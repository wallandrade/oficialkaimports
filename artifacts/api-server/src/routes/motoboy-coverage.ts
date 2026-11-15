import { Router, type IRouter } from "express";
import { lookupMotoboyCoverage } from "../lib/motoboy-coverage-lookup";
import { requirePublicTenantId } from "../lib/tenant-context";

const router: IRouter = Router();

/**
 * GET /api/motoboy-coverage/lookup?cep=&bairro=&cidade=&rua=&numero=&uf=
 * Km ligado: ignora bairros e cota por distância (consult > limite não cai na faixa CEP).
 * Sem coordenada confiável: não cobra a faixa de 10 km; cai na faixa de CEP se houver.
 * Km desligado: bairro cadastrado → faixa CEP.
 */
router.get("/motoboy-coverage/lookup", async (req, res) => {
  try {
    const tenantId = await requirePublicTenantId(req, res);
    if (!tenantId) return;
    const result = await lookupMotoboyCoverage({
      tenantId,
      cep: String(req.query.cep ?? ""),
      bairro: String(req.query.bairro ?? ""),
      cidade: String(req.query.cidade ?? ""),
      rua: String(req.query.rua ?? ""),
      numero: String(req.query.numero ?? ""),
      uf: String(req.query.uf ?? ""),
    });
    res.json(result);
  } catch (err) {
    console.error("[MotoboyCoverage] lookup error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao consultar cobertura Motoboy." });
  }
});

export default router;
