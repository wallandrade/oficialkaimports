import assert from "node:assert/strict";
import { test } from "node:test";

import { orderToPostPaymentText, postPaymentInsuranceNotice } from "./post-payment-message";

const base = {
  id: "uuid-1",
  orderNumber: 1841,
  clientName: "Maria Souza",
  products: [{ name: "Tirzepatida", quantity: 2 }],
  addressStreet: "Rua A",
  addressNumber: "10",
  addressNeighborhood: "Centro",
  addressComplement: "Apto 2",
  addressCity: "São Paulo",
  addressState: "SP",
  addressCep: "01001000",
  logisticsAllocation: { promisedHours: 72 },
};

test("sem compra e valor 0 usa o aviso sem seguro, mesmo com plano reduced", () => {
  const text = postPaymentInsuranceNotice({
    includeInsurance: false,
    insuranceAmount: 0,
    insurancePlan: "reduced",
  });
  assert.match(text, /\*\*Compra sem seguro\*\*/);
  assert.doesNotMatch(text, /10%/);
});

test("caixa marcada sem plano gravado usa o aviso de 20%", () => {
  const text = postPaymentInsuranceNotice({
    includeInsurance: true,
    insuranceAmount: 0,
    insurancePlan: "",
  });
  assert.match(text, /\*\*Seguro 20%\*\*/);
  assert.match(text, /válido 100%/);
});

test("plano reduced ou reduzido com compra usa o aviso de 10%", () => {
  for (const insurancePlan of ["reduced", "reduzido", "REDUZIDO"]) {
    const text = postPaymentInsuranceNotice({
      includeInsurance: true,
      insuranceAmount: 15,
      insurancePlan,
    });
    assert.match(text, /\*\*Produto com seguro 10%\*\*/);
    assert.match(text, /roubo e extravio/);
  }
});

test("full, completo ou outro plano com compra usa 20%, sem ler o percentual da loja", () => {
  for (const insurancePlan of ["full", "completo", "especial", "none"]) {
    const text = postPaymentInsuranceNotice({
      includeInsurance: false,
      insuranceAmount: 40,
      insurancePlan,
    });
    assert.match(text, /\*\*Seguro 20%\*\*/);
    assert.doesNotMatch(text, /54%/);
  }
});

test("mensagem inteira coloca o aviso depois do feriado e antes do obrigado", () => {
  const text = orderToPostPaymentText({
    ...base,
    includeInsurance: true,
    insurancePlan: "reduced",
    insuranceAmount: 10,
  });
  assert.match(text, /Parabéns, Maria!/);
  assert.match(text, /📦 \*\*Pedido #1841\*\*/);
  assert.match(text, /💊 2x Tirzepatida/);
  assert.match(text, /Rua A, 10/);
  assert.match(text, /\*\*72 horas úteis\*\*/);
  const holiday = text.indexOf("sábados, domingos e feriados");
  const notice = text.indexOf("**Produto com seguro 10%**");
  const thanks = text.indexOf("Obrigado pela confiança! 💙📦");
  assert.ok(holiday >= 0 && notice > holiday && thanks > notice);
  assert.doesNotMatch(text, /só um reenvio|Receita Federal|saldo/);
});

test("nome vazio vira Cliente, sem item vira 1x Produto, prazo vazio vira 48 e linha de endereço vazia some", () => {
  const text = orderToPostPaymentText({
    clientName: "   ",
    id: "abc",
    products: [],
    addressStreet: "Rua B",
    addressNumber: "",
    addressNeighborhood: "",
    addressComplement: "Fundos",
    addressCity: "",
    addressState: "",
    addressCep: "",
    includeInsurance: false,
    insuranceAmount: 0,
  });
  assert.match(text, /Parabéns, Cliente!/);
  assert.match(text, /📦 \*\*Pedido #abc\*\*/);
  assert.match(text, /💊 1x Produto/);
  assert.match(text, /Rua B\nComplemento: Fundos/);
  assert.doesNotMatch(text, /Bairro:|CEP:|\/SP/);
  assert.match(text, /\*\*48 horas úteis\*\*/);
  assert.match(text, /\*\*Compra sem seguro\*\*/);
});
